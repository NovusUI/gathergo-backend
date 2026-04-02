// registration/registration.module.ts
import { Module } from '@nestjs/common';
import { RegistrationService } from './registration.service';
import { NotificationModule } from '../notification/notification.module';
import { FeedModule } from '../feed/feed.module';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RegistrationController } from './registration.controller';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { FeedService } from '../feed/feed.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, NotificationModule, FeedModule, MailModule],
  controllers: [RegistrationController],
  providers: [RegistrationService, FeedIntegrationService, FeedService],
  exports: [RegistrationService],
})
export class RegistrationModule {}
