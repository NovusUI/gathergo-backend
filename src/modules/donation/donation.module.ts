// src/donation/donation.module.ts
import { Module } from '@nestjs/common';
import { DonationService } from './donation.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { FeedService } from '../feed/feed.service';

@Module({
  imports: [PrismaModule, NotificationModule],
  providers: [DonationService, FeedIntegrationService, FeedService],
  exports: [DonationService],
})
export class DonationModule {}
