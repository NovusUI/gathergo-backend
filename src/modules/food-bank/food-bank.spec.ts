import type { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FoodBankService } from './food-bank.service';
import { NotificationService } from '../notification/notification.service';
import { nextCollectionWindow } from './collection-windows';
import { assertFoodBankSettings } from './food-bank-settings';

const settings = {
  registrationType: 'foodbank',
  isPhysicalEvent: true,
  reoccurring: 'NONE',
  startDate: new Date('2035-01-01T10:00:00Z'),
  endDate: new Date('2035-01-01T20:00:00Z'),
  foodBankCollectionStatus: 'OPEN',
  foodBankTimeZone: 'Africa/Lagos',
  foodBankTotalMeals: 1000,
  foodBankSlotCapacity: 25,
  foodBankSlotMinutes: 15,
};

describe('food bank collection allocation', () => {
  it('spreads 1,000 claims across capped windows without exceeding meals', () => {
    const reservations: { collectionStart: Date; count: number }[] = [];
    for (let i = 0; i < 1000; i++) {
      const slot = nextCollectionWindow(
        settings,
        reservations,
        new Date('2034-12-31'),
      );
      expect(slot).not.toBeNull();
      const existing = reservations.find(
        (item) => item.collectionStart.getTime() === slot!.start.getTime(),
      );
      if (existing) existing.count++;
      else reservations.push({ collectionStart: slot!.start, count: 1 });
    }
    expect(reservations).toHaveLength(40);
    expect(reservations.every((slot) => slot.count === 25)).toBe(true);
    expect(
      nextCollectionWindow(settings, reservations, settings.startDate),
    ).toBeNull();
  });
  it('does not issue expired windows and closes at the event end', () => {
    expect(
      nextCollectionWindow(
        settings,
        [],
        new Date('2035-01-01T11:01:00Z'),
      )?.start.toISOString(),
    ).toBe('2035-01-01T11:00:00.000Z');
    expect(nextCollectionWindow(settings, [], settings.endDate)).toBeNull();
  });
  it('advances when a collection window fills', () => {
    expect(
      nextCollectionWindow(
        settings,
        [{ collectionStart: settings.startDate, count: 25 }],
        settings.startDate,
      )?.start.toISOString(),
    ).toBe('2035-01-01T10:15:00.000Z');
  });
  it('clips the final window to closing time', () => {
    expect(
      nextCollectionWindow(
        { ...settings, endDate: new Date('2035-01-01T10:10:00Z') },
        [],
        settings.startDate,
      )?.end.toISOString(),
    ).toBe('2035-01-01T10:10:00.000Z');
  });
  it('counts used and unused reservations against total meals', () => {
    expect(
      nextCollectionWindow(
        { ...settings, foodBankTotalMeals: 25 },
        [{ collectionStart: settings.startDate, count: 25 }],
        new Date('2035-01-01T11:00:00Z'),
      ),
    ).toBeNull();
  });
  it.each([
    { foodBankTotalMeals: 0 },
    { foodBankSlotCapacity: 1001 },
    { foodBankSlotMinutes: 1 },
    { foodBankSlotMinutes: 121 },
    { foodBankSlotMinutes: 5.5 },
    { isPhysicalEvent: false },
    { reoccurring: 'DAILY' },
    { endDate: new Date('2035-01-01T10:30:00Z') },
  ])('rejects unsafe settings %j', (override) => {
    expect(() =>
      assertFoodBankSettings({ ...settings, ...override }),
    ).toThrow();
  });
});

describe('meal entitlements and collection', () => {
  const pass = {
    id: 'pass-1',
    eventId: 'event-1',
    userId: 'person-1',
    createdAt: new Date(),
    qrCode: 'ggmeal:opaque',
    collectionStart: settings.startDate,
    collectionEnd: new Date('2035-01-01T10:15:00Z'),
    isUsed: false,
  };
  let service: FoodBankService;
  const tx = {
    $queryRaw: jest.fn(),
    event: { findUnique: jest.fn() },
    mealPass: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      groupBy: jest.fn(),
      create: jest.fn<Promise<typeof pass>, [Prisma.MealPassCreateArgs]>(),
      updateMany: jest.fn<
        Promise<{ count: number }>,
        [Prisma.MealPassUpdateManyArgs]
      >(),
    },
  };
  beforeEach(async () => {
    jest.clearAllMocks();
    tx.$queryRaw.mockImplementation((sql: TemplateStringsArray) =>
      Promise.resolve(
        sql[0].includes('clock_timestamp')
          ? [{ now: settings.startDate }]
          : [{ id: 'event-1' }],
      ),
    );
    tx.event.findUnique.mockResolvedValue({ id: 'event-1', ...settings });
    tx.mealPass.findUnique.mockResolvedValue(null);
    tx.mealPass.findUniqueOrThrow.mockResolvedValue({
      ...pass,
      event: settings,
    });
    tx.mealPass.groupBy.mockResolvedValue([]);
    tx.mealPass.create.mockResolvedValue(pass);
    const module = await Test.createTestingModule({
      providers: [
        FoodBankService,
        {
          provide: NotificationService,
          useValue: { createNotification: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            ...tx,
            $transaction: (fn: (client: typeof tx) => Promise<object>) =>
              fn(tx),
          },
        },
      ],
    }).compile();
    service = module.get(FoodBankService);
  });
  it('locks the event before checking ownership and capacity', async () => {
    await service.claim('person-1', 'event-1');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.mealPass.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.mealPass.create).toHaveBeenCalledTimes(1);
    expect(tx.mealPass.create.mock.calls[0][0].data.qrCode).toMatch(
      /^ggmeal:[0-9a-f-]{36}$/,
    );
  });
  it('returns the same entitlement on repeated claims and omits donation information', async () => {
    tx.mealPass.findUnique.mockResolvedValue(pass);
    const result = await service.claim('person-1', 'event-1');
    expect(result).toEqual({
      timeZone: 'Africa/Lagos',
      id: pass.id,
      createdAt: pass.createdAt,
      eventId: pass.eventId,
      qrCode: pass.qrCode,
      collectionStart: pass.collectionStart,
      collectionEnd: pass.collectionEnd,
      isUsed: false,
    });
    expect(tx.mealPass.create).not.toHaveBeenCalled();
  });
  it('keeps an already collected pass instead of creating another', async () => {
    tx.mealPass.findUnique.mockResolvedValue({ ...pass, isUsed: true });
    expect((await service.claim('person-1', 'event-1')).isUsed).toBe(true);
    expect(tx.mealPass.create).not.toHaveBeenCalled();
  });
  it('rejects claims when every meal has been allocated', async () => {
    tx.mealPass.groupBy.mockResolvedValue([
      { collectionStart: settings.startDate, _count: { _all: 1000 } },
    ]);
    await expect(service.claim('person-1', 'event-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(tx.mealPass.create).not.toHaveBeenCalled();
  });
  it('uses one atomic conditional update for collection', async () => {
    tx.mealPass.updateMany.mockResolvedValue({ count: 1 });
    await service.redeem(pass.id, 'staff');
    expect(tx.mealPass.updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        id: pass.id,
        isUsed: false,
      },
      data: { isUsed: true, collectedBy: 'staff' },
    });
  });
  it('rejects repeat collection when the conditional update loses', async () => {
    tx.mealPass.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.redeem(pass.id, 'staff')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
