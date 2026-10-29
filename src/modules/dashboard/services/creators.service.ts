import { Injectable, NotFoundException } from '@nestjs/common';
import {
  CreatorAlatProfileStatus,
  CreatorSettlementProfileStatus,
  KycVerificationStatus,
  Prisma,
  SettlementRecordStatus,
  TransactionStatusType,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertDashboardAccess } from 'src/modules/dashboard-auth/dashboard-auth.policy';
import type { DashboardActor } from 'src/modules/dashboard-auth/dashboard-auth.types';
import {
  creatorDetailSelect,
  creatorEventSelect,
  creatorSelect,
} from '../creator.types';
import { CreatorsQueryDto } from '../dto/creators-query.dto';

// App users have no creator role. Use recorded creator activity or started onboarding.
const creatorScope: Prisma.UserWhereInput = {
  OR: [
    { eventsCreated: { some: {} } },
    { creatorTransactions: { some: {} } },
    { settlementRecords: { some: {} } },
    {
      settlementProfile: {
        is: { status: { not: CreatorSettlementProfileStatus.NOT_STARTED } },
      },
    },
    {
      kycVerification: {
        is: { status: { not: KycVerificationStatus.NOT_STARTED } },
      },
    },
    {
      alatProfile: {
        is: { status: { not: CreatorAlatProfileStatus.NOT_STARTED } },
      },
    },
  ],
};

@Injectable()
export class CreatorsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: CreatorsQueryDto, actor: DashboardActor) {
    assertDashboardAccess(actor);
    const where = this.directoryWhere(dto);
    const [
      data,
      total,
      eventCreatorCount,
      verifiedKycCount,
      payoutActiveCount,
    ] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: creatorSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
      }),
      this.prisma.user.count({ where }),
      this.prisma.user.count({
        where: { AND: [where, { eventsCreated: { some: {} } }] },
      }),
      this.prisma.user.count({
        where: {
          AND: [
            where,
            {
              kycVerification: {
                is: { status: KycVerificationStatus.VERIFIED },
              },
            },
          ],
        },
      }),
      this.prisma.user.count({
        where: {
          AND: [
            where,
            {
              settlementProfile: {
                is: { status: CreatorSettlementProfileStatus.ACTIVE },
              },
            },
          ],
        },
      }),
    ]);
    return {
      data,
      total,
      page: dto.page,
      pageSize: dto.pageSize,
      summary: { eventCreatorCount, verifiedKycCount, payoutActiveCount },
    };
  }

  async detail(id: string, actor: DashboardActor) {
    assertDashboardAccess(actor);
    const creator = await this.prisma.user.findFirst({
      where: { AND: [creatorScope, { id }] },
      select: creatorDetailSelect,
    });
    if (!creator) throw new NotFoundException('Creator not found.');
    const now = new Date();
    // Include payments recorded before creatorId was populated, without counting another creator's payments.
    const paymentOwner: Prisma.TransactionReferenceWhereInput = {
      OR: [
        { creatorId: id },
        { creatorId: null, event: { is: { creatorId: id } } },
      ],
    };
    const [recentEvents, liveUpcomingEvents, payments, settlements] =
      await Promise.all([
        this.prisma.event.findMany({
          where: { creatorId: id },
          select: creatorEventSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: 5,
        }),
        this.prisma.event.count({
          where: { creatorId: id, endDate: { gte: now } },
        }),
        this.prisma.transactionReference.aggregate({
          where: {
            AND: [paymentOwner, { status: TransactionStatusType.SUCCESS }],
          },
          _count: { _all: true },
          _sum: { amount: true, creatorPayable: true },
        }),
        this.prisma.settlementRecord.aggregate({
          where: { creatorId: id, status: SettlementRecordStatus.SUCCESS },
          _sum: { amount: true },
        }),
      ]);
    return {
      creator,
      recentEvents,
      liveUpcomingEvents,
      payments: {
        successfulCount: payments._count._all,
        grossAmountKobo: payments._sum.amount ?? 0,
        creatorPayableKobo: payments._sum.creatorPayable ?? 0,
        settledAmountKobo: settlements._sum.amount ?? 0,
      },
      evaluatedAt: now,
    };
  }

  private directoryWhere(dto: CreatorsQueryDto): Prisma.UserWhereInput {
    const conditions: Prisma.UserWhereInput[] = [creatorScope];
    if (dto.search)
      conditions.push({
        OR: [
          { id: dto.search },
          {
            fullName: {
              contains: dto.search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            username: {
              contains: dto.search,
              mode: Prisma.QueryMode.insensitive,
            },
          },
          {
            email: { contains: dto.search, mode: Prisma.QueryMode.insensitive },
          },
        ],
      });
    if (dto.kycStatus)
      conditions.push(
        dto.kycStatus === KycVerificationStatus.NOT_STARTED
          ? {
              OR: [
                { kycVerification: { is: null } },
                { kycVerification: { is: { status: dto.kycStatus } } },
              ],
            }
          : { kycVerification: { is: { status: dto.kycStatus } } },
      );
    if (dto.payoutStatus)
      conditions.push(
        dto.payoutStatus === CreatorSettlementProfileStatus.NOT_STARTED
          ? {
              OR: [
                { settlementProfile: { is: null } },
                { settlementProfile: { is: { status: dto.payoutStatus } } },
              ],
            }
          : { settlementProfile: { is: { status: dto.payoutStatus } } },
      );
    return { AND: conditions };
  }
}
