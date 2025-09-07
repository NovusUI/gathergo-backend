// src/modules/carpool/dto/query-carpool.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class QueryCarpoolDto {
  @ApiPropertyOptional({ description: 'User latitude' })
  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ description: 'User longitude' })
  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @ApiPropertyOptional({ description: 'Page number', default: 1 })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiProperty({ description: 'eventId'})
  @IsOptional()
  @IsUUID()
  eventId?: string;
}
