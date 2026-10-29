import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  RiskStatus,
  SettlementStatus,
  TransactionStatusType,
} from '@prisma/client';

export enum RiskUserRoleDto {
  BUYER = 'buyer',
  CREATOR = 'creator',
}

export class RiskReviewQueueQueryDto {
  @ApiPropertyOptional({
    description: 'Match a user ID, name, username or email',
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  userQuery?: string;

  @ApiPropertyOptional({
    enum: RiskUserRoleDto,
    default: RiskUserRoleDto.BUYER,
  })
  @IsOptional()
  @IsEnum(RiskUserRoleDto)
  userRole?: RiskUserRoleDto = RiskUserRoleDto.BUYER;
  @ApiPropertyOptional({ example: 1, default: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @ApiPropertyOptional({
    enum: RiskStatus,
    description: 'Omit to include every risk status',
  })
  @IsOptional()
  @IsEnum(RiskStatus)
  riskStatus?: RiskStatus;

  @ApiPropertyOptional({
    enum: TransactionStatusType,
    description: 'Omit to include every payment status',
  })
  @IsOptional()
  @IsEnum(TransactionStatusType)
  transactionStatus?: TransactionStatusType;

  @ApiPropertyOptional({ enum: SettlementStatus })
  @IsOptional()
  @IsEnum(SettlementStatus)
  settlementStatus?: SettlementStatus;

  @ApiPropertyOptional({
    example: false,
    description:
      'Filter by whether the transaction has already been manually reviewed',
  })
  @Type(() => String)
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  reviewed?: boolean;
}
