import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DashboardAccountStatus, DashboardRole, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { EventService } from '../../event/event.service';
import {
  InternalEventsQueryDto,
  InternalEventStatus,
} from '../dto/internal-events.dto';
import { formatInternalEvent } from '../internal-event.format';
import type { InternalEventDetailData } from '../internal-event.types';
import { InternalEventsService } from './internal-events.service';

const actor = {
  id: 'reader',
  role: DashboardRole.USER,
  status: DashboardAccountStatus.ACTIVE,
  mustChangePassword: false,
};
export const eventFixture: InternalEventDetailData = {
  id: 'event-1',
  title: 'Past fundraiser',
  registrationType: 'donation',
  location: 'Lagos',
  startDate: new Date('2020-01-01'),
  endDate: new Date('2020-01-02'),
  donationTarget: 100000,
  registrationAttendees: null,
  registrationFee: null,
  volunteerRoles: [],
  volunteers: [],
  eventTickets: [],
  Registration: [],
  donations: [
    { amount: 20000, status: 'completed' },
    { amount: 50000, status: 'pending' },
  ],
  creator: {
    id: 'creator-1',
    fullName: 'Host',
    username: 'host',
    email: 'host@example.test',
  },
  description: 'A fundraiser',
  isPhysicalEvent: true,
  links: [],
  tags: [],
  updatedAt: new Date('2020-01-01'),
};
describe('InternalEventsService', () => {
  let service: InternalEventsService;
  const findMany = jest.fn<
    Promise<InternalEventDetailData[]>,
    [Prisma.EventFindManyArgs]
  >();
  const findUnique = jest.fn<
    Promise<InternalEventDetailData | null>,
    [Prisma.EventFindUniqueArgs]
  >();
  const count = jest.fn<Promise<number>, [Prisma.EventCountArgs]>();
  const updateForDashboard = jest.fn().mockResolvedValue(eventFixture);
  beforeEach(async () => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([eventFixture]);
    findUnique.mockResolvedValue(eventFixture);
    count.mockResolvedValue(1);
    const module = await Test.createTestingModule({
      providers: [
        InternalEventsService,
        {
          provide: PrismaService,
          useValue: { event: { findMany, findUnique, count } },
        },
        { provide: EventService, useValue: { updateForDashboard } },
      ],
    }).compile();
    service = module.get(InternalEventsService);
  });
  it('lists across all creators and dates, with database pagination beyond overview records', async () => {
    const result = await service.list(
      Object.assign(new InternalEventsQueryDto(), { page: 3, pageSize: 20 }),
      actor,
    );
    expect(findMany.mock.calls[0][0].where).toEqual({ AND: [] });
    expect(findMany.mock.calls[0][0].skip).toBe(40);
    expect(findMany.mock.calls[0][0].take).toBe(20);
    expect(result.data[0].status).toBe('ENDED');
    expect(result.total).toBe(1);
  });
  it('applies creator/type/status/search filters to rows and counts', async () => {
    await service.list(
      Object.assign(new InternalEventsQueryDto(), {
        creatorId: 'creator-1',
        registrationType: 'volunteer',
        status: InternalEventStatus.ENDED,
        search: 'Host',
      }),
      actor,
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      AND: [
        { creatorId: 'creator-1' },
        { registrationType: 'volunteer' },
        { endDate: {} },
        {
          OR: [
            { id: 'Host' },
            { title: { contains: 'Host' } },
            { location: { contains: 'Host' } },
            {
              creator: {
                is: {
                  OR: [
                    { id: 'Host' },
                    { username: { contains: 'Host' } },
                    { fullName: { contains: 'Host' } },
                    { email: { contains: 'Host' } },
                  ],
                },
              },
            },
          ],
        },
      ],
    });
    expect(count.mock.calls[0][0].where).toEqual(where);
    expect(count).toHaveBeenCalledTimes(4);
  });
  it('formats completed donations and target in NGN and excludes pending donations', () => {
    const event = formatInternalEvent(eventFixture, new Date());
    expect(event.participants).toBe(1);
    expect(event.grossAmount).toBe(200);
    expect(event.goalAmount).toBe(1000);
    expect(event.progress).toBe(20);
  });
  it('returns full detail and a missing-event error', async () => {
    expect((await service.detail(eventFixture.id, actor)).updatedAt).toEqual(
      eventFixture.updatedAt,
    );
    findUnique.mockResolvedValue(null);
    await expect(service.detail('missing', actor)).rejects.toThrow(
      NotFoundException,
    );
  });
  it('denies regular-user edits before mutation and delegates admin edits to the existing event service', async () => {
    const dto = {
      expectedUpdatedAt: eventFixture.updatedAt.toISOString(),
      title: 'Updated',
    };
    await expect(service.update(eventFixture.id, dto, actor)).rejects.toThrow(
      ForbiddenException,
    );
    expect(updateForDashboard).not.toHaveBeenCalled();
    const admin = { ...actor, role: DashboardRole.ADMIN };
    await service.update(eventFixture.id, dto, admin);
    expect(updateForDashboard).toHaveBeenCalledWith(
      eventFixture.id,
      { title: 'Updated' },
      admin,
      eventFixture.updatedAt,
    );
  });
});
