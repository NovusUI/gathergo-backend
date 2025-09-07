import { PartialType } from '@nestjs/swagger';
import { CreateEventTicketDto } from './create-event-ticket.dto';

export class UpdateEventTicketDto extends PartialType(CreateEventTicketDto) {}
