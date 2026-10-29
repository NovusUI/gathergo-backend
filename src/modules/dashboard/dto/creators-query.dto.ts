import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  CreatorSettlementProfileStatus,
  KycVerificationStatus,
} from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatorsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 20;

  @ApiPropertyOptional({ description: 'Creator ID, name, username or email' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MaxLength(150)
  search?: string;

  @ApiPropertyOptional({ enum: KycVerificationStatus })
  @IsOptional()
  @IsEnum(KycVerificationStatus)
  kycStatus?: KycVerificationStatus;

  @ApiPropertyOptional({ enum: CreatorSettlementProfileStatus })
  @IsOptional()
  @IsEnum(CreatorSettlementProfileStatus)
  payoutStatus?: CreatorSettlementProfileStatus;
}
