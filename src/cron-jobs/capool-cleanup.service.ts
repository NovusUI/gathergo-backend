import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CarpoolCleanupService {
  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async expireOldRequests() {
    const now = new Date();
    const nowPlusOneHour = new Date(now.getTime() + 60 * 60 * 1000);

    // Expire requests if carpool departure time passed or carpool is deleted
    const carpools = await this.prisma.carpool.findMany({
      where: {
        OR: [
          {
            departureTime: { lt: nowPlusOneHour },
          },
          {
            isDeleted: true,
          },
        ],
      },
      select: { id: true },
    });

    const carpoolIds = carpools.map((c) => c.id);

    if (carpoolIds.length === 0) return;

    const result = await this.prisma.carpoolPassenger.updateMany({
      where: {
        carpoolId: { in: carpoolIds },
        status: 'PENDING',
      },
      data: {
        status: 'EXPIRED',
      },
    });

    console.log(`✅ Carpool cleanup: ${result.count} requests expired`);
  }
}
