import { Transform } from 'class-transformer';
import { DashboardAccountStatus, DashboardRole } from '@prisma/client';
import {
  IsByteLength,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

const normalizeUsername = ({ obj }: { obj: Record<string, unknown> }) =>
  typeof obj.username === 'string'
    ? obj.username.trim().toLowerCase()
    : obj.username;
const trimName = ({ obj }: { obj: Record<string, unknown> }) =>
  typeof obj.fullName === 'string' ? obj.fullName.trim() : obj.fullName;
const rawPassword = ({ obj }: { obj: Record<string, unknown> }) => obj.password;

export class DashboardLoginDto {
  @Transform(normalizeUsername)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{2,39}$/)
  username: string;

  @Transform(rawPassword)
  @IsString()
  @IsByteLength(1, 72)
  password: string;
}

export class DashboardPasswordDto {
  @Transform(rawPassword)
  @IsString()
  @MinLength(12)
  @IsByteLength(0, 72)
  password: string;
}

export class ChangeDashboardPasswordDto extends DashboardPasswordDto {
  @Transform(({ obj }: { obj: Record<string, unknown> }) => obj.currentPassword)
  @IsString()
  @IsByteLength(1, 72)
  currentPassword: string;
}

export class CreateDashboardUserDto extends DashboardPasswordDto {
  @Transform(normalizeUsername)
  @IsString()
  @Matches(/^[a-z0-9][a-z0-9._-]{2,39}$/)
  username: string;

  @Transform(trimName)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @IsEnum(DashboardRole)
  role: DashboardRole;
}

export class UpdateDashboardUserDto {
  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @Transform(trimName)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsEnum(DashboardRole)
  role?: DashboardRole;

  @ValidateIf((_object: object, value: unknown) => value !== undefined)
  @IsEnum(DashboardAccountStatus)
  status?: DashboardAccountStatus;
}

export class DashboardUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
