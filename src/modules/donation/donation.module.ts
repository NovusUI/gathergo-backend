// src/donation/donation.module.ts
import { Module } from '@nestjs/common';
import { DonationService } from './donation.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, NotificationModule],
  providers: [DonationService],
  exports: [DonationService],
})
export class DonationModule {}
