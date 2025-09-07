import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GoogleLoginDto {
  @ApiProperty({ example: 'GOOGLE_ID_TOKEN' })
  @IsNotEmpty()
  idToken: string;
}
