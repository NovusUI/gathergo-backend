// import { Module } from '@nestjs/common';
// import { BullModule } from '@nestjs/bull';
// import { QueueProcessor } from './queue.processor';
// import { QueueService } from './queue.service';

// @Module({
//   imports: [
//     BullModule.forRoot({
//       redis: {
//         host: 'localhost',
//         port: 6379,
//       },
//     }),
//     BullModule.registerQueue({
//       name: 'notification',
//     }),
//   ],
//   providers: [QueueProcessor, QueueService],
//   exports: [QueueService],
// })
// export class QueueModule {}
