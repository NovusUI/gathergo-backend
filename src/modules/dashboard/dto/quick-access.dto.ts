import { ApiProperty } from '@nestjs/swagger';

export class QuickAccessItemDto {
  @ApiProperty({
    example: 'feed500',
    description: 'Unique identifier for the shortcut',
  })
  id: string;

  @ApiProperty({
    example: 'Feed500',
    description: 'Display title of the shortcut',
  })
  title: string;

  @ApiProperty({
    example: 'events/feed500',
    description: 'Navigation link/path',
  })
  link: string;

  @ApiProperty({ example: '#5669FF', description: 'Icon color in hex format' })
  iconColor: string;
}

export class QuickAccessResponseDto {
  @ApiProperty({
    type: [QuickAccessItemDto],
    description: 'List of quick access items',
  })
  shortcuts: QuickAccessItemDto[];

  @ApiProperty({
    example: 'Quick access items retrieved successfully',
    description: 'Success message',
  })
  message: string;

  @ApiProperty({ example: true, description: 'Success indicator' })
  success: boolean;
}
