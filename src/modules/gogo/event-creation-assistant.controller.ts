import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RateLimit } from '../../common/decorators/rate-limit.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { EventCreationAssistantDto } from './dto/event-creation-assistant.dto';
import { EventCreationAssistantService } from './event-creation-assistant.service';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events/creation-assistant')
@UseGuards(JwtAuthGuard, RateLimitGuard)
export class EventCreationAssistantController {
  constructor(private readonly assistant: EventCreationAssistantService) {}

  @Post()
  @RateLimit({ windowSec: 60, max: 20, cooldownSec: 60 })
  @ApiOperation({
    summary: 'Discuss and draft an event with Gogo without publishing it',
  })
  reply(@Body() dto: EventCreationAssistantDto) {
    return this.assistant.reply(dto);
  }
}
