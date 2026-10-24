import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import {
  EventInterestSignalDto,
  InterestExamplesDto,
  UpdatePreferenceDto,
} from './dto/update-preference.dto';
import { INTEREST_TOPICS, HELP_MODES } from './interest-profile';
import { UserPreferenceService } from './user-preference.service';

@ApiTags('User Preference')
@ApiBearerAuth()
@Controller('preferences')
@UseGuards(JwtAuthGuard)
export class UserPreferenceController {
  constructor(private readonly prefService: UserPreferenceService) {}
  @Get('catalog') catalog() {
    return {
      topics: INTEREST_TOPICS.map(({ id, label, accent }) => ({
        id,
        label,
        accent,
      })),
      helpModes: HELP_MODES,
    };
  }
  @Get('examples') examples(@Query() dto: InterestExamplesDto) {
    return this.prefService.examples(dto);
  }
  @Patch() update(
    @CurrentUser('id') userId: string,
    @Body() dto: UpdatePreferenceDto,
  ) {
    return this.prefService.updatePreferences(userId, dto);
  }
  @Get() get(@CurrentUser('id') userId: string) {
    return this.prefService.getPreferences(userId);
  }
  @Post('signals')
  @UseGuards(RateLimitGuard)
  @RateLimit({ windowSec: 60, max: 30, cooldownSec: 60 })
  signal(
    @CurrentUser('id') userId: string,
    @Body() dto: EventInterestSignalDto,
  ) {
    return this.prefService.recordSignal(userId, dto);
  }
  @Post('reset-learning') reset(@CurrentUser('id') userId: string) {
    return this.prefService.resetLearning(userId);
  }
  @Delete() remove(@CurrentUser('id') userId: string) {
    return this.prefService.deleteMap(userId);
  }
}
