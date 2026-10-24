import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class CreateMessageDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ required: true, description: 'message string' })
  content: string;
  @IsString()
  @IsNotEmpty()
  @ApiProperty({ description: 'Stable client message key, reused for retries' })
  tempId: string;
}
