import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  ValidateIf,
  Min,
} from 'class-validator';

import { Reoccurring } from '@prisma/client';
import { IsDateAfterMinutes } from 'src/common/validators/date-min-offset.decorator';
import { IsDateGreaterThan } from 'src/common/validators/date-greater-than.decorator';
import { Transform } from 'class-transformer';

enum RegistrationType {
  TICKET = 'ticket',
  REGISTRATION = 'registration',
  DONATION = 'donation',
}

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
  @IsUrl()
  imageUrl?: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsString()
  location: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsUrl({}, { each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  links?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
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
  @ValidateIf((o) => o.registrationType === RegistrationType.REGISTRATION)
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  registrationAttendees?: number;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.registrationType === RegistrationType.REGISTRATION)
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  registrationFee?: number;

  @ApiPropertyOptional()
  @ValidateIf((o) => o.registrationType === RegistrationType.DONATION)
  @IsNotEmpty()
  @IsNumber()
  @Min(500000)
  donationTarget?: number;

  @ApiPropertyOptional({ type: [String] })
  @ValidateIf((o) => o.registrationType === RegistrationType.TICKET)
  @IsArray()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  tickets?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((o) => o.reoccurring !== Reoccurring.NONE && o.endRepeat !== null)
  @IsDateString()
  @IsDateGreaterThan('endDate', {
    message: 'End repeat must be after end date',
  })
  endRepeat?: string;
}
