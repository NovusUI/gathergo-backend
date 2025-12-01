import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsString } from 'class-validator';

export class RegisterTokenDto {
  @ApiProperty({ description: 'push tokem' })
  @IsString()
  token: string;

  @ApiProperty({ description: 'Starting point coordinates' })
  @IsEnum(['ios', 'android'], { message: 'Platform is either ios or android' })
  platform: 'ios' | 'android';
}
