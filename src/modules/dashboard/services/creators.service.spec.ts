import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  CreatorSettlementProfileStatus,
  DashboardAccountStatus,
  DashboardRole,
  KycVerificationStatus,
  Prisma,
  TransactionStatusType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  creatorDetailSelect,
  creatorEventSelect,
  creatorSelect,
} from '../creator.types';
import type {
  CreatorDirectoryItem,
  CreatorEvent,
  CreatorProfile,
} from '../creator.types';
import { CreatorsQueryDto } from '../dto/creators-query.dto';
import { CreatorsService } from './creators.service';

const actor = {
  id: 'reader',
  role: DashboardRole.USER,
  status: DashboardAccountStatus.ACTIVE,
  mustChangePassword: false,
};
const creator: CreatorDirectoryItem = {
  id: 'creator-1',
  username: 'host',
  fullName: 'Community Host',
  email: 'host@example.test',
  createdAt: new Date('2026-10-01T10:00:00Z'),
  isVerified: true,
  _count: { eventsCreated: 3, followedBy: 12 },
  settlementProfile: null,
  kycVerification: null,
  alatProfile: null,
};
const profile: CreatorProfile = {
  ...creator,
  bio: 'Creating community events.',
  phoneNumber: null,
};
type PaymentAggregate = Prisma.GetTransactionReferenceAggregateType<{
  _count: { _all: true };
  _sum: { amount: true; creatorPayable: true };
}>;
type SettlementAggregate = Prisma.GetSettlementRecordAggregateType<{
  _sum: { amount: true };
}>;
function database() {
  return {
    user: {
      findMany: jest.fn<
        Promise<CreatorDirectoryItem[]>,
        [Prisma.UserFindManyArgs]
      >(),
      findFirst: jest.fn<
        Promise<CreatorProfile | null>,
        [Prisma.UserFindFirstArgs]
      >(),
      count: jest.fn<Promise<number>, [Prisma.UserCountArgs]>(),
    },
    event: {
      findMany: jest.fn<Promise<CreatorEvent[]>, [Prisma.EventFindManyArgs]>(),
      count: jest.fn<Promise<number>, [Prisma.EventCountArgs]>(),
    },
    transactionReference: {
      aggregate: jest.fn<
        Promise<PaymentAggregate>,
        [Prisma.TransactionReferenceAggregateArgs]
      >(),
    },
    settlementRecord: {
      aggregate: jest.fn<
        Promise<SettlementAggregate>,
        [Prisma.SettlementRecordAggregateArgs]
      >(),
    },
  };
}

