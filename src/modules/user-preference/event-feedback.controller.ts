import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SaveEventFeedbackDto } from './event-feedback.dto';
import { EventFeedbackService } from './event-feedback.service';

@ApiTags('User Preference')
@ApiBearerAuth()
@Controller('preferences/event-feedback')
@UseGuards(JwtAuthGuard)
export class EventFeedbackController {
  constructor(private readonly feedback: EventFeedbackService) {}
  @Get('pending') pending(@CurrentUser('id') userId: string) {
    return this.feedback.pending(userId);
  }
  @Post(':eventId') save(
    @CurrentUser('id') userId: string,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
    @Body() dto: SaveEventFeedbackDto,
  ) {
    return this.feedback.save(userId, eventId, dto);
  }
  @Post(':eventId/defer') defer(
    @CurrentUser('id') userId: string,
    @Param('eventId', new ParseUUIDPipe()) eventId: string,
  ) {
    return this.feedback.defer(userId, eventId);
  }
}
