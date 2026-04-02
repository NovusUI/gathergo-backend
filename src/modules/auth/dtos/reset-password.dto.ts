import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: 'user@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '482913', minLength: 4, maxLength: 6 })
  @IsString()
  @Length(4, 6)
  code: string;

  @ApiProperty()
  @MinLength(6)
  newPassword: string;
}
