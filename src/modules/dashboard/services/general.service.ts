import { PrismaService } from 'src/prisma/prisma.service';

export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async getUserEvents(userId: string, dateFilter: any, take: number) {
    return this.prisma.event.findMany({
      where: {
        creatorId: userId, // Only events user CREATED/OWNS
        ...dateFilter,
      },
      include: {
        eventTickets: {
          select: {
            sold: true,
            quantity: true,
            price: true,
          },
        },
        donations: {
          select: {
            amount: true,
          },
        },
        Registration: {
          select: {
            id: true,
          },
        },
      },
      orderBy: dateFilter.endDate?.gte
        ? { startDate: 'asc' }
        : { endDate: 'desc' },
      take,
    });
  }
}
