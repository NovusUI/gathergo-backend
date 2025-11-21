import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationsService } from 'src/modules/background-notification/background.notification.service';

@Injectable()
export class NotificationCleanupService {
  constructor(private notificationsService: NotificationsService) {}

  @Cron(CronExpression.EVERY_WEEK) // Run weekly
  async handleTokenCleanup() {
    await this.notificationsService.cleanupExpiredTokens(30); // Remove tokens older than 30 days
  }
}
