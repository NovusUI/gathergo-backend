import { Module } from '@nestjs/common';
import { EventController } from './event.controller';
import { EventService } from './event.service';
import { CarpoolQueueModule } from 'src/queue/carpool/queue.module';
import { EventTicketService } from '../event-ticket/event-ticket.service';
import { MediaService } from '../media/media.service';

@Module({
  imports: [CarpoolQueueModule],
  controllers: [EventController],
  providers: [EventService, EventTicketService, MediaService],
})
export class EventModule {}
