import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  IssuanceTransaction,
  PurchasedTicketItem,
} from '../checkout/checkout.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { generateOpaqueCode } from 'src/common/utils/generate-opaque-code.util';
import { NotificationService } from '../notification/notification.service';
import { notificationConstants } from 'src/common/constants';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class TicketService {
  private readonly logger = new Logger(TicketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly feedIntegrationService: FeedIntegrationService,
    private readonly mailService: MailService,
  ) {}

  async planIssuance(
    tx: Prisma.TransactionClient,
    transactionId: string,
    items: PurchasedTicketItem[],
  ) {
    const existing = await tx.ticket.findMany({ where: { transactionId } });
    return items.map((item) => {
      const alreadyIssued = existing.filter(
        (ticket) => ticket.eventTicketId === item.eventTicketId,
      ).length;
      if (alreadyIssued > item.quantity)
        throw new ConflictException(
          'Existing tickets exceed the checkout quantity; this purchase needs review.',
        );
      return {
        ...item,
        alreadyIssued,
        quantityToIssue: item.quantity - alreadyIssued,
      };
    });
  }

  async issue(
    tx: Prisma.TransactionClient,
    transaction: IssuanceTransaction,
    plan: Awaited<ReturnType<TicketService['planIssuance']>>,
  ) {
    const data = plan.flatMap((item) =>
      Array.from({ length: item.quantityToIssue }, (_, index) => ({
        eventTicketId: item.eventTicketId,
        userId: transaction.userId,
        transactionId: transaction.id,
        qrCode: generateOpaqueCode(16),
        fulfillmentKey: `${transaction.id}:${item.eventTicketId}:${item.alreadyIssued + index + 1}`,
      })),
    );
    if (data.length > 0) await tx.ticket.createMany({ data });
    return tx.ticket.findMany({ where: { transactionId: transaction.id } });
  }

  async notifyPurchase(transactionId: string) {
    const tickets = await this.prisma.ticket.findMany({
      where: { transactionId },
      include: {
        user: { select: { email: true, username: true, fullName: true } },
        eventTicket: {
          include: {
            event: {
              select: {
                id: true,
                title: true,
                startDate: true,
                location: true,
                thumbnailUrl: true,
                creatorId: true,
              },
            },
          },
        },
      },
    });
    if (tickets.length === 0) return;
    const { eventTicket, user } = tickets[0];
    const groups = new Map<
      string,
      { eventTicketId: string; ticketIds: string[]; quantity: number }
    >();
    for (const ticket of tickets) {
      const group = groups.get(ticket.eventTicketId) ?? {
        eventTicketId: ticket.eventTicketId,
        ticketIds: [],
        quantity: 0,
      };
      group.ticketIds.push(ticket.id);
      group.quantity += 1;
      groups.set(ticket.eventTicketId, group);
    }
    await this.feedIntegrationService.onTicketPurchaseBatch(
      eventTicket.event.id,
      tickets[0].userId,
      Array.from(groups.values()),
    );
    await this.notificationService.createNotification({
      recipientIds: [eventTicket.event.creatorId],
      title: notificationConstants.EVENT_TICKET_SALE_TITLE,
      message: notificationConstants.EVENT_TICKET_SALE_MESSAGE(
        this.resolveDisplayName(user),
      ),
      type: notificationConstants.EVENT_TICKET_SALE,
      imageUrl: eventTicket.event.thumbnailUrl || '',
      data: { eventId: eventTicket.event.id },
      link: '/event/' + eventTicket.event.id,
    });
    await Promise.all(
      tickets.map((ticket) =>
        this.queueTicketConfirmationEmail({
          purchaser: ticket.user,
          eventTicket: ticket.eventTicket,
          ticket,
        }),
      ),
    );
  }

  private async queueTicketConfirmationEmail(input: {
    purchaser: {
      email: string | null;
      username?: string | null;
      fullName?: string | null;
    } | null;
    eventTicket: {
      type: string;
      price: number;
      updatedPrice?: number | null;
      event?: {
        id: string;
        title: string;
        startDate: Date;
        location?: string | null;
        thumbnailUrl?: string | null;
      } | null;
    };
    ticket: {
      id: string;
      qrCode: string;
    };
  }) {
    const { purchaser, eventTicket, ticket } = input;

    if (!purchaser?.email || !eventTicket.event) {
      return;
    }

    try {
      const result = await this.mailService.sendTicketConfirmation({
        to: purchaser.email,
        jobId: `ticket-confirmation-${ticket.id}`,
        name: this.resolveDisplayName(purchaser),
        eventTitle: eventTicket.event.title,
        eventDate: eventTicket.event.startDate.toLocaleDateString(),
        venue: eventTicket.event.location || 'Online',
        ticketId: ticket.id,
        ticketType: eventTicket.type,
        price: Number(eventTicket.updatedPrice ?? eventTicket.price ?? 0),
        quantity: 1,
        eventImage: eventTicket.event.thumbnailUrl || undefined,
        qrCode: ticket.qrCode,
      });

      if (result.skipped) {
        this.logger.warn(
          `Skipped ticket confirmation email for ${purchaser.email}: ${result.reason}`,
        );
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'unknown mail error';
      this.logger.warn(
        `Failed to queue ticket confirmation email for ${purchaser.email}: ${reason}`,
      );
      throw error;
    }
  }

  private resolveDisplayName(user: {
    email?: string | null;
    username?: string | null;
    fullName?: string | null;
  }) {
    const preferredName = user.fullName?.trim() || user.username?.trim();
    if (preferredName) {
      return preferredName;
    }

    const emailLocalPart = user.email?.split('@')[0]?.trim();
    return emailLocalPart || 'there';
  }

  async getMyTickets(userId: string) {
    return this.prisma.ticket.findMany({
      where: { userId, status: 'active' },
      include: {
        eventTicket: {
          select: {
            id: true,
            type: true,
            price: true,
            updatedPrice: true,
            event: {
              select: {
                id: true,
                title: true,
                thumbnailUrl: true,
                startDate: true,
                endDate: true,
                location: true,
                registrationType: true,
                isPhysicalEvent: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async verifyTicket(qrCode: string, markAsUsed = true) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { qrCode },
      include: {
        eventTicket: {
          include: {
            event: true,
          },
        },
        user: true,
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.isUsed) {
      throw new BadRequestException('Ticket already used');
    }

    if (markAsUsed) {
      await this.prisma.ticket.update({
        where: { id: ticket.id },
        data: { isUsed: true, status: 'used', scannedAt: new Date() },
      });
    }

    return {
      message: 'Ticket verified successfully',
      ticketId: ticket.id,
      event: ticket.eventTicket.event,
      user: {
        id: ticket.user.id,
        name: ticket.user.username,
      },
    };
  }
}
