import { Module } from '@nestjs/common';
import { UserFollowService } from './user-follow.service';

import { PrismaModule } from 'src/prisma/prisma.module';
import { UserFollowController } from './user-follow.controller';

@Module({
  imports: [PrismaModule],
  controllers: [UserFollowController],
  providers: [UserFollowService],
})
export class UserFollowModule {}
