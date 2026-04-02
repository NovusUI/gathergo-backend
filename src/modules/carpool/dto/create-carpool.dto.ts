import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
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

const carpoolVehicleIcons = [
  'sport_car',
  'city_car',
  'party_bus',
  'bus',
  'monster_truck',
  'food_truck',
  'mystery_machine',
  'go_kart',
  'moon_buggy',
  'bicycle',
  'speed_boat',
  'boat',
  'pirate_ship',
  'hovercraft',
  'helicopter',
  'stunt_plane',
  'midnight_train',
  'ghost_tram',
  'subway_beast',
  'airplane',
  'rocket',
] as const;

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

  @ApiPropertyOptional({
    description: 'Fun icon shown for the carpool ride',
    enum: carpoolVehicleIcons,
  })
  @IsOptional()
  @IsString()
  @IsIn(carpoolVehicleIcons)
  vehicleIcon?: (typeof carpoolVehicleIcons)[number];

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
