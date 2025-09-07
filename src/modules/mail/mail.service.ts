import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class MailService {
  constructor(@InjectQueue('mailQueue') private mailQueue: Queue) {}

  async sendTicketConfirmationEmail(data: { email: string; name: string; eventTitle: string }) {
    await this.mailQueue.add('sendTicketEmail', data);
  }
}
