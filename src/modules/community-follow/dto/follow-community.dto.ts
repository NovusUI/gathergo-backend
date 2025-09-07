import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class FollowCommunityDto {
  @ApiProperty({ example: 'uuid-of-community' })
  @IsNotEmpty()
  @IsUUID()
  communityId: string;
}
