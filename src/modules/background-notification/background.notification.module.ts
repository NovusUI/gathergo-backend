// notifications/notifications.module.ts
import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationsService } from './background.notification.service';
import { RedisModule } from 'src/redis/redis.module';
import { GuardsModule } from 'src/common/guards/guards.module';
import { BackgroundNotificationGateway } from './background.notificarion.gateway';
import { NotificationsController } from './background.notification.controller';

@Module({
  imports: [FirebaseModule, RedisModule, GuardsModule],
  providers: [
    NotificationsService,
    BackgroundNotificationGateway,
    NotificationsController,
  ],
  exports: [NotificationsService, BackgroundNotificationGateway],
})
export class BackgroundNotificationsModule {}
