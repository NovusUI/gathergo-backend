import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
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
          ...event,
          startDate: newStartDate,
          endDate: newEndDate,

        },
      });
    }
  }
}
