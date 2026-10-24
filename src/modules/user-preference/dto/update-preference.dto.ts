import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { HELP_MODES, INTEREST_TOPICS } from '../interest-profile';

export class UpdatePreferenceDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(5)
  @ArrayUnique()
  @IsIn(INTEREST_TOPICS.map((topic) => topic.id), { each: true })
  interests: string[];

  @ApiProperty({ enum: HELP_MODES, isArray: true })
  @IsArray()
  @ArrayMaxSize(HELP_MODES.length)
  @ArrayUnique()
  @IsIn(HELP_MODES, { each: true })
  helpModes: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiProperty()
  @Transform(
    ({ obj }: { obj: { learningEnabled: unknown } }) => obj.learningEnabled,
  )
  @IsBoolean()
  learningEnabled: boolean;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  likedEventIds: string[];
}

export class EventInterestSignalDto {
  @ApiProperty() @IsUUID('4') eventId: string;
  @ApiProperty({ enum: ['LIKE', 'VIEW'] }) @IsIn(['LIKE', 'VIEW']) kind:
    | 'LIKE'
    | 'VIEW';
}

export class InterestExamplesDto {
  @ApiPropertyOptional({ description: 'Comma-separated topic IDs.' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  interests?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;
}
