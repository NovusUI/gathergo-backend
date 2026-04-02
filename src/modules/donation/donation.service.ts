// src/services/donation.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';
import { CreateDonationDto } from './dto/create-donation.dto';
import { NotificationService } from '../notification/notification.service';
import { notificationConstants } from 'src/common/constants';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class DonationService {
  private readonly logger = new Logger(DonationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly feedIntegrationService: FeedIntegrationService,
    private readonly mailService: MailService,
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

    // Note: The DTO validates the minimum amount in naira before payment
    // But we can double-check here for safety
    if (amount < 50000) {
      throw new BadRequestException('Minimum donation amount is ₦500');
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
              username: true,
              email: true,
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
        message: notificationConstants.EVENT_DONATION_MESSAGE(
          username,
          amount / 100,
        ),
        type: notificationConstants.EVENT_DONATION,
        imageUrl: event.thumbnailUrl || '',
        data: {
          eventId,
        },
        link: '/event/' + eventId,
      })
      .then(() => {});

    // Generate feed for donation
    this.feedIntegrationService
      .onDonationMade(
        eventId,
        userId,
        result.id,
        amount,
        isAnonymous,
        message,
      )
      .then(() => {});

    await this.queueDonationConfirmationEmail(result);

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

  private async queueDonationConfirmationEmail(donation: {
    id: string;
    amount: number;
    transactionId: string;
    user: {
      email?: string | null;
      username?: string | null;
      fullName?: string | null;
    };
    event: {
      title: string;
    };
  }) {
    if (!donation.user.email) {
      return;
    }

    const transaction = await this.prisma.transactionReference.findUnique({
      where: { id: donation.transactionId },
      select: {
        paymentProvider: true,
      },
    });

    try {
      const result = await this.mailService.sendDonationConfirmation({
        to: donation.user.email,
        name: this.resolveDisplayName(donation.user),
        amount: donation.amount / 100,
        currency: 'NGN',
        campaignTitle: donation.event.title,
        paymentMethod: transaction?.paymentProvider || 'Card',
      });

      if (result.skipped) {
        this.logger.warn(
          `Skipped donation confirmation email for ${donation.user.email}: ${result.reason}`,
        );
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'unknown mail error';
      this.logger.warn(
        `Failed to queue donation confirmation email for ${donation.user.email}: ${reason}`,
      );
    }
  }

  private resolveDisplayName(user: {
    email?: string | null;
    username?: string | null;
    fullName?: string | null;
  }) {
    const preferredName = user.fullName?.trim() || user.username?.trim();
    if (preferredName) {
      return preferredName;
    }

    return user.email?.split('@')[0]?.trim() || 'there';
  }
}
