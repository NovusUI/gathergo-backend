import {
  Controller,
  Post,
  Body,
  UseGuards,
  Delete,
  Param,
  Get,
} from '@nestjs/common';
import { FollowUserDto } from './dto/follow-user.dto';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserFollowService } from './user-follow.service';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('Follow')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('follow')
export class UserFollowController {
  constructor(private followService: UserFollowService) {}

  @Post('user')
  @ApiOperation({ summary: 'Follow a user' })
  followUser(@CurrentUser('id') userId: string, @Body() dto: FollowUserDto) {
    return this.followService.followUser(userId, dto);
  }

  @Delete('user/:followingId')
  @ApiOperation({ summary: 'Unfollow a user' })
  unfollowUser(
    @CurrentUser('id') userId: string,
    @Param('followingId') followingId: string,
  ) {
    return this.followService.unfollowUser(userId, followingId);
  }

  // ✅ Get followers
  @Get('followers')
  @ApiOperation({ summary: 'Get my followers' })
  @ApiResponse({ status: 200, description: 'List of users who follow me' })
  async getMyFollowers(@CurrentUser('id') userId: string) {
    return this.followService.getFollowers(userId);
  }

  // ✅ Get following
  @Get('following')
  @ApiOperation({ summary: 'Get users I am following' })
  @ApiResponse({ status: 200, description: 'List of users I follow' })
  async getMyFollowing(@CurrentUser('id') userId: string) {
    return this.followService.getFollowing(userId);
  }
}
