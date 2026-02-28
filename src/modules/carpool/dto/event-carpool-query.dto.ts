import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export enum EventCarpoolFilter {
  ALL = 'all',
  CLOSE_TO_YOU = 'close_to_you',
  FOLLOWED = 'followed',
}

export class EventCarpoolQueryDto {
  @ApiPropertyOptional({ description: 'User latitude' })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ description: 'User longitude' })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: 'Items per page',
    default: 20,
    maximum: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    description: 'Distance cutoff in kilometers for what counts as close',
    default: 10,
    maximum: 200,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  maxDistanceKm?: number = 10;

  @ApiPropertyOptional({
    description: 'Optional filter',
    enum: EventCarpoolFilter,
    default: EventCarpoolFilter.ALL,
  })
  @IsOptional()
  @IsEnum(EventCarpoolFilter)
  filter?: EventCarpoolFilter = EventCarpoolFilter.ALL;
}
