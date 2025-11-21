import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { CoordinateDto } from 'src/common/dtos';

export class JoinCarpoolDto {
  @ApiProperty({ description: 'where you are requesting from' })
  @IsString()
  origin: string;

  @ApiProperty({ description: 'note for pooler' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiProperty({ description: 'Starting point coordinates' })
  @ValidateNested()
  @Type(() => CoordinateDto)
  startPoint?: CoordinateDto;
}
