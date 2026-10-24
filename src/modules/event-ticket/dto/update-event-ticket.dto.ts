import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, ValidateIf } from 'class-validator';
import { CreateEventTicketDto } from './create-event-ticket.dto';

export class UpdateEventTicketDto extends PartialType(CreateEventTicketDto) {
  @ApiPropertyOptional({
    description: 'Whether the ticket is available to attendees.',
  })
  // Keep the JSON value intact despite the app's implicit DTO conversion.
  @Transform(({ obj }: { obj: { isVisible?: unknown } }) => obj.isVisible, {
    toClassOnly: true,
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsBoolean()
  isVisible?: boolean;
}
