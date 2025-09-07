// notification.controller.ts
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { NotificationService } from './notification.service';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Post()
  async create(@Body() data: CreateNotificationDto) {
    return this.notificationService.createNotification(data);
  }

  @Get()
  async getUserNotifications(
    @CurrentUser() user: User,
    @Query('page') page = 1,
    @Query('limit') limit = 20
  ) {
    
    return this.notificationService.getUserNotifications(user.id, page, limit);
  }

  @Post(':id/read')
  async markAsRead(@CurrentUser() user: User, @Param('id') id: string) {

    
    return this.notificationService.markAsRead(user.id, id);
  }

  @Post('read-all')
  async markAllAsRead(@CurrentUser() user: User) {
    return //this.notificationService.markAllAsRead(user.id);
  }

  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: User) {
    return { count: await this.notificationService.getUnreadCount(user.id) };
  }
}