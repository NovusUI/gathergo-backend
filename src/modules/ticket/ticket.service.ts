import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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

  async create(
    transaction: any,
    paidTickets: any[],
    eventId: string,
    username?: string,
  ) {
    const purchaser = await this.resolvePurchaser(transaction);
    const saleActorName =
      username ||
      purchaser?.username ||
      purchaser?.fullName ||
      purchaser?.email?.split('@')[0] ||
      'customer';
    const unavailableTickets: {
      id: string;
      reason: string;
      ticketName: string;
    }[] = [];

    const ticketPurchaseFeedItems: {
      eventTicketId: string;
      ticketIds: string[];
      quantity: number;
    }[] = [];
    for (const item of paidTickets) {
      const eventTicket = await this.prisma.eventTicket.findUnique({
        where: { id: item.eventTicketId },
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
      });

      if (!eventTicket) {
        unavailableTickets.push({
          id: item.eventTicketId,
          reason: 'Ticket not found during verification',
          ticketName: item.ticketName,
        });
        continue;
      }

      const availableStock = Math.max(eventTicket.quantity - eventTicket.sold, 0);
      const availableQty = Math.min(item.quantity, availableStock);

      if (availableQty === 0) {
        unavailableTickets.push({
          id: item.eventTicketId,
          reason: 'Out of stock during verification',
          ticketName: item.ticketName,
        });
        continue;
      }

      // Create tickets
      await this.prisma.ticket.createMany({
        data: Array.from({ length: availableQty }).map(() => ({
          eventTicketId: item.eventTicketId,
          userId: transaction.userId,
          qrCode: generateOpaqueCode(16),
          transactionId: transaction.id,
        })),
      });

      // Get the created ticket IDs
      const createdTickets = await this.prisma.ticket.findMany({
        where: {
          eventTicketId: item.eventTicketId,
          userId: transaction.userId,
          transactionId: transaction.id,
        },
        orderBy: { createdAt: 'desc' },
        take: availableQty,
      });

      if (createdTickets.length > 0) {
        ticketPurchaseFeedItems.push({
          eventTicketId: item.eventTicketId,
          ticketIds: createdTickets.map((ticket) => ticket.id),
          quantity: createdTickets.length,
        });
      }

      // Update stock
      await this.prisma.eventTicket.update({
        where: { id: item.eventTicketId },
        data: { sold: { increment: availableQty } },
      });

      await Promise.all(
        createdTickets.map((ticket) =>
          this.queueTicketConfirmationEmail({
            purchaser,
            eventTicket,
            ticket,
          }),
        ),
      );

      if (availableQty < item.quantity) {
        unavailableTickets.push({
          id: item.eventTicketId,
          reason: `Only ${availableQty} issued out of ${item.quantity} requested`,
          ticketName: item.ticketName,
        });
      }
    }

    if (ticketPurchaseFeedItems.length > 0) {
      try {
        await this.feedIntegrationService.onTicketPurchaseBatch(
          eventId,
          transaction.userId,
          ticketPurchaseFeedItems,
        );
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : 'unknown feed error';
        this.logger.warn(
          `Failed to generate ticket purchase feed for event ${eventId}: ${reason}`,
        );
      }
    }

    try {
      const event = await this.prisma.event.findUnique({
        where: {
          id: eventId,
        },
      });

      if (!event) {
        throw new NotFoundException('event not found');
      }

      this.notificationService
        .createNotification({
          recipientIds: [event.creatorId],
          title: notificationConstants.EVENT_TICKET_SALE_TITLE,
          message: notificationConstants.EVENT_TICKET_SALE_MESSAGE(saleActorName),
          type: notificationConstants.EVENT_TICKET_SALE,
          imageUrl: event.thumbnailUrl || '',
          data: {
            eventId,
          },
          link: '/event/' + eventId,
        })
        .then(() => {});

      return unavailableTickets;
    } catch (error) {}
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
    }
  }

  private async resolvePurchaser(transaction: any) {
    if (transaction?.user?.email) {
      return transaction.user;
    }

    if (!transaction?.userId) {
      return null;
    }

    return this.prisma.user.findUnique({
      where: { id: transaction.userId },
      select: {
        email: true,
        username: true,
        fullName: true,
      },
    });
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
        data: { isUsed: true },
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
