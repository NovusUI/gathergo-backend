import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateTransactionReferenceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
