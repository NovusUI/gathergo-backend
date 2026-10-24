import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  ArrayUnique,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  EventCreationDraft,
  EventCreationMessage,
  EventCreationOptionalSection,
} from '../event-creation-assistant.types';
import { EVENT_CREATION_OPTIONAL_SECTIONS } from '../event-creation-assistant.types';

class EventCreationMessageDto implements EventCreationMessage {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role: EventCreationMessage['role'];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content: string;
}

export class EventCreationAssistantDto {
  @ApiProperty({ enum: ['general', 'donation'] })
  @IsIn(['general', 'donation'])
  eventType: 'general' | 'donation';

  @ApiProperty({ example: 'Africa/Lagos' })
  @IsString()
  @MaxLength(80)
  timeZone: string;

  @ApiProperty({ type: [EventCreationMessageDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => EventCreationMessageDto)
  messages: EventCreationMessageDto[];

  @ApiProperty({
    enum: EVENT_CREATION_OPTIONAL_SECTIONS,
    isArray: true,
    description:
      'Optional steps the organiser has finished or explicitly skipped.',
  })
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(EVENT_CREATION_OPTIONAL_SECTIONS, { each: true })
  addressedSections: EventCreationOptionalSection[];

  @ApiProperty({
    description:
      'The current editable event draft, including the selected participation type and required hasImpactGoalOrPath flag for a selected global goal or impact path. Donation targets are in kobo; registration fees are in naira.',
  })
  @IsObject()
  draft: EventCreationDraft;
}
