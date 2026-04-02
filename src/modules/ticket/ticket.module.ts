import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { TicketController } from './ticket.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { FeedService } from '../feed/feed.service';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [PrismaModule, NotificationModule, MailModule],
  controllers: [TicketController],
  providers: [TicketService, FeedService, FeedIntegrationService],
  exports: [TicketService],
})
export class TicketModule {}
