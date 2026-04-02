import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export enum PaymentProviderDto {
  PAYSTACK = 'PAYSTACK',
  ALAT_TRANSFER = 'ALAT_TRANSFER',
}

export class PaymentClientContextDto {
  @ApiPropertyOptional({ example: 'ios-iphone-15-pro-max' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  deviceId?: string;

  @ApiPropertyOptional({ example: 'ios' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  platform?: string;
}

export class PaymentProviderOptionsDto {
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
