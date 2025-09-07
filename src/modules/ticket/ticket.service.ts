import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import {nanoid} from 'nanoid'

@Injectable()
export class TicketService {
  constructor(private prisma: PrismaService) {}

  async create(eventTicketId: string, userId: string, dto: CreateTicketDto) {
    // TODO: Check eventTicket availability

    return this.prisma.ticket.create({
      data: {
        ...dto,
        eventTicketId,
        userId,
        qrCode: nanoid(16),
        transactionId: ""
      },
    });
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
