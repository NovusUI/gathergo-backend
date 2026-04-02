import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class InternalAdminOverviewQueryDto {
  @ApiPropertyOptional({ example: 6, default: 6 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  upcomingLimit?: number = 6;

  @ApiPropertyOptional({ example: 6, default: 6 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  activityLimit?: number = 6;
}
