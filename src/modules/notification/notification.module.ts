import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { RedisModule } from 'src/redis/redis.module';
import { NotificationGateway } from './notification.gateway';
import { NotificationController } from './notification.controller';
import { GuardsModule } from 'src/common/guards/guards.module';

@Module({
  controllers: [NotificationController],
  imports: [RedisModule, GuardsModule],
  providers: [NotificationService, NotificationGateway],
  exports: [NotificationService],
})
export class NotificationModule {}
