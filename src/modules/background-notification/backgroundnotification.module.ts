// notifications/notifications.module.ts
import { Module } from '@nestjs/common';

import { FirebaseModule } from '../firebase/firebase.module';
import { NotificationsService } from './backgroundnotification.service';
import { RedisModule } from 'src/redis/redis.module';
import { GuardsModule } from 'src/common/guards/guards.module';
import { BackgroundNotificationsController } from './backgroundnotification.controller';

@Module({
  imports: [FirebaseModule, RedisModule, GuardsModule],
  controllers: [BackgroundNotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class BackgroundNotificationsModule {}
