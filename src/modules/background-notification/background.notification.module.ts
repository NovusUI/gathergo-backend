// notifications/notifications.module.ts
import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationsService } from './background.notification.service';
import { RedisModule } from 'src/redis/redis.module';
import { GuardsModule } from 'src/common/guards/guards.module';
import { NotificationsController } from './background.notification.controller';

@Module({
  imports: [FirebaseModule, RedisModule, GuardsModule],
  providers: [NotificationsService, NotificationsController],
  exports: [NotificationsService],
})
export class BackgroundNotificationsModule {}
