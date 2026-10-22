import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class RecurringEventService {
  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleRecurringEvents() {
    const now = new Date();

    const recurringEvents = await this.prisma.event.findMany({
      where: {
        reoccurring: { not: 'NONE' },
        endDate: { lte: now },
      },
      include: { volunteerRoles: true },
    });

    for (const event of recurringEvents) {
      let newStartDate: Date;
      let newEndDate: Date;

      if (event.reoccurring === 'DAILY') {
        newStartDate = new Date(event.startDate);
        newStartDate.setDate(newStartDate.getDate() + 1);

        newEndDate = new Date(event.endDate);
        newEndDate.setDate(newEndDate.getDate() + 1);
      } else if (event.reoccurring === 'WEEKLY') {
        newStartDate = new Date(event.startDate);
        newStartDate.setDate(newStartDate.getDate() + 7);

        newEndDate = new Date(event.endDate);
        newEndDate.setDate(newEndDate.getDate() + 7);
      } else {
        // If for some reason it's not DAILY or WEEKLY, skip this event
        continue;
      }

      await this.prisma.event.create({
        data: {
          title: event.title,
          description: event.description,
          impactTitle: event.impactTitle,
          impactDescription: event.impactDescription,
          impactPercentage: event.impactPercentage,
          impactSdgGoals: this.toNullableJsonInput(event.impactSdgGoals),
          impactPaths: this.toNullableJsonInput(event.impactPaths),
          impactCommitments: this.toNullableJsonInput(event.impactCommitments),
          impactMapSource: event.impactMapSource,
          impactMapGeneratedAt: event.impactMapGeneratedAt,
          isPhysicalEvent: event.isPhysicalEvent,
          imageUrl: event.imageUrl,
          thumbnailUrl: event.thumbnailUrl,
          isImageProcessing: event.isImageProcessing,
          location: event.location,
          links: event.links,
          tags: event.tags,
          reoccurring: event.reoccurring,
          endRepeat: event.endRepeat,
          communityId: event.communityId,
          creatorId: event.creatorId,
          registrationType: event.registrationType,
          registrationFee: event.registrationFee,
          registrationAttendees: event.registrationAttendees,
          donationTarget: event.donationTarget,
          donationsEnabled: event.donationsEnabled,
          volunteerRoles: {
            create: event.volunteerRoles.map((role) => ({
              title: role.title,
              description: role.description,
              capacity: role.capacity,
              requiresApproval: role.requiresApproval,
              isOpen: role.isOpen,
            })),
          },
          startDate: newStartDate,
          endDate: newEndDate,
        },
      });
    }
  }

  private toNullableJsonInput(value: Prisma.JsonValue) {
    return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
  }
}
