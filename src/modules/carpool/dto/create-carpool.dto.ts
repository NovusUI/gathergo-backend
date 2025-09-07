import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Max, Min,  } from 'class-validator';
import { IsAtLeast20MinInFuture } from 'src/common/validators';

export class CreateCarpoolDto {
  @ApiPropertyOptional({ description: 'Optional event ID if this carpool is for an event', required: false })
  @IsUUID()
  @IsOptional()
  eventId?: string;

  @ApiProperty({ description: 'Starting location of the carpool' })
  @IsString()
  origin: string;

  @ApiProperty({ description: 'Destination of the carpool' })
  @IsString()
  destination: string;

  @IsDateString()
  @IsAtLeast20MinInFuture({ message: 'Departure time must be at least 20 minutes in the future' })
  @ApiProperty({ description: 'Date and time of departure', example: '2025-07-20T15:00:00Z' })
  departureTime: Date;

  @ApiProperty({ description: 'Number of seats available' })
  @IsNumber()
  @Min(1)
  @Max(10)
  availableSeats: number;
 
  @ApiProperty({description: 'price per seat', example: 10000})
  @IsNumber()
  pricePerSeat: number;

  @ApiPropertyOptional({description: 'short description of vehicle', example: "a blck pickup"})
  @IsString()
  @IsOptional()
  description?:string


  @ApiPropertyOptional({description: 'latitude'})
  @IsNumber()
  @IsOptional()
  latitude?: number;

  @ApiPropertyOptional({description: 'longitude'})
  @IsNumber()
  @IsOptional()
  longitude?: number;

  @ApiPropertyOptional({description: 'destination latitude'})
  @IsNumber()
  @IsOptional()
  latitudeDest?: number;

  @ApiPropertyOptional({description: 'destination longitude'})
  @IsNumber()
  @IsOptional()
  longitudeDest?: number;

}
