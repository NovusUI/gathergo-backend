import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class DeviceTokenService {
  constructor(private prisma: PrismaService) {}

  async saveToken(userId: string, token: string) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      update: { updatedAt: new Date() },
      create: {
        userId,
        token,
      },
    });
  }

  async getTokensByUser(userId: string) {
    const tokens = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    return tokens.map(t => t.token);
  }
}
