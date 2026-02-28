import {
  Controller,
  Get,
  Query,
  UseGuards,
  Param,
  Delete,
} from '@nestjs/common';
import { FeedService } from './feed.service';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@Controller('feeds')
@ApiTags('Feeds')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class FeedController {
  constructor(private readonly feedService: FeedService) {}

  @Get(':eventId')
  @ApiOperation({ summary: 'Get event feeds with cursor pagination' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description: 'Cursor for pagination',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Number of feeds per page',
    type: Number,
  })
  async getEventFeeds(
    @Param('eventId') eventId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '20',
    @CurrentUser('id') userId?: string,
  ) {
    const parsedLimit = Number(limit) || 20;

    return this.feedService.getFeedsWithCursor(
      eventId,
      parsedLimit,
      cursor,
      userId,
    );
  }

  @Get('user/pinned')
  @ApiOperation({
    summary: "Get user's pinned feeds (tickets, registrations, donations)",
  })
  async getUserPinnedFeeds(@CurrentUser('id') userId: string) {
    return this.feedService.getUserPinnedFeeds(userId);
  }

  @Delete(':feedId/hide')
  @ApiOperation({ summary: 'Hide a specific feed for current user' })
  async hideFeed(
    @Param('feedId') feedId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.feedService.hideFeed(feedId, userId);
  }

  @Get(':eventId/frenzies')
  @ApiOperation({ summary: 'Get frenzy history for an event' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getFrenzyHistory(
    @Param('eventId') eventId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit = '10',
  ) {
    const parsedLimit = Number(limit) || 10;

    return this.feedService.getFrenzyHistory(eventId, parsedLimit, cursor);
  }

  @Get(':eventId/stats')
  @ApiOperation({ summary: 'Get feed statistics for an event' })
  async getFeedStats(@Param('eventId') eventId: string) {
    return this.feedService.getFeedStats(eventId);
  }
}
