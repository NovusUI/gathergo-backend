import { PaymentType, RiskStatus, SettlementStatus, TransactionStatusType } from '@prisma/client';
import { DashboardService } from './dashboard.service';

describe('DashboardService', () => {
  const originalOpsKey = process.env.INTERNAL_OPS_KEY;

  let prisma: any;
  let service: DashboardService;

  beforeEach(() => {
    process.env.INTERNAL_OPS_KEY = 'ops-secret';

    prisma = {
      event: {
        count: jest.fn(),
        findMany: jest.fn(),
      },
      transactionReference: {
        count: jest.fn(),
        aggregate: jest.fn(),
        findMany: jest.fn(),
      },
      donation: {
        aggregate: jest.fn(),
        count: jest.fn(),
      },
      registration: {
        count: jest.fn(),
      },
      eventTicket: {
        aggregate: jest.fn(),
      },
    };

    service = new DashboardService(prisma);
  });

  afterAll(() => {
    process.env.INTERNAL_OPS_KEY = originalOpsKey;
  });

  it('returns a platform overview for internal admin operations', async () => {
    prisma.event.count
      .mockResolvedValueOnce(18)
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(9)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5);
    prisma.transactionReference.count.mockResolvedValue(86);
    prisma.transactionReference.aggregate
      .mockResolvedValueOnce({ _sum: { amount: 12650000 } })
      .mockResolvedValueOnce({ _sum: { amount: 8200000 } })
      .mockResolvedValueOnce({ _sum: { amount: 1450000 } });
    prisma.donation.aggregate.mockResolvedValue({
      _sum: { amount: 3000000 },
    });
    prisma.donation.count.mockResolvedValue(23);
    prisma.registration.count.mockResolvedValue(41);
    prisma.eventTicket.aggregate.mockResolvedValue({
      _sum: { sold: 132 },
    });
    prisma.event.findMany.mockResolvedValue([
      {
        id: 'event_123',
        title: 'Founders Mixer',
        registrationType: 'ticket',
        location: 'Lagos',
        startDate: new Date('2026-04-10T10:00:00.000Z'),
        endDate: new Date('2026-04-10T16:00:00.000Z'),
        donationTarget: null,
        registrationAttendees: null,
        registrationFee: null,
        creator: {
          id: 'creator_123',
          username: 'ada_events',
          fullName: 'Ada Example',
          email: 'ada@example.com',
        },
        eventTickets: [
          { sold: 30, quantity: 50, price: 20000 },
          { sold: 10, quantity: 20, price: 50000 },
        ],
        donations: [],
        Registration: [],
      },
    ]);
    prisma.transactionReference.findMany.mockResolvedValue([
      {
        id: 'txn_123',
        paymentType: PaymentType.DONATION,
        amount: 150000,
        creatorPayable: 135000,
        settlementStatus: SettlementStatus.HELD_RISK,
        riskStatus: RiskStatus.REVIEW,
        createdAt: new Date('2026-04-02T10:00:00.000Z'),
        event: {
          id: 'event_123',
          title: 'Founders Mixer',
          registrationType: 'donation',
        },
        user: {
          id: 'buyer_123',
          username: 'guest_one',
          fullName: 'Guest One',
        },
        creator: {
          id: 'creator_123',
          username: 'ada_events',
          fullName: 'Ada Example',
        },
      },
    ]);

    const result = await service.getInternalOverview({}, 'ops-secret');

    expect(result.summary).toEqual({
      totalEvents: 18,
      upcomingEvents: 7,
      liveEvents: 2,
      successfulTransactions: 86,
      grossProcessed: 126500,
    });
    expect(result.channels).toEqual([
      {
        key: 'ticket',
        label: 'Ticket Sales',
        eventCount: 9,
        participants: 132,
        grossAmount: 82000,
      },
      {
        key: 'donation',
        label: 'Donations',
        eventCount: 4,
        participants: 23,
        grossAmount: 30000,
      },
      {
        key: 'registration',
        label: 'Registrations',
        eventCount: 5,
        participants: 41,
        grossAmount: 14500,
      },
    ]);
    expect(result.upcomingEvents).toEqual([
      expect.objectContaining({
        id: 'event_123',
        title: 'Founders Mixer',
        registrationType: 'ticket',
        participants: 40,
        grossAmount: 1100000,
        goalAmount: 2000000,
        progress: 55,
        creator: expect.objectContaining({
          fullName: 'Ada Example',
        }),
      }),
    ]);
    expect(result.recentActivity).toEqual([
      expect.objectContaining({
        id: 'txn_123',
        paymentType: PaymentType.DONATION,
        amount: 1500,
        creatorPayable: 1350,
        settlementStatus: SettlementStatus.HELD_RISK,
        riskStatus: RiskStatus.REVIEW,
      }),
    ]);
    expect(prisma.transactionReference.count).toHaveBeenCalledWith({
      where: {
        status: TransactionStatusType.SUCCESS,
      },
    });
  });
});
