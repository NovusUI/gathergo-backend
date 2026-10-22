import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Event, Prisma, VolunteerStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { lockCheckoutEvent } from '../checkout/checkout-inventory';
import {
  assertVolunteerEvent,
  occupiedVolunteerStatuses,
  summarizeVolunteering,
  volunteerSummaryInclude,
} from './volunteer.util';
import {
  CreateVolunteerRoleDto,
  UpdateVolunteerRoleDto,
} from './dto/create-volunteer-role.dto';
import {
  ApplyToVolunteerDto,
  CompleteVolunteerDto,
  ReviewVolunteerDto,
} from './dto/volunteer-application.dto';

@Injectable()
export class VolunteerService {
  constructor(private readonly prisma: PrismaService) {}

  async listRoles(eventId: string, userId: string) {
    await this.getEvent(this.prisma, eventId);
    return this.prisma.volunteerRole.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            applications: {
              where: { status: { in: occupiedVolunteerStatuses } },
            },
          },
        },
        applications: { where: { userId } },
      },
    });
  }

  createRole(eventId: string, userId: string, dto: CreateVolunteerRoleDto) {
    return this.withEvent(eventId, async (tx, event) => {
      this.assertOwner(event, userId);
      assertVolunteerEvent(event);
      this.assertRecruiting(event);
      return tx.volunteerRole.create({ data: { ...dto, eventId } });
    });
  }

  updateRole(
    eventId: string,
    roleId: string,
    userId: string,
    dto: UpdateVolunteerRoleDto,
  ) {
    return this.withEvent(eventId, async (tx, event) => {
      this.assertOwner(event, userId);
      assertVolunteerEvent(event);
      this.assertRecruiting(event);
      await this.getRole(tx, eventId, roleId);
      if (dto.capacity !== undefined) {
        const occupied = await this.occupancy(tx, roleId);
        if (dto.capacity < occupied) {
          throw new ConflictException(
            'Capacity cannot be lower than confirmed volunteer places',
          );
        }
      }
      return tx.volunteerRole.update({ where: { id: roleId }, data: dto });
    });
  }

  apply(
    eventId: string,
    roleId: string,
    userId: string,
    dto: ApplyToVolunteerDto,
  ) {
    return this.withEvent(eventId, async (tx, event) => {
      assertVolunteerEvent(event);
      this.assertRecruiting(event);
      if (event.creatorId === userId) {
        throw new BadRequestException(
          'The event organiser cannot apply as a volunteer',
        );
      }
      const role = await this.getRole(tx, eventId, roleId);
      if (!role.isOpen)
        throw new ConflictException('This volunteer role is closed');
      const existing = await tx.eventVolunteer.findUnique({
        where: { eventId_userId: { eventId, userId } },
      });
      if (
        existing &&
        existing.status !== VolunteerStatus.WITHDRAWN &&
        existing.status !== VolunteerStatus.DECLINED
      ) {
        if (existing.roleId === roleId) return existing;
        throw new ConflictException(
          'You already have a volunteer application for this event',
        );
      }
      if ((await this.occupancy(tx, roleId)) >= role.capacity) {
        throw new ConflictException('This volunteer role is full');
      }
      const data = {
        roleId,
        note: dto.note ?? null,
        status: role.requiresApproval
          ? VolunteerStatus.APPLIED
          : VolunteerStatus.ACCEPTED,
      };
      return tx.eventVolunteer.upsert({
        where: { eventId_userId: { eventId, userId } },
        create: { ...data, eventId, userId },
        update: data,
      });
    });
  }

  review(
    eventId: string,
    applicationId: string,
    userId: string,
    dto: ReviewVolunteerDto,
  ) {
    return this.withEvent(eventId, async (tx, event) => {
      this.assertOwner(event, userId);
      assertVolunteerEvent(event);
      this.assertRecruiting(event);
      const application = await this.getApplication(tx, eventId, applicationId);
      if (application.status === dto.status) return application;
      if (application.status !== VolunteerStatus.APPLIED) {
        throw new ConflictException(
          'Only pending applications can be reviewed',
        );
      }
      if (dto.status === VolunteerStatus.ACCEPTED) {
        const role = await this.getRole(tx, eventId, application.roleId);
        if (!role.isOpen)
          throw new ConflictException('This volunteer role is closed');
        if ((await this.occupancy(tx, role.id)) >= role.capacity) {
          throw new ConflictException('This volunteer role is full');
        }
      }
      return tx.eventVolunteer.update({
        where: { id: applicationId },
        data: { status: dto.status },
      });
    });
  }

  withdraw(eventId: string, applicationId: string, userId: string) {
    return this.withEvent(eventId, async (tx, event) => {
      const application = await this.getApplication(tx, eventId, applicationId);
      if (application.userId !== userId)
        throw new ForbiddenException(
          'You can only withdraw your own application',
        );
      if (application.status === VolunteerStatus.WITHDRAWN) return application;
      this.assertRecruiting(event);
      if (
        application.status !== VolunteerStatus.APPLIED &&
        application.status !== VolunteerStatus.ACCEPTED
      ) {
        throw new ConflictException('This application cannot be withdrawn');
      }
      return tx.eventVolunteer.update({
        where: { id: applicationId },
        data: { status: VolunteerStatus.WITHDRAWN },
      });
    });
  }

  checkIn(eventId: string, applicationId: string, userId: string) {
    return this.withEvent(eventId, async (tx, event) => {
      this.assertOwner(event, userId);
      const now = new Date();
      if (now < event.startDate || now >= event.endDate) {
        throw new BadRequestException(
          'Volunteer check-in is only available during the event',
        );
      }
      const application = await this.getApplication(tx, eventId, applicationId);
      if (application.status === VolunteerStatus.CHECKED_IN) return application;
      if (application.status !== VolunteerStatus.ACCEPTED) {
        throw new ConflictException('Only accepted volunteers can check in');
      }
      return tx.eventVolunteer.update({
        where: { id: applicationId },
        data: { status: VolunteerStatus.CHECKED_IN, checkedInAt: now },
      });
    });
  }

  complete(
    eventId: string,
    applicationId: string,
    userId: string,
    dto: CompleteVolunteerDto,
  ) {
    return this.withEvent(eventId, async (tx, event) => {
      this.assertOwner(event, userId);
      const now = new Date();
      if (now < event.endDate)
        throw new BadRequestException(
          'Confirm volunteer work after the event ends',
        );
      const application = await this.getApplication(tx, eventId, applicationId);
      if (application.status === VolunteerStatus.COMPLETED) {
        if (application.confirmedMinutes === dto.confirmedMinutes)
          return application;
        throw new ConflictException(
          'Volunteer work has already been confirmed',
        );
      }
      if (
        application.status !== VolunteerStatus.CHECKED_IN ||
        application.checkedInAt === null
      ) {
        throw new ConflictException(
          'Only checked-in volunteers can have work confirmed',
        );
      }
      const availableMinutes = Math.floor(
        (event.endDate.getTime() - application.checkedInAt.getTime()) / 60000,
      );
      if (dto.confirmedMinutes > availableMinutes) {
        throw new BadRequestException(
          'Confirmed time cannot exceed the time between check-in and event end',
        );
      }
      return tx.eventVolunteer.update({
        where: { id: applicationId },
        data: {
          status: VolunteerStatus.COMPLETED,
          completedAt: now,
          confirmedMinutes: dto.confirmedMinutes,
          confirmedById: userId,
        },
      });
    });
  }

  async listApplications(eventId: string, userId: string) {
    this.assertOwner(await this.getEvent(this.prisma, eventId), userId);
    return this.prisma.eventVolunteer.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      include: {
        role: true,
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePicUrlTN: true,
          },
        },
      },
    });
  }

  history(userId: string) {
    return this.prisma.eventVolunteer.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        role: true,
        event: {
          select: {
            id: true,
            title: true,
            location: true,
            startDate: true,
            endDate: true,
            thumbnailUrl: true,
          },
        },
      },
    });
  }

  async summary(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: volunteerSummaryInclude,
    });
    if (!event) throw new NotFoundException('Event not found');
    return { eventId, ...summarizeVolunteering(event) };
  }

  private async getEvent(tx: Prisma.TransactionClient, eventId: string) {
    const event = await tx.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  private withEvent<T>(
    eventId: string,
    work: (tx: Prisma.TransactionClient, event: Event) => Promise<T>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Event edits and volunteer allocation share the same lock, including first applications.
      await lockCheckoutEvent(tx, eventId);
      return work(tx, await this.getEvent(tx, eventId));
    });
  }

  private assertOwner(event: Event, userId: string) {
    if (event.creatorId !== userId)
      throw new ForbiddenException(
        'Only the event organiser can manage volunteers',
      );
  }

  private assertRecruiting(event: Event) {
    if (new Date() >= event.startDate)
      throw new BadRequestException(
        'Volunteer recruitment closes when the event starts',
      );
  }

  private async getRole(
    tx: Prisma.TransactionClient,
    eventId: string,
    roleId: string,
  ) {
    const role = await tx.volunteerRole.findFirst({
      where: { id: roleId, eventId },
    });
    if (!role) throw new NotFoundException('Volunteer role not found');
    return role;
  }

  private async getApplication(
    tx: Prisma.TransactionClient,
    eventId: string,
    id: string,
  ) {
    const application = await tx.eventVolunteer.findFirst({
      where: { id, eventId },
    });
    if (!application)
      throw new NotFoundException('Volunteer application not found');
    return application;
  }

  private occupancy(tx: Prisma.TransactionClient, roleId: string) {
    return tx.eventVolunteer.count({
      where: { roleId, status: { in: occupiedVolunteerStatuses } },
    });
  }
}
