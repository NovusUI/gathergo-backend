import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImpactReportOutcomeDto {
  @ApiPropertyOptional({
    description: 'Stable client-generated ID for editing a repeated outcome.',
    example: 'trees_25',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  id?: string;

  @ApiProperty({
    description: 'Flexible outcome type used for aggregation later.',
    example: 'trees_planted',
  })
  @IsString()
  @MaxLength(80)
  type: string;

  @ApiProperty({
    description: 'Human-readable outcome label.',
    example: 'Trees planted',
  })
  @IsString()
  @MaxLength(120)
  label: string;

  @ApiProperty({
    description: 'Reported outcome value.',
    example: 25,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  value: number;

  @ApiProperty({
    description: 'Outcome unit.',
    example: 'trees',
  })
  @IsString()
  @MaxLength(40)
  unit: string;

  @ApiPropertyOptional({
    description: 'Optional context for this outcome.',
    example: 'Seedlings planted along the community road.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  note?: string;
}

export class UpsertEventImpactReportDto {
  @ApiProperty({
    description: 'Creator-written post-event impact summary.',
    example:
      'We cleaned three streets, planted 25 trees, and equipped volunteers for future cleanups.',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  summary: string;

  @ApiProperty({
    description: 'Structured outcomes reported by the creator.',
    type: [ImpactReportOutcomeDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImpactReportOutcomeDto)
  outcomes: ImpactReportOutcomeDto[];

  @ApiPropertyOptional({
    description: 'Optional evidence links, such as photos, posts, or reports.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @IsString({ each: true })
  evidenceLinks?: string[];
}
