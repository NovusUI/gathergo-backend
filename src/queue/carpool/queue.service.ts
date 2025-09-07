import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class CarpoolQueueService {
  constructor(@InjectQueue('carpool') private carpoolQueue: Queue) {}

  async addUpdateExpiryJob(eventId: string, newEndDate: string) {
    await this.carpoolQueue.add('update-expiry', {
      eventId,
      newEndDate,
    });
  }
}