describe('CreatorsService', () => {
  let prisma: ReturnType<typeof database>;
  let service: CreatorsService;
  beforeEach(async () => {
    prisma = database();
    prisma.user.findMany.mockResolvedValue([creator]);
    prisma.user.findFirst.mockResolvedValue(profile);
    prisma.user.count.mockResolvedValue(1);
    prisma.event.findMany.mockResolvedValue([]);
    prisma.event.count.mockResolvedValue(2);
    prisma.transactionReference.aggregate.mockResolvedValue({
      _count: { _all: 4 },
      _sum: { amount: 1500000, creatorPayable: 1300000 },
    });
    prisma.settlementRecord.aggregate.mockResolvedValue({
      _sum: { amount: 800000 },
    });
    const module = await Test.createTestingModule({
      providers: [
        CreatorsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(CreatorsService);
  });
  it('allows read-only staff to search a paginated creator directory with safe field selections', async () => {
    const query = Object.assign(new CreatorsQueryDto(), {
      page: 2,
      pageSize: 10,
      search: 'Host',
    });
    const result = await service.list(query, actor);
    expect(result).toEqual({
      data: [creator],
      total: 1,
      page: 2,
      pageSize: 10,
      summary: {
        eventCreatorCount: 1,
        verifiedKycCount: 1,
        payoutActiveCount: 1,
      },
    });
    const args = prisma.user.findMany.mock.calls[0][0];
    expect(args.select).toEqual(creatorSelect);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(args.where).toMatchObject({
      AND: [
        {
          OR: [
            { eventsCreated: { some: {} } },
            { creatorTransactions: { some: {} } },
            { settlementRecords: { some: {} } },
            { settlementProfile: { is: { status: { not: 'NOT_STARTED' } } } },
            { kycVerification: { is: { status: { not: 'NOT_STARTED' } } } },
            { alatProfile: { is: { status: { not: 'NOT_STARTED' } } } },
          ],
        },
        {
          OR: [
            { id: 'Host' },
            { fullName: { contains: 'Host', mode: 'insensitive' } },
            { username: { contains: 'Host', mode: 'insensitive' } },
            { email: { contains: 'Host', mode: 'insensitive' } },
          ],
        },
      ],
    });
    expect(Object.keys(creatorSelect)).not.toContain('password');
    expect(Object.keys(creatorSelect)).not.toContain('resetToken');
    expect(Object.keys(creatorSelect.settlementProfile.select)).not.toContain(
      'accountNumber',
    );
  });
  it('applies KYC and payout filters to both rows and summary counts', async () => {
    const query = Object.assign(new CreatorsQueryDto(), {
      kycStatus: KycVerificationStatus.VERIFIED,
      payoutStatus: CreatorSettlementProfileStatus.ACTIVE,
    });
    await service.list(query, actor);
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: [
        {},
        { kycVerification: { is: { status: 'VERIFIED' } } },
        { settlementProfile: { is: { status: 'ACTIVE' } } },
      ],
    });
    expect(prisma.user.count.mock.calls[0][0].where).toEqual(where);
    expect(
      prisma.user.count.mock.calls.slice(1).map(([args]) => args.where),
    ).toEqual([
      { AND: [where, { eventsCreated: { some: {} } }] },
      { AND: [where, { kycVerification: { is: { status: 'VERIFIED' } } }] },
      { AND: [where, { settlementProfile: { is: { status: 'ACTIVE' } } }] },
    ]);
  });
  it('includes missing profiles when filtering for not-started onboarding', async () => {
    await service.list(
      Object.assign(new CreatorsQueryDto(), {
        kycStatus: KycVerificationStatus.NOT_STARTED,
        payoutStatus: CreatorSettlementProfileStatus.NOT_STARTED,
      }),
      actor,
    );
    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({
      AND: [
        {},
        {
          OR: [
            { kycVerification: { is: null } },
            { kycVerification: { is: { status: 'NOT_STARTED' } } },
          ],
        },
        {
          OR: [
            { settlementProfile: { is: null } },
            { settlementProfile: { is: { status: 'NOT_STARTED' } } },
          ],
        },
      ],
    });
  });
  it('does not return non-creators or missing users as creator profiles', async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.detail('not-a-creator', actor)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.user.findFirst.mock.calls[0][0].where).toMatchObject({
      AND: [{}, { id: 'not-a-creator' }],
    });
    expect(prisma.transactionReference.aggregate).not.toHaveBeenCalled();
  });
  it('returns recent events and successful recorded payment totals, including historical event-owned payments', async () => {
    const result = await service.detail(creator.id, actor);
    expect(result.creator).toEqual(profile);
    expect(result.payments).toEqual({
      successfulCount: 4,
      grossAmountKobo: 1500000,
      creatorPayableKobo: 1300000,
      settledAmountKobo: 800000,
    });
    expect(result.liveUpcomingEvents).toBe(2);
    expect(prisma.user.findFirst.mock.calls[0][0].select).toEqual(
      creatorDetailSelect,
    );
    expect(prisma.event.findMany).toHaveBeenCalledWith({
      where: { creatorId: creator.id },
      select: creatorEventSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 5,
    });
    expect(
      prisma.transactionReference.aggregate.mock.calls[0][0].where,
    ).toEqual({
      AND: [
        {
          OR: [
            { creatorId: creator.id },
            { creatorId: null, event: { is: { creatorId: creator.id } } },
          ],
        },
        { status: TransactionStatusType.SUCCESS },
      ],
    });
    expect(prisma.settlementRecord.aggregate.mock.calls[0][0].where).toEqual({
      creatorId: creator.id,
      status: 'SUCCESS',
    });
  });
  it('represents genuinely empty payment aggregates as zero', async () => {
    prisma.transactionReference.aggregate.mockResolvedValue({
      _count: { _all: 0 },
      _sum: { amount: null, creatorPayable: null },
    });
    prisma.settlementRecord.aggregate.mockResolvedValue({
      _sum: { amount: null },
    });
    expect((await service.detail(creator.id, actor)).payments).toEqual({
      successfulCount: 0,
      grossAmountKobo: 0,
      creatorPayableKobo: 0,
      settledAmountKobo: 0,
    });
  });
  it('denies disabled dashboard accounts before any data query', async () => {
    const disabled = { ...actor, status: DashboardAccountStatus.DISABLED };
    await expect(
      service.list(new CreatorsQueryDto(), disabled),
    ).rejects.toThrow(UnauthorizedException);
    await expect(service.detail(creator.id, disabled)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});
