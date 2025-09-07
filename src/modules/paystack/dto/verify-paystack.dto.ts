import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class VerifyPaystackDto {
  @ApiProperty({ description: 'Paystack transaction reference' })
  @IsString()
  reference: string;
}
