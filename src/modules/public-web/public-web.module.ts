import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MailModule } from '../mail/mail.module';
import { TransactionReferenceModule } from '../transaction-reference/transaction-reference.module';
import { VolunteerModule } from '../volunteer/volunteer.module';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { PublicWebController } from './public-web.controller';
import { PublicWebService } from './public-web.service';
import { WebSessionService } from './web-session.service';
import { WebSessionGuard } from './web-session.guard';

@Module({
  imports: [
    PrismaModule,
    MailModule,
    TransactionReferenceModule,
    VolunteerModule,
  ],
  controllers: [PublicWebController],
  providers: [
    PublicWebService,
    WebSessionService,
    WebSessionGuard,
    RateLimitGuard,
  ],
})
export class PublicWebModule {}
