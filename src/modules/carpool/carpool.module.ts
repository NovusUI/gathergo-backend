import { Module, forwardRef } from '@nestjs/common';
import { CarpoolService } from './carpool.service';
import { CarpoolController } from './carpool.controller';
import { GuardsModule } from 'src/common/guards/guards.module';
import { MessageModule } from '../message/message.module';
import { NotificationService } from '../notification/notification.service';
import { RedisModule } from 'src/redis/redis.module';

@Module({
  imports: [GuardsModule, MessageModule, RedisModule],
  controllers: [CarpoolController],
  providers: [CarpoolService, NotificationService],
  exports: [CarpoolService],
})
export class CarpoolModule {}
