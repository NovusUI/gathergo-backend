import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum ReviewableRiskStatusDto {
  CLEAR = 'CLEAR',
  REVIEW = 'REVIEW',
  HOLD = 'HOLD',
}

export class ReviewTransactionRiskDto {
  @ApiProperty({ enum: ReviewableRiskStatusDto, example: 'CLEAR' })
  @IsEnum(ReviewableRiskStatusDto)
  riskStatus: ReviewableRiskStatusDto;

  @ApiPropertyOptional({ example: 'Cleared after manual payment review' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
