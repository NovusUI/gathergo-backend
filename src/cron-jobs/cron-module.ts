// src/cron-jobs/cron.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { RecurringEventService } from './recurring-event.service'; // update path if needed
import { CarpoolCleanupService } from './capool-cleanup.service';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [RecurringEventService, PrismaService,CarpoolCleanupService],
})
export class CronModule {}
