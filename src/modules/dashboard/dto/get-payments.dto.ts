import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsInt, Min, IsString } from 'class-validator';

export class GetPaymentsDto {
  @ApiProperty({ default: 1, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  page?: number = 1;

  @ApiProperty({ default: 10, required: false })
  @IsInt()
  @Min(1)
  @IsOptional()
  pageSize?: number = 10;

  @ApiProperty({ required: false, description: 'Filter by event ID' })
  @IsString()
  @IsOptional()
  eventId?: string;
}
