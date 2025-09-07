import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, Min, isArray,  } from 'class-validator';

export class CreateEventTicketDto {
 

  @ApiProperty({ example: 'Access to VIP lounge and perks' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 50 })
  @Type(() => Number)
  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  price: number;

  @ApiProperty({ example: 100 })
  @Type(() => Number)
  @IsInt()
  @IsNotEmpty()
  @Min(1)
  quantity: number;

  @ApiProperty({example: 'VIP'})
  @IsString()
  @IsNotEmpty()
  type: string 

  @ApiPropertyOptional({example: ['food','drinks']})
  @IsOptional()
  @IsArray()
  @IsNotEmpty()
  @IsString({ each: true })
  perks?: string[]
}
