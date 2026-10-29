import { ApiProperty } from '@nestjs/swagger';
import { FoodBankCollectionStatus } from '@prisma/client';
import { IsDateString, IsIn } from 'class-validator';

export class UpdateCollectionDto {
  @ApiProperty({
    enum: [
      FoodBankCollectionStatus.OPEN,
      FoodBankCollectionStatus.PAUSED,
      FoodBankCollectionStatus.CLOSED,
    ],
  })
  @IsIn([
    FoodBankCollectionStatus.OPEN,
    FoodBankCollectionStatus.PAUSED,
    FoodBankCollectionStatus.CLOSED,
  ])
  status: FoodBankCollectionStatus;

  @ApiProperty()
  @IsDateString()
  expectedUpdatedAt: string;
}

export class RescheduleCollectionDto {
  @ApiProperty({
    description:
      'New opening date/time; the duration and issued passes are preserved',
  })
  @IsDateString()
  startDate: string;

  @ApiProperty()
  @IsDateString()
  expectedUpdatedAt: string;
}
