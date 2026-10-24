import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateVolunteerRoleDto {
  @ApiProperty({ example: 'Tree planting volunteers' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @ApiProperty({ example: 'Help prepare the ground and plant seedlings.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description: string;

  @ApiProperty({ example: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  capacity: number;

  @ApiPropertyOptional({ default: true })
  @ValidateIf((o: CreateVolunteerRoleDto) => o.requiresApproval !== undefined)
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
    { toClassOnly: true },
  )
  @IsBoolean()
  requiresApproval?: boolean;
}

export class UpdateVolunteerRoleDto extends PartialType(
  CreateVolunteerRoleDto,
  { skipNullProperties: false },
) {
  @ApiPropertyOptional({
    description: 'Whether this role accepts applications.',
  })
  @ValidateIf((o: UpdateVolunteerRoleDto) => o.isOpen !== undefined)
  @Transform(
    ({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key],
    { toClassOnly: true },
  )
  @IsBoolean()
  isOpen?: boolean;
}
