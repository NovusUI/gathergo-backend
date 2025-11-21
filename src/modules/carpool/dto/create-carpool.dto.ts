import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsAtLeast20MinInFuture } from 'src/common/validators';
import { CoordinateDto } from 'src/common/dtos';

export class CreateCarpoolDto {
  @ApiPropertyOptional({
    description: 'Optional event ID if this carpool is for an event',
    required: false,
  })
  @IsUUID()
  @IsOptional()
  eventId?: string;

  @ApiProperty({ description: 'Starting location of the carpool' })
  @IsString()
  origin: string;

  @ApiProperty({ description: 'note from pooler' })
  @IsString()
  @IsOptional()
  note?: string;

  @ApiPropertyOptional({ description: 'Destination of the carpool' })
  @IsString()
  @IsOptional()
  destination?: string;

  @IsString()
  @ApiProperty({
    description: 'Date and time of departure',
    example: '15:00',
  })
  departureTime: string;

  @ApiProperty({ description: 'Number of seats available' })
  @IsNumber()
  @Min(1)
  @Max(10)
  @IsOptional()
  availableSeats?: number;

  @ApiProperty({ description: 'Price per seat', example: 10000 })
  @IsNumber()
  @IsOptional()
  pricePerSeat?: number;

  @ApiPropertyOptional({
    description: 'Short description of vehicle',
    example: 'a black pickup',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ description: 'Starting point coordinates' })
  @ValidateNested()
  @Type(() => CoordinateDto)
  startPoint?: CoordinateDto;

  @ApiPropertyOptional({ description: 'Destination point coordinates' })
  @IsOptional()
  @ValidateNested()
  @Type(() => CoordinateDto)
  endPoint?: CoordinateDto;
}
