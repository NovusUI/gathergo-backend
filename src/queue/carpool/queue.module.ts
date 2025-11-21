import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CarpoolService } from 'src/modules/carpool/carpool.service';
import { CarpoolQueueProcessor } from './queue.processor';
import { CarpoolQueueService } from './queue.service';
import { MessageModule } from 'src/modules/message/message.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'carpool',
    }),

    MessageModule,
  ],
  providers: [CarpoolQueueProcessor, CarpoolQueueService, CarpoolService],
  exports: [CarpoolQueueService],
})
export class CarpoolQueueModule {}
