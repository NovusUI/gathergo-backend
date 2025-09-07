// create-post.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsArray, IsEnum } from 'class-validator';

export enum PostType {
  TEXT = 'TEXT',
  IMAGE = 'IMAGE',
  POLL = 'POLL',
  SYSTEM = 'SYSTEM',
}

export class CreatePostDto {
  @ApiProperty()
  @IsString()
  @IsOptional()
  eventId?: string;

  @ApiProperty({ enum: PostType })
  @IsEnum(PostType)
  type: PostType;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  content?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  mediaUrls?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  hashtags?: string[];

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  taggedUserIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  communityId?: string;
}
