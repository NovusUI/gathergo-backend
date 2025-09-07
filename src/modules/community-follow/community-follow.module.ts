import { Module } from '@nestjs/common';
import { CommunityFollowService } from './community-follow.service';
import { CommunityFollowController } from './community-follow.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CommunityFollowController],
  providers: [CommunityFollowService],
})
export class CommunityFollowModule {}
