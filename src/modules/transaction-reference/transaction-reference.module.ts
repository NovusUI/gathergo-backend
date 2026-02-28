import { Module } from '@nestjs/common';
import { TransactionReferenceService } from './transaction-reference.service';
import { TransactionReferenceController } from './transaction-reference.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PaystackService } from '../paystack/paystack.service';
import { MailModule } from '../mail/mail.module';
import { DonationModule } from '../donation/donation.module';
import { TicketModule } from '../ticket/ticket.module';
import { NotificationModule } from '../notification/notification.module';
import { RegistrationService } from '../registration/registration.service';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { FeedService } from '../feed/feed.service';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    DonationModule,
    TicketModule,
    NotificationModule,
  ],
  controllers: [TransactionReferenceController],
  providers: [
    TransactionReferenceService,
    PaystackService,
    RegistrationService,
    FeedIntegrationService,
    FeedService,
  ],
})
export class TransactionReferenceModule {}
