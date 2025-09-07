import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';
import { RedisPubSubService } from './redis.pubsub.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Global()
@Module({
  imports: [PrismaModule],
  providers: [RedisService,RedisPubSubService],
  exports: [RedisService,RedisPubSubService],
})
export class RedisModule {}
