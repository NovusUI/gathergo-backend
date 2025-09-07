import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

export class ForYouCarpoolDto {
  @ApiPropertyOptional({ description: 'User latitude' })
  @IsOptional()
  latitude?: number;


  @ApiPropertyOptional({ description: 'User longitude' })
  @IsOptional()
  longitude?: number;
}