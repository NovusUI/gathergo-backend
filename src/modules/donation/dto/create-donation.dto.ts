import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateDonationDto {
  @ApiProperty({
    description: 'Event ID',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  eventId: string;

  @ApiProperty({
    description: 'Donation amount in kobo (₦50,000 = 50000 kobo)',
    example: 50000,
  })
  @IsNumber()
  @Min(50000, { message: 'Minimum donation amount is ₦50,000 (50000 kobo)' })
  amount: number; // in kobo

  @ApiPropertyOptional({
    description: 'Optional message from donor',
    example: 'Happy to support this great cause!',
  })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiPropertyOptional({
    description: 'Whether donor wants to remain anonymous',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isAnonymous?: boolean = false;

  @ApiProperty({
    description: 'Payment transaction reference from payment gateway',
    example: 'txn_123456789abcdef',
  })
  @IsString()
  transactionId: string; // payment reference
}
