import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsString,
} from 'class-validator';
import { ReviewTransactionRiskDto } from './review-transaction-risk.dto';

export class BatchReviewTransactionRiskDto extends ReviewTransactionRiskDto {
  @ApiProperty({ type: [String], maxItems: 50 })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  transactionIds: string[];
}
