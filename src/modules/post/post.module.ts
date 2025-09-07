import { Module } from '@nestjs/common';
import { PostController } from './post.controller';
import { PostService } from './post.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RedisModule } from 'src/redis/redis.module';
import { GuardsModule } from 'src/common/guards/guards.module';
import { PostGateway } from './post.gateway';

@Module({
  imports: [PrismaModule,RedisModule,GuardsModule],
  controllers: [PostController],
  providers: [PostService,PostGateway],

})
export class PostModule {}
