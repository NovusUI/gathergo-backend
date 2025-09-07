
import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';


export enum NotificationType {
  FRIEND_REQUEST = 'friend_request',
  MESSAGE = 'message',
  SYSTEM = 'system',
  CARPOOL_UPDATE = 'carpool_update',
  EVENT_REMINDER = 'event_reminder',
}

export class CreateNotificationDto {
  @IsNotEmpty()
  @IsString()
  @ApiProperty({required:true, description:'receipientId'})
  recipientId: string;

  @IsNotEmpty()
  @IsEnum(NotificationType)
  @ApiProperty({required:true, description:'notification type'})
  type: NotificationType;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({required:true, description:'title'})
  title: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({required:true, description:'message'})
  message: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({required:false, description:'image url'})
  imageUrl?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({required:false, description:'link'})
  link?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({required:false, description:'senderId'})
  senderId?: string;
}