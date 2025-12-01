// create-notification.dto.ts
import { IsString, IsArray, IsOptional, IsEnum } from 'class-validator';

export enum NotificationType {
  SYSTEM = 'system',
  EVENT = 'event',
  CARPOOL = 'carpool',
  MESSAGE = 'message',
}

export class CreateNotificationDto {
  @IsArray()
  @IsString({ each: true })
  recipientIds: string[];

  @IsEnum(NotificationType)
  type: NotificationType;

  @IsString()
  title: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  link?: string;
}
