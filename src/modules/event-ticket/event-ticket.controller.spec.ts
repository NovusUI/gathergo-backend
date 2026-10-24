import {
  ExecutionContext,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { EventTicket } from '@prisma/client';
import type { Server } from 'http';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ResponseInterceptor } from '../../common/interceptors/response.interceptors';
import { PrismaService } from '../../prisma/prisma.service';
import { EventTicketController } from './event-ticket.controller';
import { EventTicketService } from './event-ticket.service';

const ticket: EventTicket = {
  id: 'ticket-1',
  eventId: 'event-1',
  type: 'General',
  description: 'General admission',
  price: 1500,
  quantity: 50,
  sold: 4,
  perks: [],
  isVisible: false,
  updatedPrice: null,
  createdAt: new Date('2035-01-01T00:00:00Z'),
  updatedAt: new Date('2035-01-01T00:00:00Z'),
};

describe('Event ticket publication', () => {
  let app: INestApplication<Server>;
  let userId = 'organiser';
  let authenticated = true;
  const tx = {
    $queryRaw: jest.fn(),
    eventTicket: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    eventTicket: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [EventTicketController],
      providers: [
        EventTicketService,
        { provide: PrismaService, useValue: prisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          context.switchToHttp().getRequest<{ user: { id: string } }>().user = {
            id: userId,
          };
          return authenticated;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalInterceptors(new ResponseInterceptor());
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    userId = 'organiser';
    authenticated = true;
    prisma.eventTicket.findUnique.mockResolvedValue({
      ...ticket,
      event: { creatorId: 'organiser' },
    });
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<EventTicket>) => callback(tx),
    );
    tx.$queryRaw.mockResolvedValue([{ id: ticket.eventId }]);
    tx.eventTicket.findUniqueOrThrow.mockResolvedValue(ticket);
    tx.eventTicket.update.mockResolvedValue({ ...ticket, isVisible: true });
  });

  it('publishes an existing ticket without editing its price, stock or details', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/event-tickets/ticket-1')
      .send({ isVisible: true })
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'success',
      message: 'Request successful',
      data: {
        ...ticket,
        isVisible: true,
        createdAt: ticket.createdAt.toISOString(),
        updatedAt: ticket.updatedAt.toISOString(),
      },
    });
    expect(tx.eventTicket.update).toHaveBeenCalledWith({
      where: { id: ticket.id },
      data: { isVisible: true },
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('can safely confirm publication again without changing sold or quantity', async () => {
    prisma.eventTicket.findUnique.mockResolvedValue({
      ...ticket,
      isVisible: true,
      event: { creatorId: 'organiser' },
    });
    const response = await request(app.getHttpServer())
      .patch('/api/v1/event-tickets/ticket-1')
      .send({ isVisible: true })
      .expect(200);
    expect(response.body).toMatchObject({
      data: { isVisible: true, quantity: 50, sold: 4 },
    });
    expect(tx.eventTicket.update).toHaveBeenCalledWith({
      where: { id: ticket.id },
      data: { isVisible: true },
    });
  });

  it('does not allow another user to publish an organiser’s ticket', async () => {
    userId = 'attendee';
    await request(app.getHttpServer())
      .patch('/api/v1/event-tickets/ticket-1')
      .send({ isVisible: true })
      .expect(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.eventTicket.update).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    authenticated = false;
    await request(app.getHttpServer())
      .patch('/api/v1/event-tickets/ticket-1')
      .send({ isVisible: true })
      .expect(403);
    expect(prisma.eventTicket.findUnique).not.toHaveBeenCalled();
  });

  it.each(['true', 'false', 1, {}, null])(
    'rejects non-boolean visibility (%j)',
    async (isVisible) => {
      await request(app.getHttpServer())
        .patch('/api/v1/event-tickets/ticket-1')
        .send({ isVisible })
        .expect(400);
      expect(prisma.eventTicket.findUnique).not.toHaveBeenCalled();
    },
  );

  it('keeps visibility optional for existing ticket edits', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/event-tickets/ticket-1')
      .send({ description: 'Updated admission details' })
      .expect(200);
    expect(tx.eventTicket.update).toHaveBeenCalledWith({
      where: { id: ticket.id },
      data: { description: 'Updated admission details' },
    });
  });

  it('returns not found for a missing ticket', async () => {
    prisma.eventTicket.findUnique.mockResolvedValue(null);
    await request(app.getHttpServer())
      .patch('/api/v1/event-tickets/missing')
      .send({ isVisible: true })
      .expect(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
