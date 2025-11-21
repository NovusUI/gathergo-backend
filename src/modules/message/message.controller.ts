import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { MessageService } from './message.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateMessageDto } from './dtos/create-message.dto';

@Controller('messages')
@ApiTags('Messages')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class MessageController {
  constructor(private readonly messageService: MessageService) {}

  @Post(':carpoolId/messages')
  async sendMessage(
    @Param('carpoolId') carpoolId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.messageService.createMessage(userId, carpoolId, dto);
  }

  @Get(':carpoolId')
  async getMessagesCursor(
    @Param('carpoolId') carpoolId: string,
    @Query('before') before?: string,
    @Query('beforeId') beforeId?: string,
    @Query('limit') limit = '20',
  ) {
    const parsedLimit = Number(limit) || 20;

    const messages = await this.messageService.getMessagesCursor(
      carpoolId,
      parsedLimit,
      before,
      beforeId,
    );

    return messages; // array, React Query expects raw list
  }
}
