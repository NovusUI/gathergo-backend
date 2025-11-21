import { Module } from '@nestjs/common';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { RedisModule } from 'src/redis/redis.module';
import { MessageGateway } from './message.gateway';
import { GuardsModule } from 'src/common/guards/guards.module';
import { NotificationsService } from '../background-notification/background.notification.service';

@Module({
  imports: [RedisModule, GuardsModule],
  controllers: [MessageController],
  providers: [MessageService, MessageGateway, NotificationsService],
  exports: [MessageGateway, MessageService, NotificationsService],
})
export class MessageModule {}
