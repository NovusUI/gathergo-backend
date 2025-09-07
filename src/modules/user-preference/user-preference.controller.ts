// src/modules/user-preference/user-preference.controller.ts
import { Controller, Patch, Get, Body, UseGuards } from '@nestjs/common';
import { UserPreferenceService } from './user-preference.service';
import { UpdatePreferenceDto } from './dto/update-preference.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';

import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';

@ApiTags('User Preference')
@Controller('preferences')
export class UserPreferenceController {
  constructor(private readonly prefService: UserPreferenceService) {}

  @Patch()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set or update user preferences' })
  @UseGuards(JwtAuthGuard)
  async update(@CurrentUser('id') userId: string, @Body() dto: UpdatePreferenceDto) {
    return this.prefService.updatePreferences(userId, dto);
  }

  @Get()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user preferences' })
  @UseGuards(JwtAuthGuard)
  async get(@CurrentUser('id') userId: string) {
    return this.prefService.getPreferences(userId);
  }
}
