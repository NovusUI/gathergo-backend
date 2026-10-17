import { Test } from '@nestjs/testing';
import { Prisma, RegistrationType, Reoccurring } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { PrismaService } from 'src/prisma/prisma.service';
import { CarpoolQueueService } from 'src/queue/carpool/queue.service';
import { DashboardService } from '../dashboard/services/dashboard.service';
import { EventTicketService } from '../event-ticket/event-ticket.service';
import { MediaService } from '../media/media.service';
import { CreateEventDto } from './dto/create-event.dto';
import { EventService } from './event.service';

describe('Event-first flows', () => {
  const prisma = {
    event: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
    carpool: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  let events: EventService;
  let dashboard: DashboardService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.carpool.count.mockResolvedValue(0);
    const module = await Test.createTestingModule({
      providers: [
        EventService,
        DashboardService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CarpoolQueueService,
          useValue: { addUpdateExpiryJob: jest.fn() },
        },
        { provide: EventTicketService, useValue: {} },
        { provide: MediaService, useValue: {} },
      ],
    }).compile();
    events = module.get(EventService);
    dashboard = module.get(DashboardService);
  });

  it('creates an event without adding an impact identity or map', async () => {
    const tx = {
      event: {
        create: jest
          .fn<Promise<{ id: string }>, [Prisma.EventCreateArgs]>()
          .mockResolvedValue({ id: 'comedy-1' }),
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await events.create(
      'user-1',
      plainToInstance(CreateEventDto, {
        title: 'Comedy Night',
        description: 'A night of stand-up comedy.',
        registrationType: 'registration',
        registrationAttendees: 50,
        registrationFee: 0,
        tags: ['Nightlife'],
        impactSdgGoals: [],
        impactPaths: [],
        impactCommitments: [],
        startDate: '2030-01-01T10:00:00.000Z',
        endDate: '2030-01-01T12:00:00.000Z',
      }),
    );

    expect(tx.event.create.mock.calls[0][0].data).toMatchObject({
      description: 'A night of stand-up comedy.',
      tags: ['Nightlife'],
      impactTitle: null,
      impactDescription: null,
      impactSdgGoals: Prisma.JsonNull,
      impactMapGeneratedAt: null,
    });
  });

  it('removes an impact story and map while preserving event interests', async () => {
    const tx = {
      event: {
        update: jest
          .fn<Promise<{ id: string }>, [Prisma.EventUpdateArgs]>()
          .mockResolvedValue({ id: 'event-1' }),
      },
    };
    prisma.event.findUnique.mockResolvedValue({
      id: 'event-1',
      creatorId: 'user-1',
      registrationType: RegistrationType.registration,
      registrationFee: 0,
      reoccurring: Reoccurring.NONE,
    });
    prisma.$transaction.mockImplementation(
      (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await events.update('user-1', 'event-1', {
      impactTitle: '',
      impactDescription: '',
      impactSdgGoals: [],
      impactPaths: [],
      impactCommitments: [],
      impactMapSource: '',
      tags: ['Music'],
    });

    expect(tx.event.update.mock.calls[0][0].data).toMatchObject({
      tags: ['Music'],
      impactTitle: null,
      impactDescription: null,
      impactSdgGoals: Prisma.JsonNull,
      impactPaths: Prisma.JsonNull,
      impactCommitments: Prisma.JsonNull,
      impactMapSource: null,
      impactMapGeneratedAt: null,
    });
  });

  it('features ordinary events first and keeps a separate impact spotlight', async () => {
    const generalEvent = {
      id: 'concert-1',
      title: 'Live Music',
      description: 'A night of live performances.',
      imageUrl: null,
      thumbnailUrl: null,
      impactTitle: null,
      impactDescription: null,
      registrationType: 'ticket',
    };
    const impactEvent = {
      ...generalEvent,
      id: 'workshop-1',
      title: 'Community Workshop',
      impactTitle: 'Skills for young people',
      impactDescription: 'Free skills training for local young people.',
    };
    prisma.event.findMany.mockImplementation(
      (args: Prisma.EventFindManyArgs) => {
        expect(args.where).not.toHaveProperty('OR');
        expect(args.where).toHaveProperty('endDate.gte');
        return Promise.resolve([generalEvent]);
      },
    );
    prisma.event.findFirst.mockResolvedValue(impactEvent);

    const cards = await dashboard.getHomeCards('user-1');

    expect(cards[0]).toEqual(
      expect.objectContaining({
        key: 'event',
        title: 'Live Music',
        body: generalEvent.description,
        route: '/event/concert-1',
      }),
    );
    expect(cards[1]).toEqual(
      expect.objectContaining({
        key: 'impact',
        body: impactEvent.impactDescription,
        route: '/event/workshop-1',
      }),
    );
  });

  it('does not fabricate an impact spotlight when no impact event exists', async () => {
    prisma.event.findMany.mockResolvedValue([]);
    prisma.event.findFirst.mockResolvedValue(null);

    const cards = await dashboard.getHomeCards('user-1');

    expect(cards.map((card) => card.key)).toEqual(['event', 'ride', 'circle']);
    expect(cards[0]).toEqual(
      expect.objectContaining({
        title: 'Find your next experience',
        route: null,
      }),
    );
  });
});
