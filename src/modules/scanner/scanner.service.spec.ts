import { Test } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { FoodBankService } from '../food-bank/food-bank.service';
import { NotificationService } from '../notification/notification.service';
import { ScannerPermissionsService } from './permisions/ scanner-permissions.service';
import { ScannerService } from './scanner.service';

const start = new Date('2035-01-01T10:00:00Z');
const end = new Date('2035-01-01T10:15:00Z');
const pass = {
  id: 'meal-1',
  userId: 'recipient',
  eventId: 'bank-1',
  qrCode: 'ggmeal:opaque',
  collectionStart: start,
  collectionEnd: end,
  isUsed: false,
  event: {
    title: 'Community table',
    startDate: start,
    endDate: new Date('2035-01-01T20:00:00Z'),
    foodBankCollectionStatus: 'OPEN',
    foodBankTimeZone: 'Africa/Lagos',
  },
};

describe('meal pass scanning', () => {
  let service: ScannerService;
  let now: Date;
  const prisma = {
    $queryRaw: jest.fn((sql: TemplateStringsArray) =>
      Promise.resolve(
        sql[0].includes('clock_timestamp') ? [{ now }] : [{ id: pass.eventId }],
      ),
    ),
    scanLog: { create: jest.fn() },
    mealPass: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUniqueOrThrow: jest.fn() },
    event: { findUnique: jest.fn() },
    scannerPermission: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    now = start;
    prisma.mealPass.findUnique.mockResolvedValue(pass);
    prisma.mealPass.findUniqueOrThrow.mockResolvedValue(pass);
    prisma.mealPass.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUniqueOrThrow.mockResolvedValue({
      fullName: 'Ada',
      username: 'ada',
    });
    prisma.event.findUnique.mockResolvedValue({ creatorId: 'organiser' });
    prisma.scannerPermission.findUnique.mockResolvedValue({
      isActive: true,
      expiresAt: null,
    });
    const module = await Test.createTestingModule({
      providers: [
        ScannerService,
        ScannerPermissionsService,
        FoodBankService,
        {
          provide: NotificationService,
          useValue: { createNotification: jest.fn() },
        },
        {
          provide: PrismaService,
          useValue: {
            ...prisma,
            $transaction: (fn: (tx: typeof prisma) => Promise<object>) =>
              fn(prisma),
          },
        },
      ],
    }).compile();
    service = module.get(ScannerService);
  });

  it.each(['organiser', 'staff'])(
    'allows %s to serve an early arrival on the collection day while open',
    async (userId) => {
      now = new Date(start.getTime() - 60_000);
      const result = await service.quickScan(pass.qrCode, userId);
      expect(result.isValid).toBe(true);
      expect(result.canMarkUsed).toBe(true);
      expect(result.mealCollection).toEqual({
        status: 'ready',
        arrival: 'early',
        collectionStart: start,
        collectionEnd: end,
        timeZone: 'Africa/Lagos',
      });
      expect((await service.scan(pass.qrCode, userId, true)).success).toBe(
        true,
      );
    },
  );

  it.each([
    start,
    new Date(end.getTime() - 1),
    end,
    new Date('2035-01-01T22:59:59Z'),
  ])(
    'allows authorised collection at %s while open on the local day',
    async (time) => {
      now = time;
      const result = await service.quickScan(pass.qrCode, 'staff');
      expect(result.isValid).toBe(true);
      expect(result.canMarkUsed).toBe(true);
      expect((await service.scan(pass.qrCode, 'staff', true)).success).toBe(
        true,
      );
    },
  );

  it.each([
    ['upcoming', '2034-12-31T22:59:59Z', 'OPEN'],
    ['ended', '2035-01-01T23:00:00Z', 'OPEN'],
    ['not_started', '2035-01-01T10:00:00Z', 'NOT_STARTED'],
    ['paused', '2035-01-01T10:00:00Z', 'PAUSED'],
    ['closed', '2035-01-01T10:00:00Z', 'CLOSED'],
  ])(
    'blocks %s collection without withdrawing staff permission',
    async (status, timestamp, operation) => {
      now = new Date(timestamp);
      const unavailable = {
        ...pass,
        event: { ...pass.event, foodBankCollectionStatus: operation },
      };
      prisma.mealPass.findUnique.mockResolvedValue(unavailable);
      prisma.mealPass.findUniqueOrThrow.mockResolvedValue(unavailable);
      const result = await service.quickScan(pass.qrCode, 'staff');
      expect(result.isValid).toBe(false);
      expect(result.canMarkUsed).toBe(true);
      expect(result.mealCollection?.status).toBe(status);
      expect((await service.scan(pass.qrCode, 'staff', true)).success).toBe(
        false,
      );
      expect(prisma.mealPass.updateMany).not.toHaveBeenCalled();
    },
  );

  it('distinguishes a collected meal and never redeems it twice', async () => {
    const collected = { ...pass, isUsed: true };
    prisma.mealPass.findUnique.mockResolvedValue(collected);
    prisma.mealPass.findUniqueOrThrow.mockResolvedValue(collected);
    expect(
      (await service.quickScan(pass.qrCode, 'staff')).mealCollection?.status,
    ).toBe('collected');
    expect((await service.scan(pass.qrCode, 'staff', true)).success).toBe(
      false,
    );
    expect(prisma.mealPass.updateMany).not.toHaveBeenCalled();
  });

  it('does not confuse an active window with scanner authorisation', async () => {
    prisma.scannerPermission.findUnique.mockResolvedValue(null);
    const result = await service.quickScan(pass.qrCode, 'recipient');
    expect(result.isValid).toBe(true);
    expect(result.canMarkUsed).toBe(false);
    expect(result.mealCollection?.status).toBe('ready');
    const collection = await service.scan(pass.qrCode, 'recipient', true);
    expect(collection.success).toBe(false);
    expect(collection.message).toContain('Only authorised food bank staff');
    expect(prisma.mealPass.updateMany).not.toHaveBeenCalled();
  });

  it('does not authorise inactive or expired staff permissions', async () => {
    for (const permission of [
      { isActive: false, expiresAt: null },
      { isActive: true, expiresAt: new Date('2000-01-01T00:00:00Z') },
    ]) {
      prisma.scannerPermission.findUnique.mockResolvedValue(permission);
      const result = await service.quickScan(pass.qrCode, 'staff');
      expect(result.isValid).toBe(true);
      expect(result.canMarkUsed).toBe(false);
    }
  });

  it('atomically records authorised collection during the assigned window', async () => {
    const result = await service.scan(pass.qrCode, 'staff', true);
    expect(result.success).toBe(true);
    expect(result.message).toBe('Meal collected');
    expect(result.data?.isUsed).toBe(true);
    expect(result.data?.mealCollection?.status).toBe('collected');
    expect(prisma.mealPass.updateMany).toHaveBeenCalledWith({
      where: {
        id: pass.id,
        isUsed: false,
      },
      data: { isUsed: true, collectedAt: start, collectedBy: 'staff' },
    });
  });

  it('never reports success when a concurrent redemption consumes the pass', async () => {
    prisma.mealPass.updateMany.mockResolvedValue({ count: 0 });
    const result = await service.scan(pass.qrCode, 'organiser', true);
    expect(result.success).toBe(false);
    expect(result.message).toContain('already been collected');
  });

  it('rechecks collection after taking the event lock when an organiser pauses during a scan', async () => {
    prisma.mealPass.findUniqueOrThrow
      .mockResolvedValueOnce({ eventId: pass.eventId })
      .mockResolvedValueOnce({
        ...pass,
        event: { ...pass.event, foodBankCollectionStatus: 'PAUSED' },
      });
    const result = await service.scan(pass.qrCode, 'staff', true);
    expect(result.success).toBe(false);
    expect(result.message).toContain('paused');
    expect(prisma.mealPass.updateMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.mealPass.findUniqueOrThrow.mock.invocationCallOrder[1],
    );
  });

  it('keeps unknown meal QR codes invalid without a fabricated window', async () => {
    prisma.mealPass.findUnique.mockResolvedValue(null);
    const result = await service.quickScan('ggmeal:unknown', 'staff');
    expect(result.isValid).toBe(false);
    expect(result.canMarkUsed).toBe(false);
    expect(result.mealCollection).toBeUndefined();
    expect(result.message).toBe('Meal pass not found');
  });
});
