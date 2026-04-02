import { DonationImpactMapService } from './donation-impact-map.service';

describe('DonationImpactMapService', () => {
  const prisma = {
    event: {
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    donation: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
  } as any;
  const mailService = {
    sendImpactMap: jest.fn(),
  } as any;

  let service: DonationImpactMapService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DonationImpactMapService(prisma, mailService);
  });

  it('queues impact map emails for ended donation events and marks them sent', async () => {
    prisma.event.findMany.mockResolvedValue([
      {
        id: 'event-1',
        title: 'Food Relief Drive',
        endDate: new Date('2026-03-28T06:00:00.000Z'),
        donationTarget: 2500000,
        thumbnailUrl: null,
        impactTitle: 'Food Relief',
        impactDescription: 'Help families access meals and emergency food packs.',
        impactPercentage: 100,
        creator: {
          username: 'gathergo',
          fullName: 'GatherGo Team',
        },
      },
    ]);
    prisma.donation.findMany.mockResolvedValue([
      {
        userId: 'user-1',
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-1',
        email: 'supporter@example.com',
        username: 'supporter',
        fullName: 'Supporter One',
      },
    ]);
    prisma.donation.aggregate.mockResolvedValue({
      _sum: {
        amount: 1750000,
      },
    });
    mailService.sendImpactMap.mockResolvedValue({
      queued: true,
      skipped: false,
    });

    await service.sendImpactMapEmails();

    expect(mailService.sendImpactMap).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'supporter@example.com',
        eventTitle: 'Food Relief Drive',
        donationTarget: 25000,
        amountRaised: 17500,
        impactTitle: 'Food Relief',
        impactPercentage: 100,
      }),
    );
    expect(prisma.event.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: {
        impactMapSentAt: expect.any(Date),
      },
    });
  });

  it('does not mark the event sent when mail is skipped', async () => {
    prisma.event.findMany.mockResolvedValue([
      {
        id: 'event-2',
        title: 'Scholarship Fund',
        endDate: new Date('2026-03-28T06:00:00.000Z'),
        donationTarget: 5000000,
        thumbnailUrl: null,
        impactTitle: 'Education',
        impactDescription: 'Support books and school fees.',
        impactPercentage: 100,
        creator: {
          username: 'founder',
          fullName: 'Founder Name',
        },
      },
    ]);
    prisma.donation.findMany.mockResolvedValue([
      {
        userId: 'user-2',
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'user-2',
        email: 'donor@example.com',
        username: 'donor',
        fullName: 'Donor Two',
      },
    ]);
    prisma.donation.aggregate.mockResolvedValue({
      _sum: {
        amount: 3200000,
      },
    });
    mailService.sendImpactMap.mockResolvedValue({
      queued: false,
      skipped: true,
      reason: 'MAIL_IMPACT_MAP_ENABLED is false',
    });

    await service.sendImpactMapEmails();

    expect(prisma.event.update).not.toHaveBeenCalled();
  });
});
