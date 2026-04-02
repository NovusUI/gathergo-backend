import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsDateString,
  IsBoolean,
  IsEmail,
  IsUUID,
  IsNumber,
} from 'class-validator';

export class GrantPermissionDto {
  @ApiProperty({
    description: 'User ID to grant permission to',
    example: 'uuid-of-user',
  })
  @IsUUID()
  @IsOptional()
  scannerId?: string;

  @ApiProperty({
    description: 'User email (alternative to scannerId)',
    required: false,
  })
  @IsEmail()
  @IsOptional()
  userEmail?: string;

  @ApiProperty({
    description: 'Permission expiration date (ISO string)',
    required: false,
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export class UpdatePermissionDto {
  @ApiProperty({
    description: 'Activate/deactivate permission',
    required: false,
  })
  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @ApiProperty({
    description: 'Update expiration date',
    required: false,
    example: '2024-12-31T23:59:59.999Z',
  })
  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export class PermissionResponseDto {
  id: string;
  scannerId: string;
  ownerId: string;
  scanner: {
    id: string;
    username?: string | null;
    fullName?: string | null;
    profilePicUrl?: string | null;
  };
  owner: {
    id: string;
    username?: string | null;
    fullName?: string | null;
    profilePicUrl?: string | null;
  };
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  // Optional: include events if needed for UI
  accessibleEvents?: Array<{
    id: string;
    title: string;
    startDate: Date;
    location?: string;
  }>;
}

export class SearchUsersDto {
  @ApiProperty({ description: 'Search by email', required: false })
  @IsString()
  @IsOptional()
  email?: string;

  @ApiProperty({ description: 'Search by username', required: false })
  @IsString()
  @IsOptional()
  username?: string;

  @ApiProperty({ description: 'Search by full name', required: false })
  @IsString()
  @IsOptional()
  fullName?: string;

  @ApiProperty({
    description: 'Limit results',
    required: false,
    default: 10,
  })
  @IsNumber()
  @IsOptional()
  limit?: number = 10;

  @ApiProperty({
    description: 'Exclude users who already have permission',
    required: false,
    default: true,
  })
  @IsBoolean()
  @IsOptional()
  excludePermitted?: boolean = true;
}
