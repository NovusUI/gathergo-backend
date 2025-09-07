import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';

@Injectable()
export class CarpoolQueueService {
  constructor(@InjectQueue('carpool') private carpoolQueue: Queue) {}

  async addUpdateExpiryJob(eventId: string, newEndDate: Date) {
    await this.carpoolQueue.add('update-expiry', {
      eventId,
      newEndDate,
    });
  }
}
