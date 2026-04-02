import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetPaymentsDto } from '../dto/get-payments.dto';
import { formatPayment } from 'src/utils';

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async getPayments(userId: string, dto: GetPaymentsDto) {
    const { page = 1, pageSize = 10, eventId } = dto;
    const skip = (page - 1) * pageSize;

    const whereClause: any = {
      status: 'SUCCESS',
      event: {
        creatorId: userId, // Only payments for events user OWNS
      },
    };

    if (eventId) {
      whereClause.eventId = eventId;
    } else {
      whereClause.eventId = { not: null };
    }

    const total = await this.prisma.transactionReference.count({
      where: whereClause,
    });
    const payments = await this.prisma.transactionReference.findMany({
      where: whereClause,
      include: {
        event: {
          select: { title: true },
        },
        user: {
          select: { username: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    });

    const formattedPayments = payments.map(formatPayment);

    console.log(formattedPayments,"payable")

    return {
      data: formattedPayments,
      pageSize,
      total,
      page,
      eventId,
    };
  }

}
