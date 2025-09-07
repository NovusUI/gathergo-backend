import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';
import { RedisModule } from 'src/redis/redis.module';
import { MessageGateway } from './message.gateway';
import { GuardsModule } from 'src/common/guards/guards.module';


@Module({
  imports: [PrismaModule,RedisModule,GuardsModule],
  controllers: [MessageController],
  providers: [MessageService,MessageGateway],
})
export class MessageModule {}
