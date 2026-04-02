import { Reoccurring, RegistrationType } from '@prisma/client';
import { EventService } from './event.service';

describe('EventService', () => {
  const prisma = {
    event: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  } as any;
  const queueService = {
    addUpdateExpiryJob: jest.fn(),
  } as any;
  const eventTicketService = {} as any;
  const mediaService = {} as any;

  let service: EventService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new EventService(
      prisma,
      queueService,
      eventTicketService,
      mediaService,
    );
  });

  it('preserves registration pricing fields when editing unrelated details', async () => {
    const existingEvent = {
      id: 'event-1',
      creatorId: 'user-1',
      registrationType: RegistrationType.registration,
      registrationFee: 5000,
      registrationAttendees: 150,
      reoccurring: Reoccurring.NONE,
      endDate: new Date('2026-04-01T10:00:00.000Z'),
      imageUrl: null,
      thumbnailUrl: null,
    };
    const tx = {
      event: {
        update: jest.fn().mockResolvedValue({
          ...existingEvent,
          title: 'Updated title',
        }),
      },
      eventTicket: {
        findMany: jest.fn(),
      },
      creatorSettlementProfile: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma.event.findUnique.mockResolvedValue(existingEvent);
    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

    await service.update('user-1', 'event-1', {
      title: 'Updated title',
    } as any);

    const updateData = tx.event.update.mock.calls[0][0].data;

    expect(updateData.title).toBe('Updated title');
    expect(updateData.registrationFee).toBeUndefined();
    expect(updateData.registrationAttendees).toBeUndefined();
    expect(updateData.donationTarget).toBeUndefined();
  });

  it('normalizes event links on create and update', async () => {
    const createdEvent = { id: 'event-2' };
    const tx = {
      event: {
        create: jest.fn().mockResolvedValue(createdEvent),
        update: jest.fn().mockResolvedValue(createdEvent),
      },
      eventTicket: {
        findMany: jest.fn(),
      },
      creatorSettlementProfile: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    prisma.$transaction.mockImplementation(async (callback: any) => callback(tx));
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-2',
      creatorId: 'user-1',
      registrationType: RegistrationType.donation,
      reoccurring: Reoccurring.NONE,
      endDate: new Date('2026-04-01T10:00:00.000Z'),
      imageUrl: null,
      thumbnailUrl: null,
    });

    await service.create('user-1', {
      title: 'Impact Drive',
      description: 'Help us raise support',
      registrationType: RegistrationType.donation,
      donationTarget: 500000,
      startDate: '2026-04-01T10:00:00.000Z',
      endDate: '2026-04-02T10:00:00.000Z',
      links: [
        ' wa.me/1234567890 ',
        '',
        'x.com/gathergo',
      ],
    } as any);

    expect(tx.event.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          links: ['https://wa.me/1234567890', 'https://x.com/gathergo'],
        }),
      }),
    );

    await service.update('user-1', 'event-2', {
      links: [' instagram.com/gathergo ', ''],
    } as any);

    expect(tx.event.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          links: ['https://instagram.com/gathergo'],
        }),
      }),
    );
  });
});
