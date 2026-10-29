import { Injectable, NotFoundException } from '@nestjs/common';
import { DashboardRole, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { assertDashboardAccess } from '../../dashboard-auth/dashboard-auth.policy';
import type { DashboardActor } from '../../dashboard-auth/dashboard-auth.types';
import { EventService } from '../../event/event.service';
import {
  InternalEventsQueryDto,
  InternalEventStatus,
  UpdateInternalEventDto,
} from '../dto/internal-events.dto';
import {
  internalEventDetailSelect,
  internalEventSelect,
} from '../internal-event.types';
import { formatInternalEvent } from '../internal-event.format';

@Injectable()
export class InternalEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventService,
  ) {}

  async list(dto: InternalEventsQueryDto, actor: DashboardActor) {
    assertDashboardAccess(actor);
    const now = new Date();
    const where = this.where(dto, now);
    const [events, total, upcomingCount, liveCount, endedCount] =
      await Promise.all([
        this.prisma.event.findMany({
          where,
          select: internalEventSelect,
          skip: (dto.page - 1) * dto.pageSize,
          take: dto.pageSize,
          orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
        }),
        this.prisma.event.count({ where }),
        ...Object.values(InternalEventStatus).map((status) =>
          this.prisma.event.count({
            where: { AND: [where, this.statusWhere(status, now)] },
          }),
        ),
      ]);
    return {
      data: events.map((event) => formatInternalEvent(event, now)),
      page: dto.page,
      pageSize: dto.pageSize,
      total,
      summary: { upcomingCount, liveCount, endedCount },
    };
  }

  async detail(id: string, actor: DashboardActor) {
    assertDashboardAccess(actor);
    const event = await this.prisma.event.findUnique({
      where: { id },
      select: internalEventDetailSelect,
    });
    if (!event) throw new NotFoundException('Event not found.');
    return {
      ...formatInternalEvent(event, new Date()),
      description: event.description,
      isPhysicalEvent: event.isPhysicalEvent,
      links: event.links,
      tags: event.tags,
      updatedAt: event.updatedAt,
    };
  }

  async update(id: string, dto: UpdateInternalEventDto, actor: DashboardActor) {
    assertDashboardAccess(actor, DashboardRole.ADMIN);
    const { expectedUpdatedAt, ...changes } = dto;
    await this.events.updateForDashboard(
      id,
      changes,
      actor,
      new Date(expectedUpdatedAt),
    );
    return this.detail(id, actor);
  }

  private where(
    dto: InternalEventsQueryDto,
    now: Date,
  ): Prisma.EventWhereInput {
    const conditions: Prisma.EventWhereInput[] = [];
    if (dto.creatorId) conditions.push({ creatorId: dto.creatorId });
    if (dto.registrationType)
      conditions.push({ registrationType: dto.registrationType });
    if (dto.status) conditions.push(this.statusWhere(dto.status, now));
    const search = dto.search?.trim();
    if (search)
      conditions.push({
        OR: [
          { id: search },
          { title: { contains: search, mode: 'insensitive' } },
          { location: { contains: search, mode: 'insensitive' } },
          {
            creator: {
              is: {
                OR: [
                  { id: search },
                  { username: { contains: search, mode: 'insensitive' } },
                  { fullName: { contains: search, mode: 'insensitive' } },
                  { email: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      });
    return { AND: conditions };
  }

  private statusWhere(
    status: InternalEventStatus,
    now: Date,
  ): Prisma.EventWhereInput {
    if (status === InternalEventStatus.ENDED) return { endDate: { lt: now } };
    if (status === InternalEventStatus.LIVE)
      return { startDate: { lte: now }, endDate: { gte: now } };
    return { startDate: { gt: now }, endDate: { gte: now } };
  }
}
