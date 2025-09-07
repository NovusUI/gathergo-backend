import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bullmq';
import { CarpoolService } from 'src/modules/carpool/carpool.service';

@Processor('notification')
export class QueueProcessor {

  constructor(private readonly carpoolService: CarpoolService) {}
  @Process()
  async handleNotification(job: Job) {
    console.log('Processing job:', job.data);
    // Do something: send email, push notification, etc.
  }

}
