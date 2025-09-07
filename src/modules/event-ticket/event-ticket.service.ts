import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateEventTicketDto } from './dto/create-event-ticket.dto';
import { UpdateEventTicketDto } from './dto/update-event-ticket.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class EventTicketService {
  constructor(private prisma: PrismaService) {}

  async create(eventId: string, userId: string, dto: CreateEventTicketDto) {
    // Check if event exists
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });
  
    if (!event) {
      throw new NotFoundException('Event not found');
    }
  
    // Check if the logged-in user is the owner of the event

    if (event.creatorId !== userId) {
      throw new ForbiddenException('You are not allowed to add tickets to this event');
    }
  
    return this.prisma.eventTicket.create({
      data: {
        ...dto,
        eventId,
      },
    });
  }


  async createMany(eventId: string, tickets: CreateEventTicketDto[], tx: Prisma.TransactionClient) {
    if (!tickets || tickets.length === 0) return;
  
    const data = tickets.map(ticket => ({
      ...ticket,
      eventId,
    }));
  
    await tx.eventTicket.createMany({ data });
  }
  

  async findAll(eventId: string) {
    return this.prisma.eventTicket.findMany({
      where: { eventId },
    });
  }
  

  async update(ticketId: string, userId: string, dto: UpdateEventTicketDto) {
    // Get ticket
    const ticket = await this.prisma.eventTicket.findUnique({
      where: { id: ticketId },
      include: { event: true },
    });
  
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
  
    // Check ownership
    if (ticket.event.creatorId !== userId) {
      throw new ForbiddenException('You are not allowed to update this ticket');
    }
  
    return this.prisma.eventTicket.update({
      where: { id: ticketId },
      data: dto,
    });
  }
  

  async remove(ticketId: string, userId: string) {
    // Get ticket
    const ticket = await this.prisma.eventTicket.findUnique({
      where: { id: ticketId },
      include: { event: true },
    });
  
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
  
    if (ticket.event.creatorId !== userId) {
      throw new ForbiddenException('You are not allowed to delete this ticket');
    }
  
    return this.prisma.eventTicket.delete({
      where: { id: ticketId },
    });
  }
  
}
