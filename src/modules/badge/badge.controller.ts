import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BadgeCode } from '@prisma/client';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { BadgeService } from './badge.service';
import { BadgeVisibilityDto } from './dto/badge-visibility.dto';

@ApiTags('Badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('badges')
export class BadgeController {
  constructor(private readonly badges: BadgeService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Get your earned badges, live progress and Gogo guidance',
  })
  getMine(@CurrentUser('id') userId: string) {
    return this.badges.getMine(userId);
  }

  @Get('users/:userId')
  @ApiOperation({ summary: 'Get only the badges a user displays publicly' })
  getPublic(@Param('userId') userId: string) {
    return this.badges.getPublic(userId);
  }

  @Patch('me/:code/visibility')
  @ApiOperation({
    summary: 'Choose whether an earned badge appears on your public profile',
  })
  setVisibility(
    @CurrentUser('id') userId: string,
    @Param('code', new ParseEnumPipe(BadgeCode)) code: BadgeCode,
    @Body() dto: BadgeVisibilityDto,
  ) {
    return this.badges.setVisibility(userId, code, dto.isPublic);
  }
}
