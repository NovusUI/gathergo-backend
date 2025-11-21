// src/notifications/notifications.controller.ts
import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { NotificationsService } from './background.notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('register-token')
  async registerToken(
    @Req() req,
    @Body() body: { token: string; platform: 'ios' | 'android' },
  ) {
    await this.notificationsService.registerToken(
      req.user.userId,
      body.token,
      body.platform,
    );
    return { status: 'success' };
  }

  @Post('remove-token')
  async removeToken(@Req() req, @Body() body: { token: string }) {
    await this.notificationsService.removeToken(req.user.userId, body.token);
    return { status: 'success' };
  }
}
