import { ApiProperty } from '@nestjs/swagger';
import { EventFeedbackRating } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum } from 'class-validator';

export class SaveEventFeedbackDto {
  @ApiProperty({ enum: EventFeedbackRating })
  @IsEnum(EventFeedbackRating)
  rating: EventFeedbackRating;

  @ApiProperty()
  @Transform(({ obj }: { obj: { moreLikeThis: unknown } }) => obj.moreLikeThis)
  @IsBoolean()
  moreLikeThis: boolean;
}
