// src/services/donation.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDonationDto } from './dto/create-donation.dto';
import { NotificationService } from '../notification/notification.service';
import { notificationConstants } from 'src/common/constants';

@Injectable()
export class DonationService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) {}

  async createDonation(
    createDonationDto: CreateDonationDto,
    userId: string,
    username: string,
  ) {
    const { eventId, amount, message, isAnonymous, transactionId } =
      createDonationDto;

    // Check if event exists
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Verify event is donation type
    if (event.registrationType !== 'donation') {
      throw new BadRequestException('Event is not a donation event');
    }

    // Note: The @Min(50000) decorator in DTO already validates minimum amount
    // But we can double-check here for safety
    if (amount < 50000) {
      throw new BadRequestException(
        'Minimum donation amount is ₦50,000 (50000 kobo)',
      );
    }

    // Create donation in transaction to update total
    const result = await this.prisma.$transaction(async (tx) => {
      // Create donation
      const donation = await tx.donation.create({
        data: {
          userId,
          eventId,
          amount,
          message,
          isAnonymous: isAnonymous || false,
          transactionId,
          status: 'completed', // assuming payment already verified
        },
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              profilePicUrl: true,
            },
          },
          event: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      // Update event total donations

      return donation;
    });
    this.notificationService
      .createNotification({
        recipientIds: [event.creatorId],
        title: notificationConstants.EVENT_DONATION_TITLE,
        message: notificationConstants.EVENT_DONATION_MESSAGE(username, amount),
        type: notificationConstants.EVENT_DONATION,
        imageUrl: event.thumbnailUrl || '',
        data: {
          eventId,
        },
        link: '/event/' + eventId,
      })
      .then(() => {});

    return this.formatDonationResponse(result);
  }

  async getEventDonations(eventId: string) {
    // Check if event exists
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Get donations for this event
    const donations = await this.prisma.donation.findMany({
      where: { eventId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePicUrl: true,
          },
        },
        event: {
          select: {
            id: true,
            title: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return donations.map((donation) => this.formatDonationResponse(donation));
  }

  private formatDonationResponse(donation: any) {
    return {
      id: donation.id,
      amount: donation.amount,
      amountInNaira: donation.amount / 100, // Convert kobo to Naira
      status: donation.status,
      createdAt: donation.createdAt,
      message: donation.message,
      isAnonymous: donation.isAnonymous,
      transactionId: donation.transactionId,
      event: donation.event,
      donor: donation.isAnonymous
        ? undefined
        : {
            id: donation.user.id,
            fullName: donation.user.fullName,
            profilePicUrl: donation.user.profilePicUrl,
          },
    };
  }
}
