// src/users/dtos/complete-profile.dto.ts

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, Matches, IsOptional, IsDateString, IsEnum, IsLowercase } from 'class-validator';

export enum Gender {
    MALE = 'MALE',
    FEMALE = 'FEMALE',
    OTHER = 'OTHER',
}

export class CompleteProfileDto {
  @ApiProperty({
    example: 'Adebola Aderemilateef',
    description: 'user fullname',
  })

  @IsNotEmpty()
  fullName: string;

  @ApiProperty({
    example: 'john_doe',
    description: 'Unique username',
  })
  @IsNotEmpty()
  @Matches(/^[a-z0-9_.]+$/, {
    message: 'Username can only contain letters, numbers, underscores, and dots',
  })
  username: string;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  @IsOptional()
  profilePicUrl?: string;

  @ApiPropertyOptional({ example: '+2348012345678' })
  @IsOptional()
  phoneNumber?: string;

  @ApiProperty({ example: '1990-05-12' })
  @IsNotEmpty()
  @IsDateString()
  birthDate: string;

  @ApiProperty({ example: 'Nigeria' })
  @IsNotEmpty()
  nationality: string;

  @ApiPropertyOptional({ enum: Gender, example: Gender.MALE })
  @IsEnum(Gender)
  gender: Gender;
}
