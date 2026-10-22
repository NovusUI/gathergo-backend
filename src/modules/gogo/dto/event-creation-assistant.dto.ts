import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsObject,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import type {
  EventCreationDraft,
  EventCreationMessage,
} from '../event-creation-assistant.types';

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
    description:
      'The current editable event draft. Donation targets are in kobo; registration fees are in naira.',
  })
  @IsObject()
  draft: EventCreationDraft;
}
