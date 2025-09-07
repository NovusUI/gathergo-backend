// src/modules/user-preference/dto/update-preference.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdatePreferenceDto {
  @ApiProperty({ example: ['concert', 'tech meetup'] })
  @IsArray()
  @IsString({ each: true })
  eventTypes: string[];

  @ApiProperty({ example: ['sports', 'music'] })
  @IsArray()
  @IsString({ each: true })
  interests: string[];

  @ApiPropertyOptional({ example: 'Lagos' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ example: 'discover events' })
  @IsOptional()
  @IsString()
  primaryUsage?: string;
}
