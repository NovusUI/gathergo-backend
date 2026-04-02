import { TicketService } from './ticket.service';

describe('TicketService', () => {
  const prisma = {
    eventTicket: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    ticket: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    event: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
  } as any;
  const notificationService = {
    createNotification: jest.fn(),
  } as any;
  const feedIntegrationService = {
    onTicketPurchaseBatch: jest.fn(),
  } as any;
  const mailService = {
    sendTicketConfirmation: jest.fn(),
  } as any;

  let service: TicketService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TicketService(
      prisma,
      notificationService,
      feedIntegrationService,
      mailService,
    );

    prisma.eventTicket.findUnique.mockResolvedValue({
      id: 'event-ticket-1',
      type: 'VIP',
      price: 5000,
      updatedPrice: null,
      quantity: 20,
      sold: 5,
      event: {
        id: 'event-1',
        title: 'Launch Party',
        startDate: new Date('2026-04-01T10:00:00.000Z'),
        location: 'Lagos',
        thumbnailUrl: 'https://example.com/event.jpg',
        creatorId: 'creator-1',
      },
    });
    prisma.ticket.createMany.mockResolvedValue({ count: 3 });
    prisma.ticket.findMany.mockResolvedValue([
      { id: 'ticket-1', qrCode: 'qr-1' },
      { id: 'ticket-2', qrCode: 'qr-2' },
      { id: 'ticket-3', qrCode: 'qr-3' },
    ]);
    prisma.eventTicket.update.mockResolvedValue({});
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      creatorId: 'creator-1',
      thumbnailUrl: 'https://example.com/event.jpg',
    });
    notificationService.createNotification.mockResolvedValue(undefined);
    feedIntegrationService.onTicketPurchaseBatch.mockResolvedValue(undefined);
    mailService.sendTicketConfirmation.mockResolvedValue({ skipped: false });
  });

  it('batches feed generation for multi-ticket purchases', async () => {
    const result = await service.create(
      {
        id: 'txn-1',
        userId: 'user-1',
        user: {
          email: 'buyer@example.com',
          username: 'buyer',
          fullName: 'Ada Buyer',
        },
      },
      [
        {
          eventTicketId: 'event-ticket-1',
          quantity: 3,
          ticketName: 'VIP',
        },
      ],
      'event-1',
      'buyer',
    );

    expect(result).toEqual([]);
    expect(feedIntegrationService.onTicketPurchaseBatch).toHaveBeenCalledTimes(1);
    expect(feedIntegrationService.onTicketPurchaseBatch).toHaveBeenCalledWith(
      'event-1',
      'user-1',
      [
        {
          eventTicketId: 'event-ticket-1',
          ticketIds: ['ticket-1', 'ticket-2', 'ticket-3'],
          quantity: 3,
        },
      ],
    );
    expect(notificationService.createNotification).toHaveBeenCalledTimes(1);
    expect(mailService.sendTicketConfirmation).toHaveBeenCalledTimes(3);
  });
});
