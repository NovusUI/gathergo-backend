import { Reoccurring, RegistrationType } from '@prisma/client';
import { EventService } from './event.service';

describe('EventService', () => {
  const prisma = {
    event: {
      findUnique: jest.fn(),
    },
    eventImpactReport: {
      upsert: jest.fn(),
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
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'event-1' }]),
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
    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx),
    );

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
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'event-1' }]),
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

    prisma.$transaction.mockImplementation(async (callback: any) =>
      callback(tx),
    );
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
      links: [' wa.me/1234567890 ', '', 'x.com/gathergo'],
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

  it('submits a post-event impact report for the event creator', async () => {
    const report = { id: 'report-1', eventId: 'event-1' };

    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      creatorId: 'user-1',
      endDate: new Date('2020-01-01T10:00:00.000Z'),
    });
    prisma.eventImpactReport.upsert.mockResolvedValue(report);

    const result = await service.upsertImpactReport('user-1', 'event-1', {
      summary: 'We planted trees and cleaned the community.',
      outcomes: [
        {
          type: 'trees_planted',
          label: 'Trees planted',
          value: 25,
          unit: 'trees',
          note: 'Seedlings planted along the community road.',
        },
      ],
      evidenceLinks: [' instagram.com/gathergo '],
    });

    expect(result).toBe(report);
    expect(prisma.eventImpactReport.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventId: 'event-1' },
        create: expect.objectContaining({
          eventId: 'event-1',
          creatorId: 'user-1',
          summary: 'We planted trees and cleaned the community.',
          evidenceLinks: ['https://instagram.com/gathergo'],
          outcomes: [
            expect.objectContaining({
              type: 'trees_planted',
              label: 'Trees planted',
              value: 25,
              unit: 'trees',
            }),
          ],
        }),
        update: expect.objectContaining({
          summary: 'We planted trees and cleaned the community.',
        }),
      }),
    );
  });

  it('blocks impact reports from non-creators', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      creatorId: 'creator-1',
      endDate: new Date('2020-01-01T10:00:00.000Z'),
    });

    await expect(
      service.upsertImpactReport('user-1', 'event-1', {
        summary: 'We planted trees and cleaned the community.',
        outcomes: [
          {
            type: 'trees_planted',
            label: 'Trees planted',
            value: 25,
            unit: 'trees',
          },
        ],
      }),
    ).rejects.toThrow('Only the event creator can report impact');

    expect(prisma.eventImpactReport.upsert).not.toHaveBeenCalled();
  });

  it('blocks impact reports before the event ends', async () => {
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      creatorId: 'user-1',
      endDate: new Date(Date.now() + 60 * 60 * 1000),
    });

    await expect(
      service.upsertImpactReport('user-1', 'event-1', {
        summary: 'We planted trees and cleaned the community.',
        outcomes: [
          {
            type: 'trees_planted',
            label: 'Trees planted',
            value: 25,
            unit: 'trees',
          },
        ],
      }),
    ).rejects.toThrow(
      'Impact report can only be submitted after the event has ended',
    );

    expect(prisma.eventImpactReport.upsert).not.toHaveBeenCalled();
  });
});
