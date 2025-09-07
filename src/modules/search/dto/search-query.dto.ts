import { Type } from 'class-transformer';
import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchQueryDto {
  @ApiProperty({ description: 'Search keyword or phrase' })
  @IsString()
  query: string;

  @ApiPropertyOptional({ enum: ['events', 'users', 'communities'], description: 'Type of entity to search' })
  @IsOptional()
  @IsIn(['events', 'users', 'communities'])
  type?: 'events' | 'users' | 'communities';

  @ApiPropertyOptional({ description: 'Page number for pagination' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number;

  @ApiPropertyOptional({ description: 'Number of results per page' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  pageSize?: number;
}
