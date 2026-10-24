import { IsBoolean } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class BadgeVisibilityDto {
  @ApiProperty()
  @Transform(({ obj }: { obj: { isPublic: unknown } }) => obj.isPublic)
  @IsBoolean()
  isPublic: boolean;
}
