import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ImpactSuggestionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(140)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1200)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(600)
  impactDescription?: string;

  @ApiPropertyOptional({ enum: ['ticket', 'registration', 'donation'] })
  @IsOptional()
  @IsIn(['ticket', 'registration', 'donation'])
  registrationType?: 'ticket' | 'registration' | 'donation';
}
