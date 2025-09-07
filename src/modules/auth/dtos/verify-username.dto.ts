// src/auth/dtos/verify-username.dto.ts

import { IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyUsernameDto {
  @ApiProperty({
    example: 'john_doe',
    description: 'Desired username to check availability',
  })
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_.]+$/, {
    message: 'Username can only contain letters, numbers, underscores, and dots',
  })
  username: string;
}
