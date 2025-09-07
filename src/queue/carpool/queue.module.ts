import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CarpoolService } from 'src/modules/carpool/carpool.service';
import { CarpoolQueueProcessor } from './queue.processor';
import { CarpoolQueueService } from './queue.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'carpool',
    }),
  ],
  providers: [CarpoolQueueProcessor, CarpoolQueueService, CarpoolService],
  exports: [CarpoolQueueService],
})
export class CarpoolQueueModule {}
