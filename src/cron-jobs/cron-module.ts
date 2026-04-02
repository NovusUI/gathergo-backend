// src/cron-jobs/cron.module.ts
import { Module } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { RecurringEventService } from './recurring-event.service'; // update path if needed
import { CarpoolCleanupService } from './capool-cleanup.service';
import { NotificationCleanupService } from './notification-cleanup.service';
import { NotificationsService } from 'src/modules/background-notification/backgroundnotification.service';
import { MailModule } from 'src/modules/mail/mail.module';
import { DonationImpactMapService } from './donation-impact-map.service';

@Module({
  imports: [MailModule],
  providers: [
    RecurringEventService,
    PrismaService,
    CarpoolCleanupService,
    NotificationCleanupService,
    NotificationsService,
    DonationImpactMapService,
  ],
})
export class CronModule {}
