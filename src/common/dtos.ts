import { ApiProperty } from '@nestjs/swagger';
import { IsNumber } from 'class-validator';

export class CoordinateDto {
  @ApiProperty({ example: 6.6018 })
  @IsNumber()
  lat: number;

  @ApiProperty({ example: 3.3515 })
  @IsNumber()
  lng: number;
}
