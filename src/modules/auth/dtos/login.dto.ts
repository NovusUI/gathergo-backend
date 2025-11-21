import { IsEmail, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({ example: 'deybollar@gmail.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'deboskilala' })
  @IsNotEmpty()
  password: string;
}

export class RefreshDto {
  @ApiProperty({ example: 'your-refresh-token' })
  @IsNotEmpty()
  refreshToken: string;
}
