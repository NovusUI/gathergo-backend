import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { RedisModule } from 'src/redis/redis.module';
import { NotificationGateway } from './notification.gateway';
import { GuardsModule } from 'src/common/guards/guards.module';
import { NotificationsService as BackgroundNotificationsService } from '../background-notification/backgroundnotification.service';

@Module({
  imports: [RedisModule, GuardsModule],
  providers: [
    NotificationService,
    NotificationGateway,
    BackgroundNotificationsService,
  ],
  exports: [NotificationService, BackgroundNotificationsService],
})
export class NotificationModule {}
