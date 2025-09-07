import { Module } from '@nestjs/common';
import { TransactionReferenceService } from './transaction-reference.service';
import { TransactionReferenceController } from './transaction-reference.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PaystackService } from '../paystack/paystack.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule,MailModule],
  controllers: [TransactionReferenceController],
  providers: [TransactionReferenceService,PaystackService],
})
export class TransactionReferenceModule {}
