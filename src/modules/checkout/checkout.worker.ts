import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PaymentProvider, PaymentType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaystackService } from '../paystack/paystack.service';
import { RegistrationService } from '../registration/registration.service';
import { TicketService } from '../ticket/ticket.service';
import { CheckoutService } from './checkout.service';

@Injectable()
export class CheckoutWorker {
  private readonly logger = new Logger(CheckoutWorker.name);
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly tickets: TicketService,
    private readonly registrations: RegistrationService,
    private readonly paystack: PaystackService,
  ) {}

  @Interval(10000)
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.checkout.expireHolds();
      await this.deliverConfirmations();
      await this.processRefunds();
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.running = false;
    }
  }

  async deliverConfirmations() {
    const now = new Date();
    const jobs = await this.prisma.checkoutFulfillmentJob.findMany({
      where: {
        nextAttemptAt: { lte: now },
        OR: [
          { status: 'PENDING' },
          { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
        ],
      },
      take: 20,
    });
    for (const job of jobs) {
      const claimed = await this.prisma.checkoutFulfillmentJob.updateMany({
        where: {
          transactionId: job.transactionId,
          status: job.status,
          attempts: job.attempts,
        },
        data: {
          status: 'PROCESSING',
          attempts: { increment: 1 },
          leaseExpiresAt: new Date(Date.now() + 120000),
        },
      });
      if (claimed.count !== 1) continue;
      try {
        const record = await this.checkout.get(job.transactionId);
        const sponsorship = this.checkout.metadata(record).sponsorship;
        if (record.paymentType === PaymentType.TICKET)
          await this.tickets.notifyPurchase(record.id);
        else if (sponsorship)
          await this.registrations.recordSponsoredRegistration(
            record.eventId!,
            record.userId,
            record.id,
            sponsorship.sponsorshipNote,
          );
        else await this.registrations.notifyRegistration(record.id);
        await this.prisma.checkoutFulfillmentJob.update({
          where: { transactionId: record.id },
          data: { status: 'COMPLETED', leaseExpiresAt: null, lastError: null },
        });
      } catch (error) {
        await this.prisma.checkoutFulfillmentJob.update({
          where: { transactionId: job.transactionId },
          data: {
            status: 'PENDING',
            leaseExpiresAt: null,
            lastError: error instanceof Error ? error.message : String(error),
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7)),
            ),
          },
        });
      }
    }
  }

  async processRefunds() {
    const now = new Date();
    const refunds = await this.prisma.checkoutRefund.findMany({
      where: {
        status: { in: ['REQUESTED', 'PROCESSING', 'MANUAL_REQUIRED'] },
        nextAttemptAt: { lte: now },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      include: { transaction: true },
      take: 20,
    });
    for (const refund of refunds) {
      const claimed = await this.prisma.checkoutRefund.updateMany({
        where: {
          transactionId: refund.transactionId,
          attempts: refund.attempts,
          status: refund.status,
        },
        data: {
          attempts: { increment: 1 },
          leaseExpiresAt: new Date(Date.now() + 120000),
          nextAttemptAt: new Date(Date.now() + 60000),
        },
      });
      if (claimed.count !== 1) continue;
      try {
        if (
          refund.transaction.paymentProvider !== PaymentProvider.PAYSTACK ||
          !refund.providerTransactionId
        ) {
          await this.manual(
            refund.transactionId,
            'An operator must refund this payment through the provider and confirm its refund reference.',
          );
          continue;
        }
        // Once a POST might have reached Paystack, only reconcile. Its refund API does not document an idempotency key.
        let providerRefund = (
          await this.paystack.listRefunds(refund.providerTransactionId)
        ).data.find(
          (item) =>
            item.amount === refund.amountKobo && item.currency === 'NGN',
        );
        if (!providerRefund && refund.attempts === 0) {
          await this.prisma.checkoutRefund.update({
            where: { transactionId: refund.transactionId },
            data: { status: 'PROCESSING' },
          });
          providerRefund = (
            await this.paystack.createRefund(
              refund.transactionId,
              refund.amountKobo,
            )
          ).data;
        }
        if (!providerRefund) {
          await this.manual(
            refund.transactionId,
            'No provider refund found. Check the provider before submitting a manual refund.',
          );
          continue;
        }
        if (providerRefund.status === 'processed') {
          await this.prisma.$transaction([
            this.prisma.checkoutRefund.update({
              where: { transactionId: refund.transactionId },
              data: {
                status: 'REFUNDED',
                providerRefundId: providerRefund.id,
                leaseExpiresAt: null,
                confirmedAt: new Date(),
                confirmedReference: String(providerRefund.id),
                lastError: null,
              },
            }),
            this.prisma.transactionReference.update({
              where: { id: refund.transactionId },
              data: { status: 'REFUNDED' },
            }),
          ]);
        } else if (['pending', 'processing'].includes(providerRefund.status)) {
          await this.prisma.checkoutRefund.update({
            where: { transactionId: refund.transactionId },
            data: {
              status: 'PROCESSING',
              providerRefundId: providerRefund.id,
              leaseExpiresAt: null,
              lastError: null,
            },
          });
        } else
          await this.manual(
            refund.transactionId,
            `Provider refund status: ${providerRefund.status}`,
          );
      } catch (error) {
        await this.manual(
          refund.transactionId,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  private async manual(transactionId: string, lastError: string) {
    await this.prisma.checkoutRefund.updateMany({
      where: { transactionId, status: { not: 'REFUNDED' } },
      data: {
        status: 'MANUAL_REQUIRED',
        leaseExpiresAt: null,
        lastError,
        nextAttemptAt: new Date(Date.now() + 300000),
      },
    });
  }
}
