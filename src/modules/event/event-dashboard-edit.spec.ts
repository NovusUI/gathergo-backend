import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  DashboardAccountStatus,
  DashboardRole,
  Event,
  Prisma,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CarpoolQueueService } from 'src/queue/carpool/queue.service';
import { EventTicketService } from '../event-ticket/event-ticket.service';
import { MediaService } from '../media/media.service';
import { UserPreferenceService } from '../user-preference/user-preference.service';
import { EventService } from './event.service';

const event: Event = {
  id: 'event-1',
  title: 'Old event',
  description: null,
  impactTitle: null,
  impactDescription: null,
  impactPercentage: null,
  impactSdgGoals: null,
  impactPaths: null,
  impactCommitments: null,
  impactMapSource: null,
  impactMapGeneratedAt: null,
  isPhysicalEvent: true,
  imageUrl: null,
  thumbnailUrl: null,
  location: 'Lagos',
  links: [],
  tags: [],
  startDate: new Date('2020-01-01'),
  endDate: new Date('2020-01-02'),
  reoccurring: 'NONE',
  communityId: null,
  creatorId: 'owner',
  createdAt: new Date('2020-01-01'),
  updatedAt: new Date('2020-01-01'),
  endRepeat: null,
  registrationAttendees: 100,
  registrationFee: 0,
  donationTarget: null,
  donationsEnabled: false,
  foodBankCollectionStatus: 'NOT_STARTED',
  foodBankTimeZone: 'Africa/Lagos',
  foodBankTotalMeals: null,
  foodBankSlotCapacity: null,
  foodBankSlotMinutes: null,
  registrationType: 'registration',
  impactMapSentAt: null,
  isImageProcessing: false,
};
const admin = {
  id: 'staff',
  role: DashboardRole.ADMIN,
  status: DashboardAccountStatus.ACTIVE,
  mustChangePassword: false,
};
describe('Event dashboard editing', () => {
  let service: EventService;
  const update = jest.fn<Promise<Event>, [Prisma.EventUpdateArgs]>();
  const current = jest
    .fn()
    .mockResolvedValue({ ...event, _count: { volunteerRoles: 0 } });
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: event.id }]),
    event: { findUniqueOrThrow: current, update },
    eventTicket: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const queue = { addUpdateExpiryJob: jest.fn().mockResolvedValue(undefined) };
  beforeEach(async () => {
    jest.clearAllMocks();
    current.mockResolvedValue({ ...event, _count: { volunteerRoles: 0 } });
    update.mockResolvedValue({ ...event, title: 'Updated' });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const module = await Test.createTestingModule({
      providers: [
        EventService,
        {
          provide: PrismaService,
          useValue: {
            event: { findUnique: jest.fn().mockResolvedValue(event) },
            $transaction: (callback: (value: typeof tx) => Promise<Event>) =>
              callback(tx),
          },
        },
        { provide: CarpoolQueueService, useValue: queue },
        { provide: EventTicketService, useValue: {} },
        { provide: MediaService, useValue: {} },
        { provide: UserPreferenceService, useValue: {} },
      ],
    }).compile();
    service = module.get(EventService);
  });
  afterEach(() => jest.restoreAllMocks());
  it('allows a dashboard admin to edit another creator’s event through the shared update logic', async () => {
    await service.updateForDashboard(
      event.id,
      { title: 'Updated' },
      admin,
      event.updatedAt,
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0].data.title).toBe('Updated');
    expect(update.mock.calls[0][0].data.registrationFee).toBeUndefined();
  });
  it('keeps mobile ownership checks and denies non-admin dashboard edits', async () => {
    await expect(
      service.update('other-owner', event.id, { title: 'No' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      service.updateForDashboard(
        event.id,
        { title: 'No' },
        { ...admin, role: DashboardRole.USER },
        event.updatedAt,
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects stale event versions under the event lock', async () => {
    current.mockResolvedValue({
      ...event,
      updatedAt: new Date('2020-01-02'),
      _count: { volunteerRoles: 0 },
    });
    await expect(
      service.updateForDashboard(
        event.id,
        { title: 'No' },
        admin,
        event.updatedAt,
      ),
    ).rejects.toThrow(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects invalid date ranges and missing physical locations', async () => {
    await expect(
      service.updateForDashboard(
        event.id,
        { endDate: '2019-01-01' },
        admin,
        event.updatedAt,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.updateForDashboard(
        event.id,
        { location: ' ' },
        admin,
        event.updatedAt,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });
  it('keeps volunteer events physical and schedules expiry updates when end time changes', async () => {
    current.mockResolvedValueOnce({
      ...event,
      registrationType: 'volunteer',
      impactDescription: 'Our impact',
      _count: { volunteerRoles: 1 },
    });
    await expect(
      service.updateForDashboard(
        event.id,
        { isPhysicalEvent: false },
        admin,
        event.updatedAt,
      ),
    ).rejects.toThrow(BadRequestException);
    await service.updateForDashboard(
      event.id,
      { endDate: '2020-01-03T00:00:00Z' },
      admin,
      event.updatedAt,
    );
    expect(queue.addUpdateExpiryJob).toHaveBeenCalledWith(
      event.id,
      '2020-01-03T12:00:00.000Z',
    );
  });
});
