import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { RegistrationType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { UpdateEventDto } from '../../event/dto/update-event.dto';

export enum InternalEventStatus {
  UPCOMING = 'UPCOMING',
  LIVE = 'LIVE',
  ENDED = 'ENDED',
}
export class InternalEventsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page: number = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize: number = 20;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  creatorId?: string;
  @ApiPropertyOptional({ enum: RegistrationType })
  @IsOptional()
  @IsEnum(RegistrationType)
  registrationType?: RegistrationType;
  @ApiPropertyOptional({ enum: InternalEventStatus })
  @IsOptional()
  @IsEnum(InternalEventStatus)
  status?: InternalEventStatus;
}

export class UpdateInternalEventDto extends PickType(UpdateEventDto, [
  'isPhysicalEvent',
  'location',
  'links',
  'tags',
] as const) {
  @ApiProperty({ description: 'updatedAt from the currently reviewed event' })
  @IsDateString()
  expectedUpdatedAt: string;

  @ApiPropertyOptional()
  @ValidateIf((_obj: object, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @ValidateIf((_obj: object, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  description?: string;

  @ApiPropertyOptional()
  @ValidateIf((_obj: object, value: unknown) => value !== undefined)
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional()
  @ValidateIf((_obj: object, value: unknown) => value !== undefined)
  @IsDateString()
  endDate?: string;
}
