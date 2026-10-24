import { Test } from '@nestjs/testing';
import type { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { QuickAccessService } from './quick-access.service';

const currentEvent = {
  id: 'event-current',
  title: 'Community morning',
  registrationType: 'donation',
};
const otherEvent = {
  id: 'event-other',
  title: 'Weekend makers',
  registrationType: 'ticket',
  startDate: new Date('2035-11-12T10:00:00Z'),
};

describe('Dashboard Quick Access destinations', () => {
  const prisma = {
    event: {
      findUnique: jest.fn<
        Promise<typeof currentEvent | null>,
        [Prisma.EventFindUniqueArgs]
      >(),
      findMany: jest.fn<
        Promise<(typeof otherEvent)[]>,
        [Prisma.EventFindManyArgs]
      >(),
    },
  };
  let service: QuickAccessService;

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.event.findUnique.mockResolvedValue(currentEvent);
    prisma.event.findMany.mockResolvedValue([otherEvent]);
    const module = await Test.createTestingModule({
      providers: [
        QuickAccessService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(QuickAccessService);
  });

  it('links the current event and other owned events to their management details', async () => {
    const shortcuts = await service.getEventQuickAccess(
      'owner',
      currentEvent.id,
    );
    expect(shortcuts.map(({ id, link }) => ({ id, link }))).toEqual([
      { id: 'wallet', link: 'wallet' },
      { id: currentEvent.id, link: `dashboard/${currentEvent.id}` },
      { id: otherEvent.id, link: `dashboard/${otherEvent.id}` },
      { id: 'create-event', link: 'events/create' },
    ]);
    expect(prisma.event.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: currentEvent.id, creatorId: 'owner' },
      }),
    );
    expect(prisma.event.findMany.mock.calls[0][0].where).toMatchObject({
      creatorId: 'owner',
      id: { not: currentEvent.id },
    });
  });

  it('keeps the remaining shortcuts valid if the current event is unavailable', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    const shortcuts = await service.getEventQuickAccess(
      'owner',
      currentEvent.id,
    );
    expect(shortcuts.some(({ id }) => id === currentEvent.id)).toBe(false);
    expect(shortcuts.find(({ id }) => id === otherEvent.id)?.link).toBe(
      `dashboard/${otherEvent.id}`,
    );
  });

  it('still offers Wallet and Create Event when no owned events are available', async () => {
    prisma.event.findUnique.mockResolvedValue(null);
    prisma.event.findMany.mockResolvedValue([]);
    expect(
      (await service.getEventQuickAccess('owner', 'missing')).map(
        ({ link }) => link,
      ),
    ).toEqual(['wallet', 'events/create']);
  });

  it.each(['smart', 'random', 'letter'])(
    'keeps %s dashboard shortcuts on management detail pages',
    async (strategy) => {
      const shortcuts = await (strategy === 'smart'
        ? service.getQuickAccess('owner')
        : strategy === 'random'
          ? service.getQuickAccessRandom('owner')
          : service.getQuickAccessByLetter('owner'));
      expect(shortcuts.find(({ id }) => id === otherEvent.id)?.link).toBe(
        `dashboard/${otherEvent.id}`,
      );
      expect(shortcuts.find(({ id }) => id === 'wallet')?.link).toBe('wallet');
    },
  );
});
