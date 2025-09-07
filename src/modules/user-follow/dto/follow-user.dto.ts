import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class FollowUserDto {
  @ApiProperty({ example: 'uuid-of-user-to-follow' })
  @IsNotEmpty()
  @IsUUID()
  followingId: string;
}
