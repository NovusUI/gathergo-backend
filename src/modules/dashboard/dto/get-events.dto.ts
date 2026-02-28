import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsInt, Min } from 'class-validator';

export enum EventFilter {
  ALL = 'all',
  UPCOMING = 'upcoming',
  PAST = 'past',
}

export class GetEventsDto {
  @ApiProperty({
    enum: EventFilter,
    default: EventFilter.UPCOMING,
    required: false,
  })
  @IsEnum(EventFilter)
  @IsOptional()
  filter?: EventFilter = EventFilter.UPCOMING;

  @ApiProperty({ default: 1, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ default: 10, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  pageSize?: number = 10;
}
