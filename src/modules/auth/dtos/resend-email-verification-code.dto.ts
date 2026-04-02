import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class ResendEmailVerificationCodeDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;
}
