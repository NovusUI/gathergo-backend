import { ApiProperty } from '@nestjs/swagger';
import { ShortLinkKind } from '@prisma/client';
import { IsEnum, IsUUID, Matches } from 'class-validator';

export class CreateShortLinkDto {
  @ApiProperty({ enum: ShortLinkKind })
  @IsEnum(ShortLinkKind)
  kind: ShortLinkKind;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  targetId: string;
}

export class ShortCodeDto {
  @ApiProperty({ example: '8nQ4xK2p' })
  @Matches(/^[A-Za-z0-9_-]{8}$/)
  code: string;
}
