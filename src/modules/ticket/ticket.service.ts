import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { nanoid } from 'nanoid';
import { NotificationService } from '../notification/notification.service';
import { notificationConstants } from 'src/common/constants';

@Injectable()
export class TicketService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  async create(
    transaction: any,
    paidTickets: any[],
    eventId: string,
    username: string,
  ) {
    const unavailableTickets: {
      id: string;
      reason: string;
      ticketName: string;
    }[] = [];

    for (const item of paidTickets) {
      const eventTicket = await this.prisma.eventTicket.findUnique({
        where: { id: item.eventTicketId },
      });

      if (!eventTicket) {
        unavailableTickets.push({
          id: item.eventTicketId,
          reason: 'Ticket not found during verification',
          ticketName: item.ticketName,
        });
        continue;
      }

      const availableQty = Math.min(item.quantity, eventTicket.quantity);

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
          qrCode: nanoid(16),
          transactionId: transaction.id,
        })),
      });

      // Update stock
      await this.prisma.eventTicket.update({
        where: { id: item.eventTicketId },
        data: { sold: { increment: availableQty } },
      });

      if (availableQty < item.quantity) {
        unavailableTickets.push({
          id: item.eventTicketId,
          reason: `Only ${availableQty} issued out of ${item.quantity} requested`,
          ticketName: item.ticketName,
        });
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
          message: notificationConstants.EVENT_TICKET_SALE_MESSAGE(username),
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

  async getMyTickets(userId: string) {
    return this.prisma.ticket.findMany({
      where: { userId },
      include: {
        eventTicket: true,
      },
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
