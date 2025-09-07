import { Controller, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CommunityFollowService } from './community-follow.service';
import { FollowCommunityDto } from './dto/follow-community.dto';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('Community Follow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('community-follow')
export class CommunityFollowController {
  constructor(private readonly communityFollowService: CommunityFollowService) {}

  @Post()
  @ApiOperation({ summary: 'Follow a community' })
  follow(@CurrentUser('id') userId: string, @Body() dto: FollowCommunityDto) {
    return this.communityFollowService.followCommunity(userId, dto);
  }

  @Delete(':communityId')
  @ApiOperation({ summary: 'Unfollow a community' })
  unfollow(@CurrentUser('id') userId: string, @Param('communityId') communityId: string) {
    return this.communityFollowService.unfollowCommunity(userId, communityId);
  }
}
