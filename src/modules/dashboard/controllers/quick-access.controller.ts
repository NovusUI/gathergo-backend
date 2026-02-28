import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { QuickAccessService } from '../services/quick-access.service';
import { QuickAccessResponseDto } from '../dto/quick-access.dto';

@ApiTags('Dashboard')
@Controller('dashboard/quick-access')
export class QuickAccessController {
  constructor(private readonly quickAccessService: QuickAccessService) {}

  @Get()
  @ApiOperation({ summary: 'Get quick access shortcuts for dashboard' })
  @ApiResponse({
    status: 200,
    description: 'Returns quick access shortcuts',
    type: QuickAccessResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiQuery({
    name: 'strategy',
    required: false,
    enum: ['smart', 'random', 'letter'],
    description: 'Color assignment strategy (default: smart)',
  })
  async getQuickAccess(
    @CurrentUser('id') userId: string,
    @Query('strategy') strategy: 'smart' | 'random' | 'letter' = 'smart',
  ): Promise<QuickAccessResponseDto> {
    let shortcuts;

    console.log('got ittttt');

    switch (strategy) {
      case 'random':
        shortcuts = await this.quickAccessService.getQuickAccessRandom(userId);
        break;
      case 'letter':
        shortcuts =
          await this.quickAccessService.getQuickAccessByLetter(userId);
        break;
      case 'smart':
      default:
        shortcuts = await this.quickAccessService.getQuickAccess(userId);
        break;
    }

    return {
      success: true,
      message: `Quick access items retrieved successfully using ${strategy} strategy`,
      shortcuts,
    };
  }

  @Get('event/:eventId')
  @ApiOperation({
    summary: 'Get quick access shortcuts for specific event context',
  })
  @ApiResponse({
    status: 200,
    description: 'Returns quick access shortcuts for event context',
    type: QuickAccessResponseDto,
  })
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiParam({
    name: 'eventId',
    description: 'Current event ID',
    type: String,
  })
  async getEventQuickAccess(
    @CurrentUser('id') userId: string,
    @Param('eventId') eventId: string,
  ): Promise<QuickAccessResponseDto> {
    const shortcuts = await this.quickAccessService.getEventQuickAccess(
      userId,
      eventId,
    );

    return {
      success: true,
      message: 'Event quick access items retrieved successfully',
      shortcuts,
    };
  }
}
