import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimit } from 'src/common/decorators/rate-limit.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RateLimitGuard } from 'src/common/guards/rate-limit.guard';
import { ImpactSuggestionDto } from './dto/impact-suggestion.dto';
import { ImpactService } from './impact.service';

@ApiTags('Impact')
@Controller('impact')
@UseGuards(JwtAuthGuard, RateLimitGuard)
@ApiBearerAuth()
export class ImpactController {
  constructor(private readonly impactService: ImpactService) {}

  @Post('suggestions')
  @RateLimit({ windowSec: 60, max: 30, cooldownSec: 60 })
  @ApiOperation({
    summary: 'Suggest an optional event impact map using DeepSeek AI',
  })
  suggestImpactMap(@Body() dto: ImpactSuggestionDto) {
    return this.impactService.suggest(dto);
  }
}
