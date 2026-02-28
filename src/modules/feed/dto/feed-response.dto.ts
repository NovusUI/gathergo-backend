// src/modules/feed/dtos/feed-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class FeedActionDto {
  @ApiProperty({
    enum: [
      'BUY_TICKET',
      'REGISTER',
      'DONATE',
      'VIEW_TICKETS',
      'VIEW_REGISTRATION',
      'VIEW_DONATIONS',
      'SHARE',
    ],
  })
  type: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  url: string;

  @ApiProperty({ type: Object, required: false })
  metadata?: Record<string, any>;
}

export class UserInfoDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  username: string;

  @ApiProperty()
  profilePicUrlTN: string;

  @ApiProperty()
  displayName: string;
}

export class EventInfoDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  imageUrl: string;
}

export class FeedResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  eventId: string;

  @ApiProperty({
    enum: [
      'TICKET_PURCHASE',
      'TICKET_ALMOST_SOLD_OUT',
      'TICKET_SOLD_OUT',
      'TICKET_PROGRESS_MILESTONE',
      'REGISTRATION_COMPLETE',
      'REGISTRATION_ALMOST_FULL',
      'REGISTRATION_FULL',
      'REGISTRATION_PROGRESS_MILESTONE',
      'DONATION_MADE',
      'DONATION_50_PERCENT',
      'DONATION_75_PERCENT',
      'DONATION_90_PERCENT',
      'DONATION_95_PERCENT',
      'DONATION_100_PERCENT',
      'DONATION_PROGRESS_MILESTONE',
      'DONATION_FRENZY',
      'TICKET_FRENZY',
      'REGISTRATION_FRENZY',
      'CURRENT_FRENZY',
      'EVENT_CREATED',
      'EVENT_TICKET_PINNED',
      'EVENT_REGISTRATION_PINNED',
    ],
  })
  type: string;

  @ApiProperty()
  title: string;

  @ApiProperty({ required: false })
  content?: string;

  @ApiProperty({ required: false })
  userId?: string;

  @ApiProperty({ type: Object })
  metadata: Record<string, any>;

  @ApiProperty({ type: [FeedActionDto] })
  actions: FeedActionDto[];

  @ApiProperty()
  isPinned: boolean;

  @ApiProperty()
  pinOrder: number;

  @ApiProperty()
  isPinnedForUser?: boolean;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: UserInfoDto, required: false })
  user?: UserInfoDto;

  @ApiProperty({ type: EventInfoDto })
  event: EventInfoDto;
}

export class FeedListResponseDto {
  @ApiProperty({ type: [FeedResponseDto] })
  feeds: FeedResponseDto[];

  @ApiProperty()
  hasMore: boolean;
}
