import { Module, forwardRef } from '@nestjs/common';
import { FeedController } from './feed.controller';
import { FeedService } from './feed.service';
import { FeedGateway } from './feed.gateway';
import { RedisModule } from 'src/redis/redis.module';
import { GuardsModule } from 'src/common/guards/guards.module';
import { EventModule } from '../event/event.module';
import { TicketModule } from '../ticket/ticket.module';
import { DonationModule } from '../donation/donation.module';
//import { RegistrationModule } from '../registration/registration.module';
import { FeedIntegrationService } from './feed-integration.service';
import { NotificationService } from '../notification/notification.service';
import { NotificationsService } from '../background-notification/backgroundnotification.service';

@Module({
  imports: [
    RedisModule,
    GuardsModule,
    forwardRef(() => EventModule),
    forwardRef(() => TicketModule),
    forwardRef(() => DonationModule),
    //forwardRef(() => RegistrationModule),
  ],
  controllers: [FeedController],
  providers: [
    FeedService,
    FeedGateway,
    NotificationService,
    NotificationsService,
    FeedIntegrationService,
  ],
  exports: [FeedService, FeedGateway, FeedIntegrationService],
})
export class FeedModule {}
