import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { FoodBankCollectionStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { FoodBankService } from './food-bank.service';

const event = {
  id: 'bank',
  title: 'Community table',
  creatorId: 'organiser',
  registrationType: 'foodbank',
  startDate: new Date('2035-01-01T10:00:00Z'),
  endDate: new Date('2035-01-01T20:00:00Z'),
  foodBankTimeZone: 'Africa/Lagos',
  foodBankCollectionStatus: FoodBankCollectionStatus.NOT_STARTED,
  updatedAt: new Date('2034-12-01T10:00:00Z'),
};
const expectedUpdatedAt = event.updatedAt.toISOString();

describe('organiser collection management', () => {
  let service: FoodBankService;
  let now: Date;
  let committed: boolean;
  const tx = {
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn<
      Promise<number>,
      [TemplateStringsArray, number, number, string]
    >(),
    event: { findUnique: jest.fn(), update: jest.fn() },
    mealPass: { findMany: jest.fn() },
  };
  const notify = jest.fn();
  beforeEach(async () => {
    jest.clearAllMocks();
    now = new Date('2035-01-01T09:00:00Z');
    committed = false;
    tx.$queryRaw.mockImplementation((sql: TemplateStringsArray) =>
      Promise.resolve(
        sql[0].includes('clock_timestamp') ? [{ now }] : [{ id: event.id }],
      ),
    );
    tx.event.findUnique.mockResolvedValue(event);
    tx.event.update.mockImplementation(
      ({ data }: { data: Partial<typeof event> }) =>
        Promise.resolve({ ...event, ...data, updatedAt: now }),
    );
    tx.mealPass.findMany.mockResolvedValue([{ userId: 'recipient' }]);
    notify.mockResolvedValue([]);
    const module = await Test.createTestingModule({
      providers: [
        FoodBankService,
        {
          provide: PrismaService,
          useValue: {
            ...tx,
            $transaction: async (
              fn: (client: typeof tx) => Promise<object>,
            ) => {
              const result = await fn(tx);
              committed = true;
              return result;
            },
          },
        },
        {
          provide: NotificationService,
          useValue: { createNotification: notify },
        },
      ],
    }).compile();
    service = module.get(FoodBankService);
  });
  it.each([FoodBankCollectionStatus.OPEN, FoodBankCollectionStatus.CLOSED])(
    'lets the organiser set %s on the day before the planned start',
    async (status) => {
      const result = await service.updateCollection('organiser', event.id, {
        status,
        expectedUpdatedAt,
      });
      expect(result.status).toBe(status);
      expect(result.canManage).toBe(true);
      expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.event.findUnique.mock.invocationCallOrder[0],
      );
    },
  );
  it.each([FoodBankCollectionStatus.PAUSED, FoodBankCollectionStatus.CLOSED])(
    'can reopen from %s',
    async (status) => {
      tx.event.findUnique.mockResolvedValue({
        ...event,
        foodBankCollectionStatus: status,
      });
      expect(
        (
          await service.updateCollection('organiser', event.id, {
            status: 'OPEN',
            expectedUpdatedAt,
          })
        ).availability,
      ).toBe('open');
    },
  );
  it('pauses an open collection and rejects pausing one that never opened', async () => {
    await expect(
      service.updateCollection('organiser', event.id, {
        status: 'PAUSED',
        expectedUpdatedAt,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    tx.event.findUnique.mockResolvedValue({
      ...event,
      foodBankCollectionStatus: 'OPEN',
    });
    expect(
      (
        await service.updateCollection('organiser', event.id, {
          status: 'PAUSED',
          expectedUpdatedAt,
        })
      ).availability,
    ).toBe('paused');
  });
  it.each(['2034-12-31T22:59:59Z', '2035-01-01T23:00:00Z'])(
    'cannot open on another local day at %s',
    async (time) => {
      now = new Date(time);
      await expect(
        service.updateCollection('organiser', event.id, {
          status: 'OPEN',
          expectedUpdatedAt,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.event.update).not.toHaveBeenCalled();
    },
  );
  it('does not grant management to scanner staff or overwrite a newer change', async () => {
    await expect(
      service.updateCollection('staff', event.id, {
        status: 'OPEN',
        expectedUpdatedAt,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.updateCollection('organiser', event.id, {
        status: 'OPEN',
        expectedUpdatedAt: '2034-01-01T00:00:00Z',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.event.update).not.toHaveBeenCalled();
  });
  it('exposes operational state to attendees without management permission', async () => {
    const result = await service.collection('recipient', event.id);
    expect(result).toMatchObject({
      availability: 'not_started',
      canManage: false,
      canReserve: true,
      timeZone: 'Africa/Lagos',
    });
  });
  it('moves unused passes atomically, keeps their codes and sends holder notifications after commit', async () => {
    notify.mockImplementation(() => {
      expect(committed).toBe(true);
      return Promise.resolve([]);
    });
    const result = await service.reschedule('organiser', event.id, {
      startDate: '2035-01-02T10:00:00Z',
      expectedUpdatedAt,
    });
    expect(result.startDate.toISOString()).toBe('2035-01-02T10:00:00.000Z');
    expect(result.endDate.toISOString()).toBe('2035-01-02T20:00:00.000Z');
    expect(result.status).toBe('NOT_STARTED');
    const [sql, shiftStart, shiftEnd, eventId] = tx.$executeRaw.mock.calls[0];
    expect(sql.join('?')).toContain('"isUsed" = false');
    expect(sql.join('?')).not.toMatch(/"qrCode"|"isUsed" = true/);
    expect([shiftStart, shiftEnd, eventId]).toEqual([
      86_400_000,
      86_400_000,
      event.id,
    ]);
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientIds: ['recipient'],
        link: '/food-bank/bank',
        type: 'food_bank_rescheduled',
      }),
    );
    expect(result.notificationFailed).toBe(false);
  });
  it('does not reschedule an active collection, move it into a past day, or let another user change it', async () => {
    const dto = { startDate: '2035-01-02T10:00:00Z', expectedUpdatedAt };
    await expect(
      service.reschedule('staff', event.id, dto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.reschedule('organiser', event.id, {
        ...dto,
        startDate: '2034-12-31T10:00:00Z',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    tx.event.findUnique.mockResolvedValue({
      ...event,
      foodBankCollectionStatus: 'OPEN',
    });
    await expect(
      service.reschedule('organiser', event.id, dto),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it('does not shift or notify again for an unchanged schedule', async () => {
    await service.reschedule('organiser', event.id, {
      startDate: event.startDate.toISOString(),
      expectedUpdatedAt,
    });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
  it('reports notification failure without falsely reporting that the saved schedule failed', async () => {
    notify.mockRejectedValue(new Error('Push unavailable'));
    const log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const result = await service.reschedule('organiser', event.id, {
      startDate: '2035-01-02T10:00:00Z',
      expectedUpdatedAt,
    });
    expect(result.notificationFailed).toBe(true);
    expect(committed).toBe(true);
    log.mockRestore();
  });
});
