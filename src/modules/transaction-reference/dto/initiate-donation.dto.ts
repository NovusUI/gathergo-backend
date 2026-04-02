// src/transaction-reference/dto/initiate-donation.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PaymentClientContextDto,
  PaymentProviderDto,
} from './payment-provider.dto';

export class InitiateDonationDto {
  @ApiProperty({
    description: 'Event ID for the donation',
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsString()
  eventId: string;

  @ApiProperty({
    description: 'Donation amount in naira',
    example: 500,
    minimum: 500,
  })
  @IsNumber()
  @Min(500, { message: 'Minimum donation amount is ₦500' })
  amount: number;

  @ApiProperty({
    description: 'Optional message from donor',
    example: 'Happy to support this great cause!',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  @ApiProperty({
    description: 'Whether donor wants to remain anonymous',
    example: false,
    default: false,
    required: false,
  })
  @IsOptional()
  isAnonymous?: boolean = false;

  @ApiPropertyOptional({
    enum: PaymentProviderDto,
    default: PaymentProviderDto.PAYSTACK,
  })
  @IsOptional()
  @IsEnum(PaymentProviderDto)
  provider?: PaymentProviderDto = PaymentProviderDto.PAYSTACK;

  @ApiPropertyOptional({ type: PaymentClientContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentClientContextDto)
  clientContext?: PaymentClientContextDto;
}
