import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { SettlementStatus, TransactionStatusType } from '@prisma/client';
import { ReviewableRiskStatusDto } from './review-transaction-risk.dto';

export class RiskReviewQueueQueryDto {
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

  @ApiPropertyOptional({ enum: ReviewableRiskStatusDto })
  @IsOptional()
  @IsEnum(ReviewableRiskStatusDto)
  riskStatus?: ReviewableRiskStatusDto;

  @ApiPropertyOptional({ enum: TransactionStatusType })
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
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsOptional()
  @IsBoolean()
  reviewed?: boolean;
}
