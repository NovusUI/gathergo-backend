import {
  BadRequestException,
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  CreatorAlatProfileStatus,
  CreatorSettlementProfileStatus,
  PaymentProvider,
  PaymentType,
  Prisma,
  RiskStatus,
  SettlementStatus,
  TransactionStatusType,
} from '@prisma/client';
import * as crypto from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DonationService } from '../donation/donation.service';
import { PaystackService } from '../paystack/paystack.service';
import { PaystackResponse } from '../paystack/types/paystack-response.type';
import { RegistrationService } from '../registration/registration.service';
import { TicketService } from '../ticket/ticket.service';
import { AlatCollectionService } from './alat-collection.service';
import { CreateTransactionReferenceDto } from './dto/create-transaction-reference.dto';
import { InitiateDonationDto } from './dto/initiate-donation.dto';
import {
  PaymentClientContextDto,
  PaymentProviderDto,
} from './dto/payment-provider.dto';
import { RiskReviewQueueQueryDto } from './dto/risk-review-queue.dto';
import {
  ReviewTransactionRiskDto,
  ReviewableRiskStatusDto,
} from './dto/review-transaction-risk.dto';
import {
  buildPricingSummary,
  calculatePlatformFeeKobo,
  getPlatformFeeBps,
} from './payment-pricing.util';

type TicketAvailability = {
  id: string;
  reason: string;
  ticketName: string;
};

type RiskAssessment = {
  riskScore: number;
  riskStatus: RiskStatus;
  riskReasons: string[];
  settlementStatus: SettlementStatus;
};

type ProviderInitiationResult = {
  paymentUrl: string | null;
  providerReference?: string | null;
  providerPayload?: Record<string, any> | null;
  instructions?: Record<string, any> | null;
  message?: string;
  status?: boolean;
};

type RegistrationBeneficiaryType = 'SELF' | 'SPONSORED';

type RegistrationSponsorshipMetadata = {
  beneficiaryType: 'SPONSORED';
  sponsorshipNote?: string | null;
  status: 'PENDING_PAYMENT' | 'PENDING_ASSIGNMENT';
};

type ManualRiskReviewRecord = {
  reviewedAt: string;
  reviewedBy: 'OPS';
  previousRiskStatus: RiskStatus;
  nextRiskStatus: RiskStatus;
  previousSettlementStatus: SettlementStatus;
  nextSettlementStatus: SettlementStatus;
  note: string | null;
};

