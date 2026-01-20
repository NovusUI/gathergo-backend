import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CarpoolService } from 'src/modules/carpool/carpool.service';
import { CarpoolQueueProcessor } from './queue.processor';
import { CarpoolQueueService } from './queue.service';
import { MessageModule } from 'src/modules/message/message.module';
import { NotificationService } from 'src/modules/notification/notification.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'carpool',
    }),

    MessageModule,
  ],
  providers: [
    CarpoolQueueProcessor,
    CarpoolQueueService,
    CarpoolService,
    NotificationService,
  ],
  exports: [CarpoolQueueService],
})
export class CarpoolQueueModule {}
