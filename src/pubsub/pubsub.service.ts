// import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
// import * as Redis from 'ioredis';

// @Injectable()
// export class PubSubService implements OnModuleInit, OnModuleDestroy {
//   private publisher: Redis.Redis;
//   private subscriber: Redis.Redis;

//   onModuleInit() {
//     this.publisher = new Redis(); // default localhost:6379
//     this.subscriber = new Redis();

//     // Example: subscribe to "new_post" channel
//     this.subscriber.subscribe('new_post', (err, count) => {
//       if (err) {
//         console.error('Failed to subscribe:', err);
//       } else {
//         console.log(`Subscribed successfully! Currently subscribed to ${count} channels.`);
//       }
//     });

//     this.subscriber.on('message', (channel, message) => {
//       console.log(`Received message from ${channel}: ${message}`);
//       // You can notify gateways, process event, etc.
//     });
//   }

//   publish(channel: string, message: string) {
//     this.publisher.publish(channel, message);
//   }

//   onModuleDestroy() {
//     this.publisher.quit();
//     this.subscriber.quit();
//   }
// }
