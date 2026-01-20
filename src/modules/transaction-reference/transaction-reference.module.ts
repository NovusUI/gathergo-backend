import { Module } from '@nestjs/common';
import { TransactionReferenceService } from './transaction-reference.service';
import { TransactionReferenceController } from './transaction-reference.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PaystackService } from '../paystack/paystack.service';
import { MailModule } from '../mail/mail.module';
import { DonationModule } from '../donation/donation.module';
import { TicketModule } from '../ticket/ticket.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    DonationModule,
    TicketModule,
    NotificationModule,
  ],
  controllers: [TransactionReferenceController],
  providers: [TransactionReferenceService, PaystackService],
})
export class TransactionReferenceModule {}
