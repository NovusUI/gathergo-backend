// src/notifications/notifications.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { NotificationsService } from './backgroundnotification.service';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegisterTokenDto } from './dto/register-token.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('Background Notification')
@Controller('backgroundnotifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class BackgroundNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('registertoken')
  @ApiOperation({ summary: 'register token' })
  async registerToken(
    @CurrentUser('id') userId: string,
    @Body() body: RegisterTokenDto,
  ) {
    await this.notificationsService.registerToken(
      userId,
      body.token,
      body.platform,
    );
    return { status: 'success' };
  }

  @Post('removetoken')
  @ApiOperation({ summary: 'remove token' })
  async removeToken(
    @CurrentUser('id') userId: string,
    @Req() req,
    @Body() body: { token: string },
  ) {
    await this.notificationsService.removeToken(userId, body.token);
    return { status: 'success' };
  }
}