@Injectable()
export class TransactionReferenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly paystackService: PaystackService,
    private readonly alatCollectionService: AlatCollectionService,
    private readonly donationService: DonationService,
    private readonly ticketService: TicketService,
    private readonly registrationService: RegistrationService,
  ) {}

  async initiate(
    userId: string,
    email: string,
    dto: CreateTransactionReferenceDto,
  ) {
    const provider = this.resolvePaymentProvider(dto.provider);
    let totalAmountKobo = 0;
    let expectedAmountKobo = 0;
    const freeTickets: any[] = [];
    const paidTickets: any[] = [];
    const unavailableTickets: TicketAvailability[] = [];
    let eventSummary: {
      id: string;
      creatorId: string;
      title: string;
    } | null = null;

    for (const item of dto.items) {
      const eventTicket = await this.prisma.eventTicket.findUnique({
        where: { id: item.id },
        include: {
          event: {
            select: {
              id: true,
              creatorId: true,
              title: true,
            },
          },
        },
      });

      if (!eventTicket) {
        unavailableTickets.push({
          id: item.id,
          reason: 'Ticket not found',
          ticketName: item.ticketName,
        });
        continue;
      }

      if (!eventSummary) {
        eventSummary = eventTicket.event;
      } else if (eventSummary.id !== eventTicket.eventId) {
        throw new BadRequestException(
          'All tickets in one purchase must belong to the same event',
        );
      }

      const unitPriceKobo = this.toKobo(
        eventTicket.updatedPrice ?? eventTicket.price,
      );
      const availableStock = Math.max(
        eventTicket.quantity - eventTicket.sold,
        0,
      );
      const availableQty = Math.min(item.quantity, availableStock);

      expectedAmountKobo += item.quantity * unitPriceKobo;

      if (availableQty === 0) {
        unavailableTickets.push({
          id: item.id,
          reason: 'Out of stock',
          ticketName: eventTicket.type,
        });
        continue;
      }

      if (availableQty < item.quantity) {
        unavailableTickets.push({
          id: item.id,
          reason: `Only ${availableQty} tickets available out of requested ${item.quantity}`,
          ticketName: eventTicket.type,
        });
      }

      const ticketPayload = {
        eventTicketId: item.id,
        quantity: availableQty,
        ticketName: eventTicket.type,
      };

      if (unitPriceKobo === 0) {
        freeTickets.push(ticketPayload);
      } else {
        const totalPriceKobo = unitPriceKobo * availableQty;
        paidTickets.push({
          ...ticketPayload,
          totalPriceKobo,
          totalPriceNaira: totalPriceKobo / 100,
        });
        totalAmountKobo += totalPriceKobo;
      }
    }

    if (!eventSummary) {
      throw new BadRequestException('No valid ticket was provided');
    }

    const pricing =
      totalAmountKobo > 0
        ? this.buildPricingSummary(totalAmountKobo, provider)
        : this.buildPricingSummary(0, provider);

    const riskAssessment =
      totalAmountKobo > 0
        ? await this.assessRisk({
            buyerId: userId,
            creatorId: eventSummary.creatorId,
            eventId: eventSummary.id,
            grossAmountKobo: totalAmountKobo,
            clientContext: dto.clientContext,
          })
        : this.getNoRiskAssessment();

    if (riskAssessment.riskStatus === RiskStatus.BLOCKED) {
      throw new BadRequestException(
        `Payment blocked for review: ${riskAssessment.riskReasons.join(', ')}`,
      );
    }

    const alatProfile =
      totalAmountKobo > 0
        ? await this.getActiveAlatProfileIfNeeded(
            provider,
            eventSummary.creatorId,
          )
        : null;

    const metadata = {
      type: PaymentType.TICKET,
      amountUnit: 'KOBO',
      eventId: eventSummary.id,
      eventTitle: eventSummary.title,
      paidTickets,
      freeTickets,
      unavailableTickets,
      clientContext: this.serializeClientContext(dto.clientContext),
      pricing,
    };

    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        creatorId: eventSummary.creatorId,
        amount: pricing.chargeAmountKobo,
        eventId: eventSummary.id,
        platformFee: pricing.platformFeeKobo,
        providerFee: pricing.providerFeeKobo,
        creatorPayable: pricing.creatorPayableKobo,
        paymentProvider: provider,
        paymentType: PaymentType.TICKET,
        settlementStatus: riskAssessment.settlementStatus,
        riskStatus: riskAssessment.riskStatus,
        riskScore: riskAssessment.riskScore,
        riskReasons: riskAssessment.riskReasons,
        status:
          totalAmountKobo > 0
            ? this.getInitialPendingStatus(provider)
            : expectedAmountKobo > 0
              ? TransactionStatusType.FAILED
              : TransactionStatusType.SUCCESS,
        metadata: this.asInputJson(metadata),
      },
    });

    if (totalAmountKobo === 0 && freeTickets.length > 0) {
      await this.ticketService.create(
        transactionRef,
        freeTickets,
        eventSummary.id,
      );
    }

    let providerInitResponse: ProviderInitiationResult = {
      paymentUrl: null,
      instructions: null,
    };

    if (totalAmountKobo > 0) {
      providerInitResponse = await this.initializeProviderPayment({
        provider,
        userId,
        email,
        reference: transactionRef.id,
        amountKobo: pricing.chargeAmountKobo,
        eventTitle: eventSummary.title,
        eventId: eventSummary.id,
        paymentType: PaymentType.TICKET,
        creatorId: eventSummary.creatorId,
        alatProfile,
      });

      await this.prisma.transactionReference.update({
        where: { id: transactionRef.id },
        data: {
          ...(providerInitResponse.providerReference
            ? { providerReference: providerInitResponse.providerReference }
            : {}),
          ...(providerInitResponse.providerPayload
            ? {
                providerPayload: this.asInputJson(
                  providerInitResponse.providerPayload,
                ),
              }
            : {}),
          metadata: this.asInputJson({
            ...metadata,
            providerInstructions: providerInitResponse.instructions || null,
          }),
        },
      });
    }

    return {
      message: providerInitResponse.message || 'Transaction initialized',
      transactionId: transactionRef.id,
      paymentProvider: provider,
      paymentUrl: providerInitResponse.paymentUrl,
      paymentInstructions: providerInitResponse.instructions || null,
      unavailableTickets,
      freeTickets: totalAmountKobo === 0 ? freeTickets : [],
      totalAmount: pricing.chargeAmountNaira,
      totalAmountKobo: pricing.chargeAmountKobo,
      pricing,
      riskStatus: riskAssessment.riskStatus,
      settlementStatus: riskAssessment.settlementStatus,
      status: providerInitResponse.status ?? true,
    };
  }

  async initiateRegistration(
    userId: string,
    email: string,
    eventId: string,
    paymentOptions?: {
      beneficiaryType?: string;
      sponsorshipNote?: string;
      provider?: PaymentProviderDto;
      clientContext?: PaymentClientContextDto;
    },
  ) {
    const provider = this.resolvePaymentProvider(paymentOptions?.provider);
    const beneficiaryType = this.normalizeRegistrationBeneficiaryType(
      paymentOptions?.beneficiaryType,
    );
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        registrationFee: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const grossAmountKobo = this.toKobo(event.registrationFee || 0);
    const pricing =
      grossAmountKobo > 0
        ? this.buildPricingSummary(grossAmountKobo, provider)
        : this.buildPricingSummary(0, provider);

    const riskAssessment =
      grossAmountKobo > 0
        ? await this.assessRisk({
            buyerId: userId,
            creatorId: event.creatorId,
            eventId,
            grossAmountKobo,
            clientContext: paymentOptions?.clientContext,
          })
        : this.getNoRiskAssessment();

    if (riskAssessment.riskStatus === RiskStatus.BLOCKED) {
      throw new BadRequestException(
        `Payment blocked for review: ${riskAssessment.riskReasons.join(', ')}`,
      );
    }

    const alatProfile =
      grossAmountKobo > 0
        ? await this.getActiveAlatProfileIfNeeded(provider, event.creatorId)
        : null;
    const sponsorship =
      beneficiaryType === 'SPONSORED'
        ? this.buildRegistrationSponsorshipMetadata({
            beneficiaryType,
            sponsorshipNote: paymentOptions?.sponsorshipNote,
            hasPendingPayment: grossAmountKobo > 0,
          })
        : null;

    const metadata = {
      type: PaymentType.REGISTRATION,
      amountUnit: 'KOBO',
      eventId,
      eventTitle: event.title,
      clientContext: this.serializeClientContext(paymentOptions?.clientContext),
      pricing,
      ...(sponsorship ? { sponsorship } : {}),
    };

    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        creatorId: event.creatorId,
        amount: pricing.chargeAmountKobo,
        eventId,
        platformFee: pricing.platformFeeKobo,
        providerFee: pricing.providerFeeKobo,
        creatorPayable: pricing.creatorPayableKobo,
        paymentProvider: provider,
        paymentType: PaymentType.REGISTRATION,
        settlementStatus: riskAssessment.settlementStatus,
        riskStatus: riskAssessment.riskStatus,
        riskScore: riskAssessment.riskScore,
        riskReasons: riskAssessment.riskReasons,
        status:
          grossAmountKobo > 0
            ? this.getInitialPendingStatus(provider)
            : TransactionStatusType.SUCCESS,
        metadata: this.asInputJson(metadata),
      },
    });

    if (grossAmountKobo === 0) {
      if (beneficiaryType === 'SPONSORED') {
        await this.registrationService.recordSponsoredRegistration(
          eventId,
          userId,
          transactionRef.id,
          sponsorship?.sponsorshipNote,
        );
      } else {
        await this.registrationService.createRegistration(
          eventId,
          userId,
          transactionRef.id,
        );
      }
    }

    let providerInitResponse: ProviderInitiationResult = {
      paymentUrl: null,
      instructions: null,
    };

    if (grossAmountKobo > 0) {
      providerInitResponse = await this.initializeProviderPayment({
        provider,
        userId,
        email,
        reference: transactionRef.id,
        amountKobo: pricing.chargeAmountKobo,
        eventTitle: event.title,
        eventId,
        paymentType: PaymentType.REGISTRATION,
        creatorId: event.creatorId,
        alatProfile,
      });

      await this.prisma.transactionReference.update({
        where: { id: transactionRef.id },
        data: {
          ...(providerInitResponse.providerReference
            ? { providerReference: providerInitResponse.providerReference }
            : {}),
          ...(providerInitResponse.providerPayload
            ? {
                providerPayload: this.asInputJson(
                  providerInitResponse.providerPayload,
                ),
              }
            : {}),
          metadata: this.asInputJson({
            ...metadata,
            providerInstructions: providerInitResponse.instructions || null,
          }),
        },
      });
    }

    return {
      message: providerInitResponse.message || 'Transaction initialized',
      status: providerInitResponse.status ?? true,
      transactionId: transactionRef.id,
      paymentProvider: provider,
      paymentUrl: providerInitResponse.paymentUrl,
      paymentInstructions: providerInitResponse.instructions || null,
      totalAmount: pricing.chargeAmountNaira,
      totalAmountKobo: pricing.chargeAmountKobo,
      pricing,
      settlementStatus: riskAssessment.settlementStatus,
      riskStatus: riskAssessment.riskStatus,
    };
  }

  async initiateDonation(
    userId: string,
    email: string,
    dto: InitiateDonationDto,
  ) {
    const { eventId, amount, message, isAnonymous } = dto;
    const provider = this.resolvePaymentProvider(dto.provider);

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        registrationType: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.registrationType !== 'donation') {
      throw new BadRequestException('Event is not a donation event');
    }

    if (amount < 500) {
      throw new BadRequestException('Minimum donation amount is ₦500');
    }

    const grossAmountKobo = this.toKobo(amount);
    const pricing = this.buildPricingSummary(grossAmountKobo, provider);
    const riskAssessment = await this.assessRisk({
      buyerId: userId,
      creatorId: event.creatorId,
      eventId,
      grossAmountKobo,
      clientContext: dto.clientContext,
    });

    if (riskAssessment.riskStatus === RiskStatus.BLOCKED) {
      throw new BadRequestException(
        `Payment blocked for review: ${riskAssessment.riskReasons.join(', ')}`,
      );
    }

    const alatProfile = await this.getActiveAlatProfileIfNeeded(
      provider,
      event.creatorId,
    );

    const metadata = {
      type: PaymentType.DONATION,
      amountUnit: 'KOBO',
      eventId,
      eventTitle: event.title,
      message,
      isAnonymous: isAnonymous || false,
      clientContext: this.serializeClientContext(dto.clientContext),
      pricing,
    };

    const transactionRef = await this.prisma.transactionReference.create({
      data: {
        userId,
        creatorId: event.creatorId,
        amount: pricing.chargeAmountKobo,
        status: this.getInitialPendingStatus(provider),
        eventId,
        platformFee: pricing.platformFeeKobo,
        providerFee: pricing.providerFeeKobo,
        creatorPayable: pricing.creatorPayableKobo,
        paymentProvider: provider,
        paymentType: PaymentType.DONATION,
        settlementStatus: riskAssessment.settlementStatus,
        riskStatus: riskAssessment.riskStatus,
        riskScore: riskAssessment.riskScore,
        riskReasons: riskAssessment.riskReasons,
        metadata: this.asInputJson(metadata),
      },
    });

    const providerInitResponse = await this.initializeProviderPayment({
      provider,
      userId,
      email,
      reference: transactionRef.id,
      amountKobo: pricing.chargeAmountKobo,
      eventTitle: event.title,
      eventId,
      paymentType: PaymentType.DONATION,
      creatorId: event.creatorId,
      alatProfile,
    });

    await this.prisma.transactionReference.update({
      where: { id: transactionRef.id },
      data: {
        ...(providerInitResponse.providerReference
          ? { providerReference: providerInitResponse.providerReference }
          : {}),
        ...(providerInitResponse.providerPayload
          ? {
              providerPayload: this.asInputJson(
                providerInitResponse.providerPayload,
              ),
            }
          : {}),
        metadata: this.asInputJson({
          ...metadata,
          providerInstructions: providerInitResponse.instructions || null,
        }),
      },
    });

    return {
      message: providerInitResponse.message || 'Transaction initialized',
      status: providerInitResponse.status ?? true,
      transactionId: transactionRef.id,
      paymentProvider: provider,
      paymentUrl: providerInitResponse.paymentUrl,
      paymentInstructions: providerInitResponse.instructions || null,
      totalAmount: pricing.chargeAmountNaira,
      totalAmountKobo: pricing.chargeAmountKobo,
      amountInNaira: amount,
      pricing,
      settlementStatus: riskAssessment.settlementStatus,
      riskStatus: riskAssessment.riskStatus,
      event: {
        id: event.id,
        title: event.title,
      },
    };
  }

  async verifyPayment(payload: any, signature: string, rawBody?: Buffer) {
    const secret = process.env.PAYSTACK_SECRET_KEY;

    console.log(payload, signature);

    if (!secret) {
      throw new InternalServerErrorException(
        'Paystack secret key not configured',
      );
    }

    const computedSignature = crypto
      .createHmac('sha512', secret)
      .update(rawBody ?? JSON.stringify(payload))
      .digest('hex');

    const safeCompare =
      signature &&
      computedSignature.length === signature.length &&
      crypto.timingSafeEqual(
        Buffer.from(computedSignature, 'utf8'),
        Buffer.from(signature, 'utf8'),
      );

    if (!safeCompare) {
      throw new UnauthorizedException('Invalid Paystack signature');
    }

    if (payload?.event && payload.event !== 'charge.success') {
      return {
        message: `Ignored Paystack event ${payload.event}`,
      };
    }

    const reference = payload?.data?.reference;
    if (!reference) {
      console.log(' bad request ');
      throw new BadRequestException('Missing Paystack reference');
    }

    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: reference },
      include: {
        user: true,
        event: {
          select: {
            id: true,
            title: true,
            creatorId: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new BadRequestException('Invalid transaction reference');
    }

    if (transaction.status === TransactionStatusType.SUCCESS) {
      return {
        message: 'Payment already processed',
      };
    }

    if (transaction.status === TransactionStatusType.FAILED) {
      throw new BadRequestException('Transaction already failed');
    }

    const providerAmount = Number(payload?.data?.amount || 0);
    const normalizedAmount = this.resolveProviderAmountKobo(
      transaction,
      providerAmount,
    );

    const paystackResponse =
      await this.paystackService.verifyTransaction(reference);

    if (
      !paystackResponse?.status ||
      paystackResponse.data?.status !== 'success'
    ) {
      await this.markTransactionFailed(transaction.id, {
        providerPayload: paystackResponse?.data || payload,
      });
      throw new BadRequestException('Payment verification failed');
    }

    const eventKey = `paystack:${payload?.event || 'charge.success'}:${reference}`;
    if (
      !(await this.registerWebhookEvent(
        PaymentProvider.PAYSTACK,
        eventKey,
        transaction.id,
        payload,
      ))
    ) {
      return {
        message: 'Webhook already processed',
      };
    }

    const actualProviderFee = Number(
      paystackResponse?.data?.fees || transaction.providerFee || 0,
    );

    return this.completeCollectedTransaction({
      transactionId: transaction.id,
      amountKobo: normalizedAmount,
      providerReference:
        paystackResponse?.data?.reference ||
        transaction.providerReference ||
        reference,
      providerPayload: paystackResponse?.data || payload,
      providerFeeKobo: actualProviderFee,
    });
  }

  async verifyAlatTransfer(
    payload: any,
    signature?: string,
    rawBody?: Buffer,
    opsKey?: string,
  ) {
    const signatureVerified = this.alatCollectionService.verifyWebhookSignature(
      rawBody,
      signature,
    );

    if (!signatureVerified) {
      this.assertOpsKey(opsKey);
    }

    const reference =
      payload?.reference ||
      payload?.data?.reference ||
      payload?.orderId ||
      payload?.data?.orderId ||
      payload?.transactionReference;
    const status = String(
      payload?.status ||
        payload?.data?.status ||
        payload?.transactionStatus ||
        'SUCCESS',
    ).toUpperCase();
    const providerAmount = Number(
      payload?.amountSent ||
        payload?.data?.amountSent ||
        payload?.amount ||
        payload?.data?.amount ||
        0,
    );
    const providerReference =
      payload?.transactionId ||
      payload?.data?.transactionId ||
      payload?.providerReference ||
      payload?.data?.providerReference ||
      null;

    if (!reference) {
      throw new BadRequestException('Missing ALAT reference');
    }

    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: reference },
      include: {
        user: true,
        event: {
          select: {
            id: true,
            title: true,
            creatorId: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new BadRequestException('Invalid transaction reference');
    }

    if (transaction.paymentProvider !== PaymentProvider.ALAT_TRANSFER) {
      throw new BadRequestException('Transaction is not an ALAT transfer');
    }

    if (transaction.status === TransactionStatusType.SUCCESS) {
      return {
        message: 'Payment already processed',
      };
    }

    const eventKey = `alat:${reference}:${status}:${providerReference || 'manual'}`;
    if (
      !(await this.registerWebhookEvent(
        PaymentProvider.ALAT_TRANSFER,
        eventKey,
        transaction.id,
        payload,
      ))
    ) {
      return {
        message: 'Webhook already processed',
      };
    }

    if (!['SUCCESS', 'PAID', 'COMPLETED'].includes(status)) {
      await this.markTransactionFailed(transaction.id, {
        providerReference,
        providerPayload: payload,
      });
      throw new BadRequestException('ALAT transfer verification failed');
    }

    const normalizedAmount = this.resolveProviderAmountKobo(
      transaction,
      providerAmount,
    );

    return this.completeCollectedTransaction({
      transactionId: transaction.id,
      amountKobo: normalizedAmount,
      providerReference: providerReference || transaction.providerReference,
      providerPayload: payload,
      providerFeeKobo: transaction.providerFee,
    });
  }

  async getRiskReviewQueue(dto: RiskReviewQueueQueryDto, opsKey?: string) {
    this.assertOpsKey(opsKey);

    const page = dto.page || 1;
    const pageSize = Math.min(dto.pageSize || 20, 50);
    const skip = (page - 1) * pageSize;
    const whereClause = this.buildRiskReviewQueueWhere(dto);

    const [transactions, total, reviewCount, holdCount, reviewedCount] =
      await Promise.all([
        this.prisma.transactionReference.findMany({
          where: whereClause,
          include: {
            user: {
              select: {
                id: true,
                username: true,
                fullName: true,
                email: true,
              },
            },
            creator: {
              select: {
                id: true,
                username: true,
                fullName: true,
              },
            },
            event: {
              select: {
                id: true,
                title: true,
                creatorId: true,
                creator: {
                  select: {
                    id: true,
                    username: true,
                    fullName: true,
                  },
                },
              },
            },
          },
          orderBy: [{ riskScore: 'desc' }, { createdAt: 'asc' }],
          skip,
          take: pageSize,
        }),
        this.prisma.transactionReference.count({
          where: whereClause,
        }),
        this.prisma.transactionReference.count({
          where: {
            ...whereClause,
            riskStatus: RiskStatus.REVIEW,
          },
        }),
        this.prisma.transactionReference.count({
          where: {
            ...whereClause,
            riskStatus: RiskStatus.HOLD,
          },
        }),
        this.prisma.transactionReference.count({
          where: {
            ...whereClause,
            reviewedAt: {
              not: null,
            },
          },
        }),
      ]);

    return {
      data: transactions.map((transaction) =>
        this.formatRiskQueueTransaction(transaction),
      ),
      total,
      page,
      pageSize,
      summary: {
        reviewCount,
        holdCount,
        reviewedCount,
      },
    };
  }

  async reviewTransactionRisk(
    transactionId: string,
    dto: ReviewTransactionRiskDto,
    opsKey?: string,
  ) {
    this.assertOpsKey(opsKey);

    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: transactionId },
      include: {
        event: {
          select: {
            creatorId: true,
            id: true,
            title: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (transaction.status === TransactionStatusType.FAILED) {
      throw new BadRequestException('Cannot review a failed transaction');
    }

    const lockedSettlementStatuses: SettlementStatus[] = [
      SettlementStatus.PROCESSING,
      SettlementStatus.SETTLED,
      SettlementStatus.FAILED,
    ];
    if (lockedSettlementStatuses.includes(transaction.settlementStatus)) {
      throw new BadRequestException(
        'Cannot review a transaction after settlement processing has started',
      );
    }

    const nextRiskStatus = dto.riskStatus as RiskStatus;
    if (!this.isReviewableRiskStatus(nextRiskStatus)) {
      throw new BadRequestException('Invalid review risk status');
    }

    const creatorId =
      transaction.creatorId || transaction.event?.creatorId || null;
    const nextSettlementStatus = await this.resolveSettlementStatus(
      creatorId,
      nextRiskStatus,
    );
    const reviewedAt = new Date();
    const metadata = this.getMetadataObject(transaction.metadata);
    const reviewRecord = this.buildManualRiskReviewRecord(
      transaction.riskStatus,
      nextRiskStatus,
      transaction.settlementStatus,
      nextSettlementStatus,
      dto.note,
      reviewedAt,
    );
    const riskReviewHistory = this.getRiskReviewHistory(metadata);

    const updatedTransaction = await this.prisma.transactionReference.update({
      where: { id: transactionId },
      data: {
        riskStatus: nextRiskStatus,
        settlementStatus: nextSettlementStatus,
        reviewedAt,
        metadata: this.asInputJson({
          ...metadata,
          lastRiskReview: reviewRecord,
          riskReviewHistory: [...riskReviewHistory, reviewRecord],
        }),
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    return this.buildRiskReviewResponse(updatedTransaction);
  }

  async getTransactionStatus(id: string) {
    let transaction = await this.prisma.transactionReference.findUnique({
      where: { id },
      include: {
        event: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (this.shouldRefreshAlatTransactionStatus(transaction)) {
      transaction =
        (await this.refreshPendingAlatTransactionStatus(id)) || transaction;
    }

    return {
      id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      amountInNaira: transaction.amount / 100,
      chargedAmount: transaction.amount,
      chargedAmountInNaira: transaction.amount / 100,
      baseAmount:
        Number(
          (transaction.metadata as Record<string, any>)?.pricing
            ?.grossAmountKobo || 0,
        ) || transaction.amount,
      baseAmountInNaira:
        (Number(
          (transaction.metadata as Record<string, any>)?.pricing
            ?.grossAmountKobo || 0,
        ) || transaction.amount) / 100,
      paymentProvider: transaction.paymentProvider,
      paymentType: transaction.paymentType,
      settlementStatus: transaction.settlementStatus,
      riskStatus: transaction.riskStatus,
      riskScore: transaction.riskScore,
      riskReasons: this.normalizeRiskReasons(transaction.riskReasons),
      reviewedAt: transaction.reviewedAt,
      riskReviewNote:
        this.extractLatestRiskReview(transaction.metadata)?.note || null,
      creatorPayable: transaction.creatorPayable,
      creatorPayableInNaira: transaction.creatorPayable / 100,
      platformFee: transaction.platformFee,
      platformFeeInNaira: transaction.platformFee / 100,
      providerFee: transaction.providerFee,
      providerFeeInNaira: transaction.providerFee / 100,
      metadata: transaction.metadata,
      event: transaction.event,
      createdAt: transaction.createdAt,
      fulfilledAt: transaction.fulfilledAt,
      settledAt: transaction.settledAt,
    };
  }

  async getTicketOrRegistrationByTrasactionId(
    transactionId: string,
    type: string,
  ) {
    if (type === 'TICKETS' || type === 'TICKET') {
      const tickets = await this.prisma.ticket.findMany({
        where: { transactionId },
        include: {
          eventTicket: {
            include: {
              event: {
                select: {
                  title: true,
                  startDate: true,
                  endDate: true,
                  thumbnailUrl: true,
                },
              },
            },
          },
        },
      });

      return tickets.map((ticket) => ({
        ...ticket,
        eventTicketType: ticket.eventTicket.type,
        event: ticket.eventTicket.event,
      }));
    }

    if (type === 'REGISTRATION') {
      const registrations = await this.prisma.registration.findMany({
        where: { transactionId },
        include: {
          event: {
            select: {
              title: true,
              startDate: true,
              endDate: true,
              thumbnailUrl: true,
            },
          },
        },
      });

      return registrations;
    }

    if (type === 'DONATION') {
      const donation = await this.prisma.donation.findFirst({
        where: { transactionId },
        include: {
          event: {
            select: {
              title: true,
              startDate: true,
              endDate: true,
              thumbnailUrl: true,
              description: true,
            },
          },
          user: {
            select: {
              id: true,
              fullName: true,
              profilePicUrl: true,
            },
          },
        },
      });

      if (!donation) {
        throw new NotFoundException('Donation not found for this transaction');
      }

      return {
        ...donation,
        amountInNaira: donation.amount / 100,
      };
    }
  }

  private async completeCollectedTransaction(input: {
    transactionId: string;
    amountKobo: number;
    providerReference?: string | null;
    providerPayload?: any;
    providerFeeKobo: number;
  }) {
    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: input.transactionId },
      include: {
        user: true,
        event: {
          select: {
            id: true,
            title: true,
            creatorId: true,
          },
        },
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    if (
      transaction.status !== TransactionStatusType.PENDING &&
      transaction.status !== TransactionStatusType.AWAITING_TRANSFER
    ) {
      return {
        message: 'Payment already processed',
      };
    }

    const metadata = this.getMetadataObject(transaction.metadata);
    const paymentType = this.resolvePaymentType(
      transaction.paymentType,
      metadata,
    );
    const creatorId =
      transaction.creatorId || transaction.event?.creatorId || null;
    const baseAmountKobo = this.resolveBaseAmountKobo(
      transaction.amount,
      metadata,
    );
    const finalizedPricing = this.buildPricingSummary(
      baseAmountKobo,
      transaction.paymentProvider,
      {
        chargeAmountKobo: input.amountKobo,
        providerFeeKobo: input.providerFeeKobo,
      },
    );
    const settlementStatus = await this.resolveSettlementStatus(
      creatorId,
      transaction.riskStatus,
    );

    let unavailableTickets: TicketAvailability[] = [];

    if (paymentType === PaymentType.REGISTRATION) {
      const sponsorship = metadata.sponsorship as
        | RegistrationSponsorshipMetadata
        | undefined;

      if (sponsorship?.beneficiaryType === 'SPONSORED') {
        await this.registrationService.recordSponsoredRegistration(
          metadata.eventId,
          transaction.userId,
          transaction.id,
          sponsorship.sponsorshipNote,
        );

        metadata.sponsorship = {
          ...sponsorship,
          status: 'PENDING_ASSIGNMENT',
        };
      } else {
        await this.registrationService.createRegistration(
          metadata.eventId,
          transaction.userId,
          transaction.id,
        );
      }
    } else if (paymentType === PaymentType.DONATION) {
      const donation = await this.donationService.createDonation(
        {
          eventId: metadata.eventId,
          amount: baseAmountKobo,
          message: metadata.message,
          isAnonymous: metadata.isAnonymous,
          transactionId: transaction.id,
        },
        transaction.userId,
        transaction.user.username ?? transaction.user.fullName ?? 'Someone',
      );

      metadata.donationId = donation.id;
      metadata.donationCreated = true;
    } else {
      const ticketItems = [
        ...(metadata.paidTickets || []),
        ...(metadata.freeTickets || []),
      ];

      if (ticketItems.length === 0) {
        throw new BadRequestException(
          'No ticket payload found for transaction',
        );
      }

      unavailableTickets =
        (await this.ticketService.create(
          transaction,
          ticketItems,
          metadata.eventId,
          transaction.user.username ?? transaction.user.fullName ?? 'customer',
        )) || [];

      metadata.unavailableTickets = unavailableTickets;
    }

    const updatedMetadata = {
      ...metadata,
      amountUnit: 'KOBO',
      pricing: {
        ...(metadata.pricing || {}),
        grossAmountKobo: finalizedPricing.grossAmountKobo,
        grossAmountNaira: finalizedPricing.grossAmountNaira,
        chargeAmountKobo: finalizedPricing.chargeAmountKobo,
        chargeAmountNaira: finalizedPricing.chargeAmountNaira,
        buyerFeeTotalKobo: finalizedPricing.buyerFeeTotalKobo,
        buyerFeeTotalNaira: finalizedPricing.buyerFeeTotalNaira,
        buyerProviderFeeKobo: finalizedPricing.buyerProviderFeeKobo,
        buyerPlatformFeeKobo: finalizedPricing.buyerPlatformFeeKobo,
        platformFeeKobo: finalizedPricing.platformFeeKobo,
        providerFeeKobo: finalizedPricing.providerFeeKobo,
        creatorPayableKobo: finalizedPricing.creatorPayableKobo,
        creatorPayableNaira: finalizedPricing.creatorPayableNaira,
      },
    };

    await this.prisma.transactionReference.update({
      where: { id: transaction.id },
      data: {
        amount: input.amountKobo,
        creatorId,
        status: TransactionStatusType.SUCCESS,
        platformFee: finalizedPricing.platformFeeKobo,
        providerFee: finalizedPricing.providerFeeKobo,
        creatorPayable: finalizedPricing.creatorPayableKobo,
        settlementStatus,
        providerReference: input.providerReference,
        providerPayload: input.providerPayload,
        fulfilledAt: new Date(),
        metadata: updatedMetadata,
      },
    });

    return {
      message:
        paymentType === PaymentType.DONATION
          ? 'Payment verified and donation recorded'
          : paymentType === PaymentType.REGISTRATION
            ? metadata.sponsorship?.beneficiaryType === 'SPONSORED'
              ? 'Payment verified and impact spot funded'
              : 'Payment verified and registration created'
            : 'Payment verified and tickets issued',
      unavailableTickets,
      settlementStatus,
      riskStatus: transaction.riskStatus,
    };
  }

  private buildRiskReviewResponse(transaction: any) {
    return {
      id: transaction.id,
      status: transaction.status,
      settlementStatus: transaction.settlementStatus,
      riskStatus: transaction.riskStatus,
      riskScore: transaction.riskScore,
      riskReasons: this.normalizeRiskReasons(transaction.riskReasons),
      reviewedAt: transaction.reviewedAt,
      riskReviewNote:
        this.extractLatestRiskReview(transaction.metadata)?.note || null,
      event: transaction.event || null,
      createdAt: transaction.createdAt,
      fulfilledAt: transaction.fulfilledAt,
    };
  }

  private formatRiskQueueTransaction(transaction: any) {
    const metadata =
      transaction.metadata &&
      typeof transaction.metadata === 'object' &&
      !Array.isArray(transaction.metadata)
        ? (transaction.metadata as Record<string, any>)
        : {};
    const grossAmountKobo = this.resolveBaseAmountKobo(
      transaction.amount,
      metadata,
    );
    const creatorPayableKobo =
      Number(metadata?.pricing?.creatorPayableKobo || 0) ||
      transaction.creatorPayable ||
      Math.max(
        grossAmountKobo - transaction.platformFee - transaction.providerFee,
        0,
      );
    const lastRiskReview = this.extractLatestRiskReview(transaction.metadata);
    const creator = transaction.creator ||
      transaction.event?.creator || {
        id: transaction.creatorId || transaction.event?.creatorId || null,
        username: null,
        fullName: null,
      };

    return {
      id: transaction.id,
      transactionStatus: transaction.status,
      paymentType: this.resolvePaymentType(transaction.paymentType, metadata),
      paymentProvider: transaction.paymentProvider,
      chargedAmount: transaction.amount / 100,
      grossAmount: grossAmountKobo / 100,
      creatorPayable: creatorPayableKobo / 100,
      settlementStatus: transaction.settlementStatus,
      riskStatus: transaction.riskStatus,
      riskScore: transaction.riskScore,
      riskReasons: this.normalizeRiskReasons(transaction.riskReasons),
      hasManualReview: Boolean(transaction.reviewedAt || lastRiskReview),
      reviewedAt: transaction.reviewedAt,
      riskReviewNote: lastRiskReview?.note || null,
      lastRiskReview,
      clientContext: metadata.clientContext || null,
      event: transaction.event
        ? {
            id: transaction.event.id,
            title: transaction.event.title,
          }
        : null,
      buyer: {
        id: transaction.userId,
        username: transaction.user?.username || null,
        fullName: transaction.user?.fullName || null,
        email: transaction.user?.email || null,
      },
      creator: {
        id: creator.id,
        username: creator.username || null,
        fullName: creator.fullName || null,
      },
      createdAt: transaction.createdAt,
      fulfilledAt: transaction.fulfilledAt,
    };
  }

  private async initializeProviderPayment(input: {
    provider: PaymentProvider;
    userId: string;
    email: string;
    reference: string;
    amountKobo: number;
    eventTitle?: string;
    eventId?: string;
    creatorId?: string;
    paymentType?: PaymentType;
    alatProfile?: {
      displayName?: string | null;
      businessId?: string | null;
      subaccountReference?: string | null;
    } | null;
  }): Promise<ProviderInitiationResult> {
    if (input.provider === PaymentProvider.PAYSTACK) {
      const paymentInitResponse: PaystackResponse =
        await this.paystackService.initializeTransaction({
          email: input.email,
          amount: input.amountKobo,
          reference: input.reference,
          callback_url:
            process.env.PAYSTACK_CALLBACK_URL || 'https://yourcallback.com',
          metadata: {
            cancel_action:
              process.env.PAYSTACK_CANCEL_URL || 'https://your-cancel-url.com',
          },
        });

      return {
        message: paymentInitResponse.message,
        status: paymentInitResponse.status,
        paymentUrl: paymentInitResponse.data?.authorization_url || null,
        providerReference:
          paymentInitResponse.data?.reference || input.reference,
        providerPayload: paymentInitResponse.data || null,
        instructions: null,
      };
    }

    const customer = await this.buildAlatCustomerProfile(
      input.userId,
      input.email,
      {
        eventId: input.eventId,
        paymentType: input.paymentType,
        creatorId: input.creatorId,
        reference: input.reference,
      },
    );

    return this.alatCollectionService.initializeTransfer({
      reference: input.reference,
      amountKobo: input.amountKobo,
      businessId: input.alatProfile?.businessId || '',
      eventTitle: input.eventTitle,
      displayName: input.alatProfile?.displayName,
      customer,
    });
  }

  private async assessRisk(input: {
    buyerId: string;
    creatorId: string;
    eventId: string;
    grossAmountKobo: number;
    clientContext?: PaymentClientContextDto;
  }): Promise<RiskAssessment> {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const largePaymentKobo = Number(
      process.env.RISK_LARGE_PAYMENT_KOBO || 10000000,
    );
    const reviewThreshold = Number(process.env.RISK_REVIEW_THRESHOLD || 35);
    const holdThreshold = Number(process.env.RISK_HOLD_THRESHOLD || 60);
    const buyerReviewVelocity = Number(
      process.env.RISK_BUYER_REVIEW_ATTEMPTS_PER_HOUR || 4,
    );
    const buyerBlockVelocity = Number(
      process.env.RISK_BUYER_BLOCK_ATTEMPTS_PER_HOUR || 8,
    );
    const unverifiedExposureCap = Number(
      process.env.UNVERIFIED_CREATOR_HOLD_LIMIT_KOBO || 50000000,
    );

    const [
      buyer,
      creator,
      settlementProfile,
      recentBuyerAttempts,
      recentCreatorSales,
      creatorExposure,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: input.buyerId },
        select: { createdAt: true },
      }),
      this.prisma.user.findUnique({
        where: { id: input.creatorId },
        select: { createdAt: true },
      }),
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId: input.creatorId },
        select: { status: true },
      }),
      this.prisma.transactionReference.count({
        where: {
          userId: input.buyerId,
          eventId: input.eventId,
          createdAt: { gte: oneHourAgo },
          status: {
            in: [
              TransactionStatusType.PENDING,
              TransactionStatusType.AWAITING_TRANSFER,
              TransactionStatusType.SUCCESS,
            ],
          },
        },
      }),
      this.prisma.transactionReference.count({
        where: {
          creatorId: input.creatorId,
          createdAt: { gte: oneDayAgo },
          status: TransactionStatusType.SUCCESS,
        },
      }),
      this.prisma.transactionReference.aggregate({
        _sum: { creatorPayable: true },
        where: {
          creatorId: input.creatorId,
          status: TransactionStatusType.SUCCESS,
          settlementStatus: {
            in: [
              SettlementStatus.HELD_KYC,
              SettlementStatus.HELD_RISK,
              SettlementStatus.READY,
              SettlementStatus.PROCESSING,
            ],
          },
        },
      }),
    ]);

    let riskScore = 0;
    const riskReasons: string[] = [];
    const payoutActive =
      settlementProfile?.status === CreatorSettlementProfileStatus.ACTIVE;

    if (!buyer || !creator) {
      return {
        riskScore: 100,
        riskStatus: RiskStatus.BLOCKED,
        riskReasons: ['missing_buyer_or_creator'],
        settlementStatus: SettlementStatus.HELD_RISK,
      };
    }

    if (input.buyerId === input.creatorId) {
      riskScore += 25;
      riskReasons.push('creator_self_purchase');
    }

    if (input.grossAmountKobo >= largePaymentKobo) {
      riskScore += 20;
      riskReasons.push('large_payment');
    }

    if (buyer.createdAt > oneDayAgo) {
      riskScore += 10;
      riskReasons.push('new_buyer_account');
    }

    if (creator.createdAt > oneDayAgo) {
      riskScore += 15;
      riskReasons.push('new_creator_account');
    }

    if (recentBuyerAttempts >= buyerReviewVelocity) {
      riskScore += 25;
      riskReasons.push('buyer_velocity_same_event');
    }

    if (recentBuyerAttempts >= buyerBlockVelocity) {
      riskReasons.push('buyer_velocity_block');
      return {
        riskScore: 100,
        riskStatus: RiskStatus.BLOCKED,
        riskReasons,
        settlementStatus: SettlementStatus.HELD_RISK,
      };
    }

    if (recentCreatorSales >= 30) {
      riskScore += 15;
      riskReasons.push('creator_sales_spike');
    }

    if (input.clientContext?.deviceId) {
      riskReasons.push(`device:${input.clientContext.deviceId}`);
    }

    const unsettledExposure = creatorExposure._sum.creatorPayable || 0;
    if (
      !payoutActive &&
      unsettledExposure + input.grossAmountKobo > unverifiedExposureCap
    ) {
      return {
        riskScore: 100,
        riskStatus: RiskStatus.BLOCKED,
        riskReasons: [...riskReasons, 'unverified_creator_exposure_cap'],
        settlementStatus: SettlementStatus.HELD_KYC,
      };
    }

    if (!payoutActive) {
      riskReasons.push('creator_kyc_pending');
      return {
        riskScore,
        riskStatus: RiskStatus.HOLD,
        riskReasons,
        settlementStatus: SettlementStatus.HELD_KYC,
      };
    }

    if (riskScore >= holdThreshold) {
      return {
        riskScore,
        riskStatus: RiskStatus.HOLD,
        riskReasons,
        settlementStatus: SettlementStatus.HELD_RISK,
      };
    }

    if (riskScore >= reviewThreshold) {
      return {
        riskScore,
        riskStatus: RiskStatus.REVIEW,
        riskReasons,
        settlementStatus: SettlementStatus.HELD_RISK,
      };
    }

    return {
      riskScore,
      riskStatus: RiskStatus.CLEAR,
      riskReasons,
      settlementStatus: SettlementStatus.READY,
    };
  }

  private async resolveSettlementStatus(
    creatorId: string | null,
    riskStatus: RiskStatus,
  ) {
    if (!creatorId) {
      return SettlementStatus.NOT_READY;
    }

    const settlementProfile =
      await this.prisma.creatorSettlementProfile.findUnique({
        where: { userId: creatorId },
        select: { status: true },
      });

    if (settlementProfile?.status !== CreatorSettlementProfileStatus.ACTIVE) {
      return SettlementStatus.HELD_KYC;
    }

    if (riskStatus === RiskStatus.CLEAR) {
      return SettlementStatus.READY;
    }

    return SettlementStatus.HELD_RISK;
  }

  private buildPricingSummary(
    grossAmountKobo: number,
    provider: PaymentProvider,
    overrides?: {
      chargeAmountKobo?: number;
      providerFeeKobo?: number;
    },
  ) {
    return buildPricingSummary(grossAmountKobo, provider, overrides);
  }

  private calculatePlatformFeeKobo(grossAmountKobo: number) {
    return calculatePlatformFeeKobo(grossAmountKobo);
  }

  private estimateProviderFeeKobo(
    provider: PaymentProvider,
    grossAmountKobo: number,
  ) {
    return buildPricingSummary(grossAmountKobo, provider).providerFeeKobo;
  }

  private getPlatformFeeBps() {
    return getPlatformFeeBps();
  }

  private resolveProviderAmountKobo(transaction: any, providerAmount: number) {
    if (!providerAmount) {
      throw new BadRequestException('Missing provider amount');
    }

    if (providerAmount === transaction.amount) {
      return providerAmount;
    }

    if (providerAmount * 100 === transaction.amount) {
      return transaction.amount;
    }

    if (providerAmount === transaction.amount * 100) {
      return providerAmount;
    }

    throw new BadRequestException('Amount mismatch');
  }

  private shouldRefreshAlatTransactionStatus(transaction: {
    paymentProvider: PaymentProvider;
    status: TransactionStatusType;
    providerReference?: string | null;
    providerPayload?: any;
  }) {
    const pendingStatuses: TransactionStatusType[] = [
      TransactionStatusType.PENDING,
      TransactionStatusType.AWAITING_TRANSFER,
    ];

    return (
      transaction.paymentProvider === PaymentProvider.ALAT_TRANSFER &&
      pendingStatuses.includes(transaction.status) &&
      Boolean(this.extractAlatProviderReference(transaction))
    );
  }

  private async refreshPendingAlatTransactionStatus(transactionId: string) {
    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: transactionId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            creatorId: true,
          },
        },
      },
    });

    if (!transaction) {
      return null;
    }

    if (!this.shouldRefreshAlatTransactionStatus(transaction)) {
      return this.getTransactionWithEvent(transactionId);
    }

    const alatTransactionId = this.extractAlatProviderReference(transaction);
    if (!alatTransactionId) {
      return this.getTransactionWithEvent(transactionId);
    }

    try {
      const providerStatus =
        await this.alatCollectionService.getTransactionStatus(
          alatTransactionId,
        );
      const normalizedStatus = String(
        providerStatus.status || '',
      ).toUpperCase();

      if (!normalizedStatus || this.isPendingAlatStatus(normalizedStatus)) {
        await this.prisma.transactionReference.update({
          where: { id: transaction.id },
          data: {
            providerPayload: providerStatus.payload,
          },
        });
        return this.getTransactionWithEvent(transactionId);
      }

      const eventKey = `alat:${transaction.id}:${normalizedStatus}:${
        providerStatus.providerReference || alatTransactionId
      }`;

      if (
        !(await this.registerWebhookEvent(
          PaymentProvider.ALAT_TRANSFER,
          eventKey,
          transaction.id,
          providerStatus.payload,
        ))
      ) {
        return this.getTransactionWithEvent(transactionId);
      }

      if (this.isSuccessfulAlatStatus(normalizedStatus)) {
        const resolvedAmountKobo =
          providerStatus.amountKobo && providerStatus.amountKobo > 0
            ? this.resolveProviderAmountKobo(
                transaction,
                providerStatus.amountKobo,
              )
            : transaction.amount;

        await this.completeCollectedTransaction({
          transactionId: transaction.id,
          amountKobo: resolvedAmountKobo,
          providerReference:
            providerStatus.providerReference || transaction.providerReference,
          providerPayload: providerStatus.payload,
          providerFeeKobo:
            providerStatus.feeAmountKobo && providerStatus.feeAmountKobo > 0
              ? providerStatus.feeAmountKobo
              : transaction.providerFee,
        });
      } else if (this.isFailedAlatStatus(normalizedStatus)) {
        await this.markTransactionFailed(transaction.id, {
          providerReference:
            providerStatus.providerReference || transaction.providerReference,
          providerPayload: providerStatus.payload,
        });
      } else {
        await this.prisma.transactionReference.update({
          where: { id: transaction.id },
          data: {
            providerPayload: providerStatus.payload,
          },
        });
      }
    } catch (error) {
      if (!(error instanceof BadGatewayException)) {
        throw error;
      }
    }

    return this.getTransactionWithEvent(transactionId);
  }

  private extractAlatProviderReference(transaction: {
    providerReference?: string | null;
    providerPayload?: any;
  }) {
    return (
      transaction.providerReference ||
      transaction.providerPayload?.data?.transactionId ||
      transaction.providerPayload?.transactionId ||
      null
    );
  }

  private isSuccessfulAlatStatus(status: string) {
    return ['SUCCESS', 'SUCCESSFUL', 'PAID', 'COMPLETED'].includes(status);
  }

  private isFailedAlatStatus(status: string) {
    return [
      'FAILED',
      'FAIL',
      'EXPIRED',
      'CANCELLED',
      'REVERSED',
      'DECLINED',
    ].includes(status);
  }

  private isPendingAlatStatus(status: string) {
    return ['PENDING', 'PROCESSING', 'INITIATED', 'AWAITING_PAYMENT'].includes(
      status,
    );
  }

  private async getTransactionWithEvent(id: string) {
    return this.prisma.transactionReference.findUnique({
      where: { id },
      include: {
        event: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });
  }

  private async registerWebhookEvent(
    provider: PaymentProvider,
    eventKey: string,
    transactionReferenceId: string,
    payload: any,
  ) {
    try {
      await this.prisma.providerWebhookEvent.create({
        data: {
          provider,
          eventKey,
          transactionReferenceId,
          payload,
        },
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false;
      }
      throw error;
    }
  }

  private async markTransactionFailed(
    transactionId: string,
    input: {
      providerReference?: string | null;
      providerPayload?: any;
    },
  ) {
    await this.prisma.transactionReference.update({
      where: { id: transactionId },
      data: {
        status: TransactionStatusType.FAILED,
        settlementStatus: SettlementStatus.FAILED,
        providerReference: input.providerReference,
        providerPayload: input.providerPayload,
      },
    });
  }

  private resolvePaymentProvider(provider?: PaymentProviderDto) {
    if (provider === PaymentProviderDto.ALAT_TRANSFER) {
      return PaymentProvider.ALAT_TRANSFER;
    }

    return PaymentProvider.PAYSTACK;
  }

  private resolvePaymentType(
    paymentType: PaymentType | null,
    metadata: Record<string, any>,
  ) {
    if (paymentType) {
      return paymentType;
    }

    if (metadata.type === 'REGISTRATION') {
      return PaymentType.REGISTRATION;
    }

    if (metadata.type === 'DONATION') {
      return PaymentType.DONATION;
    }

    return PaymentType.TICKET;
  }

  private getInitialPendingStatus(provider: PaymentProvider) {
    return provider === PaymentProvider.ALAT_TRANSFER
      ? TransactionStatusType.AWAITING_TRANSFER
      : TransactionStatusType.PENDING;
  }

  private getNoRiskAssessment(): RiskAssessment {
    return {
      riskScore: 0,
      riskStatus: RiskStatus.CLEAR,
      riskReasons: [],
      settlementStatus: SettlementStatus.NOT_READY,
    };
  }

  private toKobo(amount: number) {
    return Math.round(amount * 100);
  }

  private normalizeRegistrationBeneficiaryType(
    value?: string | null,
  ): RegistrationBeneficiaryType {
    if (!value || value === 'SELF') {
      return 'SELF';
    }

    if (value === 'SPONSORED') {
      return 'SPONSORED';
    }

    throw new BadRequestException('Invalid beneficiary type');
  }

  private buildRegistrationSponsorshipMetadata(input: {
    beneficiaryType: RegistrationBeneficiaryType;
    sponsorshipNote?: string | null;
    hasPendingPayment: boolean;
  }): RegistrationSponsorshipMetadata | null {
    if (input.beneficiaryType !== 'SPONSORED') {
      return null;
    }

    const sponsorshipNote = input.sponsorshipNote?.trim();

    return {
      beneficiaryType: 'SPONSORED',
      sponsorshipNote: sponsorshipNote || null,
      status: input.hasPendingPayment
        ? 'PENDING_PAYMENT'
        : 'PENDING_ASSIGNMENT',
    };
  }

  private buildRiskReviewQueueWhere(dto: RiskReviewQueueQueryDto) {
    const whereClause: Prisma.TransactionReferenceWhereInput = {
      riskStatus: dto.riskStatus
        ? (dto.riskStatus as RiskStatus)
        : {
            in: [RiskStatus.REVIEW, RiskStatus.HOLD],
          },
      status: dto.transactionStatus
        ? dto.transactionStatus
        : {
            in: [
              TransactionStatusType.PENDING,
              TransactionStatusType.AWAITING_TRANSFER,
              TransactionStatusType.SUCCESS,
            ],
          },
      ...(dto.settlementStatus && {
        settlementStatus: dto.settlementStatus as SettlementStatus,
      }),
      ...(dto.reviewed === true
        ? {
            reviewedAt: {
              not: null,
            },
          }
        : dto.reviewed === false
          ? {
              reviewedAt: null,
            }
          : {}),
    };

    return whereClause;
  }

  private getMetadataObject(metadata: Prisma.JsonValue) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new BadRequestException('Invalid metadata format');
    }

    return metadata as Record<string, any>;
  }

  private normalizeRiskReasons(
    riskReasons: Prisma.JsonValue | null | undefined,
  ) {
    if (!Array.isArray(riskReasons)) {
      return [];
    }

    return riskReasons.filter(
      (reason): reason is string => typeof reason === 'string',
    );
  }

  private extractLatestRiskReview(
    metadata: Prisma.JsonValue | null | undefined,
  ) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const candidate = (metadata as Record<string, any>).lastRiskReview;
    if (
      !candidate ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate)
    ) {
      return null;
    }

    return candidate as ManualRiskReviewRecord;
  }

  private getRiskReviewHistory(metadata: Record<string, any>) {
    if (!Array.isArray(metadata.riskReviewHistory)) {
      return [] as ManualRiskReviewRecord[];
    }

    return metadata.riskReviewHistory.filter(
      (review): review is ManualRiskReviewRecord =>
        Boolean(review) && typeof review === 'object' && !Array.isArray(review),
    );
  }

  private buildManualRiskReviewRecord(
    previousRiskStatus: RiskStatus,
    nextRiskStatus: RiskStatus,
    previousSettlementStatus: SettlementStatus,
    nextSettlementStatus: SettlementStatus,
    note: string | undefined,
    reviewedAt: Date,
  ): ManualRiskReviewRecord {
    return {
      reviewedAt: reviewedAt.toISOString(),
      reviewedBy: 'OPS',
      previousRiskStatus,
      nextRiskStatus,
      previousSettlementStatus,
      nextSettlementStatus,
      note: note?.trim() || null,
    };
  }

  private isReviewableRiskStatus(riskStatus: RiskStatus) {
    return [
      ReviewableRiskStatusDto.CLEAR,
      ReviewableRiskStatusDto.REVIEW,
      ReviewableRiskStatusDto.HOLD,
    ].includes(riskStatus as ReviewableRiskStatusDto);
  }

  private resolveBaseAmountKobo(
    chargedAmountKobo: number,
    metadata: Record<string, any>,
  ) {
    const baseAmountKobo = Number(metadata?.pricing?.grossAmountKobo || 0);
    return baseAmountKobo > 0 ? baseAmountKobo : chargedAmountKobo;
  }

  private serializeClientContext(
    clientContext?: PaymentClientContextDto | null,
  ) {
    if (!clientContext) {
      return null;
    }

    const serialized: Record<string, string> = {};

    if (clientContext.deviceId) {
      serialized.deviceId = clientContext.deviceId;
    }

    if (clientContext.platform) {
      serialized.platform = clientContext.platform;
    }

    return Object.keys(serialized).length > 0 ? serialized : null;
  }

  private asInputJson(value: unknown) {
    return value as Prisma.InputJsonValue;
  }

  private async getActiveAlatProfileIfNeeded(
    provider: PaymentProvider,
    creatorId: string,
  ) {
    if (provider !== PaymentProvider.ALAT_TRANSFER) {
      return null;
    }

    const [alatProfile, payoutProfile] = await Promise.all([
      this.prisma.creatorAlatProfile.findUnique({
        where: { userId: creatorId },
        select: {
          status: true,
          displayName: true,
          businessId: true,
          subaccountReference: true,
        },
      }),
      this.prisma.creatorSettlementProfile.findUnique({
        where: { userId: creatorId },
        select: {
          status: true,
        },
      }),
    ]);

    if (
      !alatProfile ||
      alatProfile.status !== CreatorAlatProfileStatus.ACTIVE ||
      !alatProfile.businessId ||
      payoutProfile?.status !== CreatorSettlementProfileStatus.ACTIVE
    ) {
      throw new BadRequestException(
        'ALAT transfer is not available for this event yet',
      );
    }

    return alatProfile;
  }

  private assertOpsKey(opsKey?: string) {
    const internalOpsKey = process.env.INTERNAL_OPS_KEY;

    if (!internalOpsKey || opsKey !== internalOpsKey) {
      throw new UnauthorizedException('Invalid ops key');
    }
  }

  private async buildAlatCustomerProfile(
    userId: string,
    email: string,
    metadata?: Record<string, unknown>,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        fullName: true,
        username: true,
        phoneNumber: true,
      },
    });

    const resolvedNames = this.resolveBuyerNames(
      user?.fullName || user?.username || email,
    );

    return {
      email,
      phone: user?.phoneNumber || null,
      firstName: resolvedNames.firstName,
      lastName: resolvedNames.lastName,
      metadata: {
        userId,
        ...(metadata || {}),
      },
    };
  }

  private resolveBuyerNames(identity?: string | null) {
    const rawValue = identity?.trim();
    if (!rawValue) {
      return {
        firstName: 'GatherGo',
        lastName: 'Buyer',
      };
    }

    const sanitized = rawValue.includes('@')
      ? rawValue.split('@')[0]
      : rawValue;
    const tokens = sanitized
      .split(/[\s._-]+/)
      .map((token) => token.trim())
      .filter(Boolean);

    if (tokens.length === 0) {
      return {
        firstName: 'GatherGo',
        lastName: 'Buyer',
      };
    }

    if (tokens.length === 1) {
      return {
        firstName: tokens[0],
        lastName: 'Buyer',
      };
    }

    return {
      firstName: tokens[0],
      lastName: tokens.slice(1).join(' '),
    };
  }
}
