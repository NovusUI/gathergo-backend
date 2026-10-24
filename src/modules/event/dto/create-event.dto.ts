import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
  ValidateNested,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { Reoccurring, RegistrationType } from '@prisma/client';
import { IsDateAfterMinutes } from 'src/common/validators/date-min-offset.decorator';
import { IsDateGreaterThan } from 'src/common/validators/date-greater-than.decorator';
import { normalizeEventLinks } from 'src/modules/event/event-links.util';
import { plainToInstance, Transform, Type } from 'class-transformer';
import { CreateVolunteerRoleDto } from '../../volunteer/dto/create-volunteer-role.dto';

const coerceBoolean = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === true || value === 'true' || value === 1 || value === '1')
    return true;
  if (value === false || value === 'false' || value === 0 || value === '0')
    return false;
  return value;
};

const isPhysicalEventEnabled = (value: unknown) =>
  value !== false && value !== 'false';

const parseJsonArray = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }

  return undefined;
};

export class CreateEventDto {
  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  title: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  description: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  impactTitle?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(180)
  impactDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  impactPercentage?: number;

  @ApiPropertyOptional({ type: 'array' })
  @IsOptional()
  @Transform(({ value }) => parseJsonArray(value))
  @IsArray()
  impactSdgGoals?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: 'array' })
  @IsOptional()
  @Transform(({ value }) => parseJsonArray(value))
  @IsArray()
  impactPaths?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: 'array' })
  @IsOptional()
  @Transform(({ value }) => parseJsonArray(value))
  @IsArray()
  impactCommitments?: Record<string, unknown>[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  impactMapSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  impactMapGeneratedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  imageUrl?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Transform(({ obj, key }) => coerceBoolean(obj?.[key]), { toClassOnly: true })
  @IsBoolean()
  isPhysicalEvent?: boolean;

  @ApiPropertyOptional()
  @Transform(({ value, obj }) => {
    if (!isPhysicalEventEnabled(coerceBoolean(obj?.isPhysicalEvent))) {
      return undefined;
    }

    return typeof value === 'string' ? value.trim() : value;
  })
  @ValidateIf((o) => isPhysicalEventEnabled(o.isPhysicalEvent))
  @IsNotEmpty()
  @IsString()
  location?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsUrl({}, { each: true })
  @Transform(({ value }) => normalizeEventLinks(value))
  links?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Event interests, as an array or a JSON-encoded multipart array.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (typeof value === 'string' && value.trim().startsWith('[')) {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }

    return Array.isArray(value) ? value : [value];
  })
  tags?: string[];

  @ApiProperty()
  @IsDateString()
  @IsDateAfterMinutes(20, {
    message: 'Start date must be at least 30 minutes from now',
  })
  startDate: string;

  @ApiProperty()
  @IsDateString()
  @IsDateGreaterThan('startDate', {
    message: 'End date must be after start date',
  })
  endDate: string;

  @ApiPropertyOptional({ enum: Reoccurring, default: Reoccurring.NONE })
  @IsOptional()
  @IsEnum(Reoccurring)
  reoccurring?: Reoccurring;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  communityId?: string;

  // ✅ Registration type
  @ApiProperty({ enum: RegistrationType })
  @IsEnum(RegistrationType)
  @IsNotEmpty()
  registrationType: RegistrationType;

  // ✅ Only required if registrationType = 'registration'
  @ApiPropertyOptional()
  @ValidateIf((o) => o.registrationType === RegistrationType.registration)
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  registrationAttendees?: number;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.registrationType === RegistrationType.registration)
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  registrationFee?: number;

  @ApiPropertyOptional()
  @ValidateIf(
    (o: CreateEventDto) =>
      o.registrationType === RegistrationType.donation ||
      o.donationTarget !== undefined,
  )
  @IsNotEmpty()
  @IsNumber()
  @Min(500000)
  donationTarget?: number;

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((o) => o.registrationType === RegistrationType.ticket)
  @IsArray()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  tickets?: string[];

  @ApiPropertyOptional({
    default: false,
    description: 'Accept optional donations independently of participation.',
  })
  @IsOptional()
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
      coerceBoolean(obj[key]),
    { toClassOnly: true },
  )
  @IsBoolean()
  donationsEnabled?: boolean;

  @ApiPropertyOptional({
    type: [CreateVolunteerRoleDto],
    description:
      'Required and available only for Volunteer and donation events, with a physical venue and impact story. Donations remain optional.',
  })
  @ValidateIf(
    (o: CreateEventDto) =>
      o.registrationType === RegistrationType.volunteer ||
      o.volunteerRoles !== undefined,
  )
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? plainToInstance(CreateVolunteerRoleDto, parsed)
        : parsed;
    } catch {
      return value;
    }
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateVolunteerRoleDto)
  volunteerRoles?: CreateVolunteerRoleDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.reoccurring !== Reoccurring.NONE && o.endRepeat !== null)
  @IsDateString()
  @IsDateGreaterThan('endDate', {
    message: 'End repeat must be after end date',
  })
  endRepeat?: string;
}
