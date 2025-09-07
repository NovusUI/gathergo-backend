import { ApiProperty } from '@nestjs/swagger';

export class JoinCarpoolDto {
  @ApiProperty({ description: 'User ID of the person joining the carpool' })
  userId: string;
}
