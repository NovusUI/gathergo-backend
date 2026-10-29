import {
  DashboardAccountStatus,
  DashboardRole,
  RiskStatus,
  TransactionStatusType,
  Prisma,
} from '@prisma/client';
import * as request from 'supertest';
import { DashboardAuthService } from '../../dashboard-auth/dashboard-auth.service';
import {
  createRiskSettlementHarness,
  riskFixture,
} from '../../../../test/risk-settlement-harness';
import {
  KycTierDto,
  KycVerificationStatusDto,
  NameMatchStatusDto,
} from '../dto/wallet.dto';
import { ReviewableRiskStatusDto } from '../../transaction-reference/dto/review-transaction-risk.dto';
import { RiskUserRoleDto } from '../../transaction-reference/dto/risk-review-queue.dto';

const actor = {
  id: 'qa-staff',
  role: DashboardRole.ADMIN,
  status: DashboardAccountStatus.ACTIVE,
  mustChangePassword: false,
};
const dbDescribe = process.env.RISK_SETTLEMENT_TEST_DATABASE_URL
  ? describe
  : describe.skip;

dbDescribe('Risk review → PostgreSQL → settlement eligibility', () => {
  let harness: Awaited<ReturnType<typeof createRiskSettlementHarness>>;
  beforeAll(async () => {
    harness = await createRiskSettlementHarness();
  }, 30000);
  beforeEach(async () => {
    await harness.seed();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (harness) {
      await harness.app.close();
      await harness.prisma.$disconnect();
    }
  });
  async function approve(approvedTier = KycTierDto.FULL) {
    await harness.wallet.reviewKyc(
      riskFixture.creatorId,
      {
        status: KycVerificationStatusDto.VERIFIED,
        nameMatchStatus: NameMatchStatusDto.MATCHED,
        approvedTier,
      },
      actor,
    );
  }
  async function clear(id = riskFixture.paidId) {
    return harness.risk.reviewTransactionRisk(
      id,
      {
        riskStatus: ReviewableRiskStatusDto.CLEAR,
        note: 'Reviewed synthetic payment',
      },
      actor,
    );
  }

  it.each(['risk-first', 'kyc-first'])(
    'releases successful payments after both holds clear: %s',
    async (order) => {
      if (order === 'risk-first') {
        expect((await clear()).settlementStatus).toBe('HELD_KYC');
        expect(
          (await harness.wallet.previewSettlement(riskFixture.creatorId, actor))
            .calculation.transactionCount,
        ).toBe(0);
        await approve();
      } else {
        await approve();
        expect(
          (
            await harness.prisma.transactionReference.findUniqueOrThrow({
              where: { id: riskFixture.paidId },
            })
          ).settlementStatus,
        ).toBe('HELD_RISK');
        expect((await clear()).settlementStatus).toBe('READY');
      }
      const preview = await harness.wallet.previewSettlement(
        riskFixture.creatorId,
        actor,
      );
      expect(preview.calculation).toEqual({
        grossAmountKobo: 600000,
        deductionsKobo: 15000,
        netAmountKobo: 585000,
        transactionCount: 2,
      });
      expect(preview.candidate.canSettle).toBe(true);
      const queue = await harness.wallet.getInternalSettlementQueue(
        { page: 1, pageSize: 20, search: riskFixture.creatorId },
        actor,
      );
      expect(queue.data[0].balance.availableBalance).toBe(5850);
      const risk = await harness.risk.getRiskReviewQueue(
        {
          userQuery: riskFixture.creatorId,
          userRole: RiskUserRoleDto.CREATOR,
          riskStatus: ReviewableRiskStatusDto.CLEAR,
        },
        actor,
      );
      for (const payment of preview.transactions) {
        const reviewed = risk.data.find((item) => item.id === payment.id);
        expect(reviewed).toMatchObject({
          grossAmount: payment.grossAmount,
          creatorPayable: payment.creatorPayable,
        });
      }
      const legacy =
        await harness.prisma.transactionReference.findUniqueOrThrow({
          where: { id: riskFixture.legacyId },
        });
      expect(legacy.creatorId).toBe(riskFixture.creatorId);
      expect(legacy.amount).toBe(100000);
      await harness.wallet.previewSettlement(riskFixture.creatorId, actor);
      expect(
        (
          await harness.prisma.transactionReference.findUniqueOrThrow({
            where: { id: legacy.id },
          })
        ).amount,
      ).toBe(100000);
    },
  );

  it.each([
    TransactionStatusType.PENDING,
    TransactionStatusType.AWAITING_TRANSFER,
    TransactionStatusType.FAILED,
    TransactionStatusType.EXPIRED,
    TransactionStatusType.REFUND_REQUIRED,
    TransactionStatusType.REFUNDED,
  ])(
    'excludes %s from readiness, preview and settlement creation',
    async (status) => {
      await approve();
      await harness.prisma.transactionReference.update({
        where: { id: riskFixture.pendingId },
        data: { status, riskStatus: 'CLEAR', settlementStatus: 'READY' },
      });
      if (status === 'PENDING' || status === 'AWAITING_TRANSFER')
        expect((await clear(riskFixture.pendingId)).settlementStatus).toBe(
          'NOT_READY',
        );
      await harness.wallet.refreshCreatorSettlementStatus(
        riskFixture.creatorId,
      );
      expect(
        (
          await harness.prisma.transactionReference.findUniqueOrThrow({
            where: { id: riskFixture.pendingId },
          })
        ).settlementStatus,
      ).toBe('NOT_READY');
      const preview = await harness.wallet.previewSettlement(
        riskFixture.creatorId,
        actor,
      );
      expect(preview.transactions.map((item) => item.id)).not.toContain(
        riskFixture.pendingId,
      );
      await expect(
        harness.wallet.createSettlement(
          riskFixture.creatorId,
          { transactionIds: [riskFixture.pendingId] },
          actor,
        ),
      ).rejects.toThrow('No transactions are ready');
      expect(await harness.prisma.settlementRecord.count()).toBe(0);
    },
  );

  it('does not allow a buyer ID to claim the creator’s payments', async () => {
    await approve();
    await clear();
    await expect(
      harness.wallet.createSettlement(
        riskFixture.buyerId,
        { transactionIds: [riskFixture.paidId] },
        actor,
      ),
    ).rejects.toThrow('Creator payout profile not found');
    expect(await harness.prisma.settlementAllocation.count()).toBe(0);
  });

  it('repairs an unpaid legacy READY status before returning the risk queue', async () => {
    const queue = await harness.risk.getRiskReviewQueue(
      { userQuery: riskFixture.buyerId, userRole: RiskUserRoleDto.BUYER },
      actor,
    );
    expect(
      queue.data.find((item) => item.id === riskFixture.pendingId)
        ?.settlementStatus,
    ).toBe('NOT_READY');
    expect(
      (
        await harness.prisma.transactionReference.findUniqueOrThrow({
          where: { id: riskFixture.pendingId },
        })
      ).settlementStatus,
    ).toBe('NOT_READY');
  });

  it('includes clear payments by default and returns the same ready amounts before visiting settlements', async () => {
    await approve();
    await clear();
    await harness.prisma.transactionReference.update({
      where: { id: riskFixture.paidId },
      data: { settlementStatus: 'HELD_KYC', creatorPayable: 1 },
    });
    const ready = await harness.risk.getRiskReviewQueue(
      {
        settlementStatus: 'READY',
        userQuery: riskFixture.creatorId,
        userRole: RiskUserRoleDto.CREATOR,
      },
      actor,
    );
    expect(ready.total).toBe(2);
    expect(ready.data.map((item) => item.id).sort()).toEqual(
      [riskFixture.paidId, riskFixture.legacyId].sort(),
    );
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    expect(
      ready.data.reduce((sum, item) => sum + item.creatorPayable, 0) * 100,
    ).toBe(preview.calculation.netAmountKobo);
    const queue = await harness.risk.getRiskReviewQueue({}, actor);
    expect(queue.total).toBe(3);
    expect(
      queue.data.find((item) => item.id === riskFixture.pendingId),
    ).toMatchObject({
      transactionStatus: 'PENDING',
      settlementStatus: 'NOT_READY',
    });
  });

  it.each(Object.values(TransactionStatusType))(
    'includes %s payments when payment status is unfiltered',
    async (status) => {
      await harness.prisma.transactionReference.update({
        where: { id: riskFixture.pendingId },
        data: { status },
      });
      const queue = await harness.risk.getRiskReviewQueue({}, actor);
      expect(queue.total).toBe(3);
      expect(
        queue.data.find((item) => item.id === riskFixture.pendingId)
          ?.transactionStatus,
      ).toBe(status);
      const filtered = await harness.risk.getRiskReviewQueue(
        { transactionStatus: status },
        actor,
      );
      expect(
        filtered.data.every((item) => item.transactionStatus === status),
      ).toBe(true);
    },
  );

  it('counts only matching risk and manual review states', async () => {
    await clear();
    const queue = await harness.risk.getRiskReviewQueue(
      { riskStatus: RiskStatus.CLEAR, reviewed: false },
      actor,
    );
    expect(queue.total).toBe(1);
    expect(queue.summary).toEqual({
      reviewCount: 0,
      holdCount: 0,
      reviewedCount: 0,
    });
  });

  it('includes risk-clear payments awaiting KYC in the held balance', async () => {
    const scope = {
      userQuery: riskFixture.creatorId,
      userRole: RiskUserRoleDto.CREATOR,
      transactionStatus: TransactionStatusType.SUCCESS,
    };
    const heldRisk = await harness.risk.getRiskReviewQueue(
      { ...scope, riskStatus: RiskStatus.HOLD },
      actor,
    );
    const clearRisk = await harness.risk.getRiskReviewQueue(
      { ...scope, riskStatus: RiskStatus.CLEAR },
      actor,
    );
    expect(heldRisk.data[0]).toMatchObject({
      creatorPayable: 5000,
      settlementStatus: 'HELD_KYC',
    });
    expect(clearRisk.data[0]).toMatchObject({
      creatorPayable: 850,
      settlementStatus: 'HELD_KYC',
    });
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    expect(preview.candidate.balance.heldBalance).toBe(5850);
    expect(preview.calculation.netAmountKobo).toBe(0);
    expect(
      [...heldRisk.data, ...clearRisk.data].reduce(
        (sum, item) => sum + item.creatorPayable,
        0,
      ),
    ).toBe(preview.candidate.balance.heldBalance);
  });

  it('removes blocked payments from ready results and settlement amounts during a risk read', async () => {
    await approve();
    await harness.prisma.transactionReference.update({
      where: { id: riskFixture.paidId },
      data: { riskStatus: 'BLOCKED', settlementStatus: 'READY' },
    });
    const ready = await harness.risk.getRiskReviewQueue(
      { settlementStatus: 'READY' },
      actor,
    );
    expect(ready.data.map((item) => item.id)).toEqual([riskFixture.legacyId]);
    const blocked = await harness.risk.getRiskReviewQueue(
      { riskStatus: RiskStatus.BLOCKED },
      actor,
    );
    expect(blocked.data[0]).toMatchObject({
      id: riskFixture.paidId,
      settlementStatus: 'HELD_RISK',
    });
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    expect(ready.data[0].creatorPayable * 100).toBe(
      preview.calculation.netAmountKobo,
    );
  });

  it('applies a staff risk review through HTTP and exposes the recalculated settlement preview', async () => {
    await approve();
    const session = await harness.app
      .get(DashboardAuthService)
      .login({ username: 'qa.admin', password: 'Fixture-password-2026!' });
    await request(harness.app.getHttpServer())
      .post(
        `/api/v1/transaction-reference/internal/${riskFixture.paidId}/risk-review`,
      )
      .set('Authorization', `Bearer ${session.token}`)
      .send({ riskStatus: 'CLEAR', note: 'HTTP review' })
      .expect(201)
      .expect('Cache-Control', 'no-store');
    await request(harness.app.getHttpServer())
      .get(
        `/api/v1/wallet/internal/settlements/${riskFixture.creatorId}/preview`,
      )
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200)
      .expect(/"netAmountKobo":585000/);
  });

  it('rejects settlement creation by a read-only dashboard account', async () => {
    await approve();
    await clear();
    const session = await harness.app
      .get(DashboardAuthService)
      .login({ username: 'qa.reader', password: 'Fixture-password-2026!' });
    await request(harness.app.getHttpServer())
      .post(`/api/v1/wallet/internal/settlements/${riskFixture.creatorId}`)
      .set('Authorization', `Bearer ${session.token}`)
      .send({})
      .expect(403);
    expect(await harness.prisma.settlementRecord.count()).toBe(0);
  });

  it('reapplies Basic KYC limits immediately after clearing risk', async () => {
    await approve(KycTierDto.BASIC);
    await harness.prisma.transactionReference.update({
      where: { id: riskFixture.paidId },
      data: {
        amount: 600000000,
        creatorPayable: 600000000,
        metadata: {
          amountUnit: 'KOBO',
          pricing: {
            chargeAmountKobo: 600000000,
            grossAmountKobo: 600000000,
            creatorPayableKobo: 600000000,
            platformFeeKobo: 0,
          },
        },
      },
    });
    expect((await clear()).settlementStatus).toBe('HELD_KYC');
    const reviewed =
      await harness.prisma.transactionReference.findUniqueOrThrow({
        where: { id: riskFixture.paidId },
      });
    expect(reviewed.metadata).toMatchObject({
      lastRiskReview: { nextSettlementStatus: 'HELD_KYC' },
    });
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    expect(preview.transactions.map((item) => item.id)).not.toContain(
      riskFixture.paidId,
    );
  });

  it('keeps successful payments held when an active payout profile has no approved KYC tier', async () => {
    await harness.prisma.creatorSettlementProfile.update({
      where: { userId: riskFixture.creatorId },
      data: { status: 'ACTIVE' },
    });
    expect((await clear()).settlementStatus).toBe('HELD_KYC');
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    expect(preview.calculation.transactionCount).toBe(0);
  });

  it('repairs a successful READY payment whose risk is still held', async () => {
    await approve();
    await harness.prisma.transactionReference.update({
      where: { id: riskFixture.paidId },
      data: { settlementStatus: 'READY', riskStatus: 'HOLD' },
    });
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    expect(preview.candidate.balance.heldBalance).toBe(5000);
    expect(preview.transactions.map((item) => item.id)).not.toContain(
      riskFixture.paidId,
    );
    expect(
      (
        await harness.prisma.transactionReference.findUniqueOrThrow({
          where: { id: riskFixture.paidId },
        })
      ).settlementStatus,
    ).toBe('HELD_RISK');
  });

  it('keeps recorded zero creator payable out of settlement even when a stale stored payable is positive', async () => {
    await approve();
    await harness.prisma.transactionReference.update({
      where: { id: riskFixture.paidId },
      data: {
        riskStatus: 'CLEAR',
        settlementStatus: 'READY',
        metadata: {
          amountUnit: 'KOBO',
          pricing: {
            grossAmountKobo: 500000,
            creatorPayableKobo: 0,
            platformFeeKobo: 0,
          },
        } satisfies Prisma.InputJsonObject,
      },
    });
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    expect(preview.transactions.map((item) => item.id)).not.toContain(
      riskFixture.paidId,
    );
    expect(
      (
        await harness.prisma.transactionReference.findUniqueOrThrow({
          where: { id: riskFixture.paidId },
        })
      ).creatorPayable,
    ).toBe(0);
  });

  it('rolls back the risk decision if settlement reconciliation fails', async () => {
    jest
      .spyOn(harness.wallet, 'refreshCreatorSettlementStatus')
      .mockRejectedValueOnce(new Error('Reconciliation failed'));
    await expect(clear()).rejects.toThrow('Reconciliation failed');
    const payment = await harness.prisma.transactionReference.findUniqueOrThrow(
      { where: { id: riskFixture.paidId } },
    );
    expect(payment.riskStatus).toBe('HOLD');
    expect(payment.reviewedAt).toBeNull();
  });

  it('settles only the calculated successful payments and prevents allocating them again', async () => {
    await approve();
    await clear();
    const preview = await harness.wallet.previewSettlement(
      riskFixture.creatorId,
      actor,
    );
    const record = await harness.wallet.createSettlement(
      riskFixture.creatorId,
      {
        expectedAmountKobo: preview.calculation.netAmountKobo,
        expectedTransactionCount: preview.calculation.transactionCount,
      },
      actor,
    );
    expect(record.amount).toBe(5850);
    const allocations = await harness.prisma.settlementAllocation.findMany({
      include: { transactionReference: true },
    });
    expect(allocations).toHaveLength(2);
    expect(
      allocations.every(
        (item) => item.transactionReference.status === 'SUCCESS',
      ),
    ).toBe(true);
    await expect(
      harness.wallet.createSettlement(riskFixture.creatorId, {}, actor),
    ).rejects.toThrow('No transactions are ready');
  });
});
