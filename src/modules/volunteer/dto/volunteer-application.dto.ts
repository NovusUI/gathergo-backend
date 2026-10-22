import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { VolunteerStatus } from '@prisma/client';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class ApplyToVolunteerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReviewVolunteerDto {
  @ApiProperty({ enum: [VolunteerStatus.ACCEPTED, VolunteerStatus.DECLINED] })
  @IsIn([VolunteerStatus.ACCEPTED, VolunteerStatus.DECLINED])
  status: typeof VolunteerStatus.ACCEPTED | typeof VolunteerStatus.DECLINED;
}

export class CompleteVolunteerDto {
  @ApiProperty({
    description: 'Actual minutes contributed, confirmed by the organiser.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  confirmedMinutes: number;
}
