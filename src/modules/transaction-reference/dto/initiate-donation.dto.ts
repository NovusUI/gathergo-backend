// src/transaction-reference/dto/initiate-donation.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InitiateDonationDto {
  @ApiProperty({
    description: 'Event ID for the donation',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  eventId: string;

  @ApiProperty({
    description: 'Donation amount in kobo (₦50,000 = 50000 kobo)',
    example: 50000,
    minimum: 50000,
  })
  @IsNumber()
  @Min(50000, { message: 'Minimum donation amount is ₦50,000 (50000 kobo)' })
  amount: number; // in kobo

  @ApiProperty({
    description: 'Optional message from donor',
    example: 'Happy to support this great cause!',
    required: false,
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({
    description: 'Whether donor wants to remain anonymous',
    example: false,
    default: false,
    required: false,
  })
  @IsOptional()
  isAnonymous?: boolean = false;
}
