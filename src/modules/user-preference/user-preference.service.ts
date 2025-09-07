// src/modules/user-preference/user-preference.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdatePreferenceDto } from './dto/update-preference.dto';

@Injectable()
export class UserPreferenceService {
  constructor(private prisma: PrismaService) {}

  async updatePreferences(userId: string, dto: UpdatePreferenceDto) {
    let pref = await this.prisma.userPreference.findUnique({ where: { userId } });

    if (!pref) {
      // Create new preference
      pref = await this.prisma.userPreference.create({
        data: {
          userId,
          eventTypes: dto.eventTypes,
          interests: dto.interests,
          location: dto.location,
          primaryUsage: dto.primaryUsage,
        },
      });
    } else {
      // Update existing
      pref = await this.prisma.userPreference.update({
        where: { userId },
        data: {
          eventTypes: dto.eventTypes,
          interests: dto.interests,
          location: dto.location,
          primaryUsage: dto.primaryUsage,
        },
      });
    }

    // Update flag in user table
    await this.prisma.user.update({
      where: { id: userId },
      data: { hasPreferences: true },
    });

    return pref;
  }

  async getPreferences(userId: string) {
    return this.prisma.userPreference.findUnique({ where: { userId } });
  }
}
