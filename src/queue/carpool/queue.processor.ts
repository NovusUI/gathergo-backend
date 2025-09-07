import { Processor, Process } from '@nestjs/bull';
import { Job } from 'bull';
import { CarpoolService } from 'src/modules/carpool/carpool.service';

@Processor('carpool')
export class CarpoolQueueProcessor {
  constructor(private readonly carpoolService: CarpoolService) {}

  @Process('update-expiry')
  async handleUpdateExpiry(job: Job<{ eventId: string; newEndDate: string }>) {
    const { eventId, newEndDate } = job.data;
    console.log(`Updating expiry for event: ${eventId}`);
    await this.carpoolService.updateCarpoolExpiryForEvent(eventId, new Date(newEndDate));
  }
}
