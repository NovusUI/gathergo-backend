// registration.service.ts
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { generateOpaqueCode } from 'src/common/utils/generate-opaque-code.util';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { notificationConstants } from 'src/common/constants';
import { FeedIntegrationService } from '../feed/feed-integration.service';
import { MailService } from '../mail/mail.service';

@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly feedIntegrationService: FeedIntegrationService,
    private readonly mailService: MailService,
  ) {}

  async createRegistration(
    eventId: string,
    userId: string,
    transactionId: string,
  ) {
    // Check if event exists
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        registrationFee: true,
        thumbnailUrl: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Check if user is already registered
    const existingRegistration = await this.prisma.registration.findFirst({
      where: {
        eventId,
        userId,
        status: 'active',
      },
    });

    if (existingRegistration && event.registrationFee === 0) {
      throw new Error('User is already registered for this event');
    }

    // Create registration
    const registration = await this.prisma.registration.create({
      data: {
        eventId,
        userId,
        qrCode: generateOpaqueCode(16),
        transactionId,
        status: 'active',
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            startDate: true,
            endDate: true,
            location: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    // Send notification to event creator
    this.notificationService
      .createNotification({
        recipientIds: [event.creatorId],
        title: notificationConstants.EVENT_REGISTRATION_TITLE,
        message: notificationConstants.EVENT_REGISTRATION_MESSAGE(
          registration.user.username || registration.user.fullName || 'Someone',
        ),
        type: notificationConstants.EVENT_REGISTRATION,
        imageUrl: event.thumbnailUrl || '',
        data: {
          eventId: event.id,
          registrationId: registration.id,
        },
        link: '/event/' + event.id,
      })
      .then(() => {});

    // Generate feed for registration
    this.feedIntegrationService
      .onRegistrationCompleted(eventId, userId, registration.id, {
        beneficiaryType: 'SELF',
      })
      .then(() => {});

    await this.queueRegistrationConfirmationEmail(registration);

    return registration;
  }

  async recordSponsoredRegistration(
    eventId: string,
    sponsorUserId: string,
    transactionId: string,
    sponsorshipNote?: string | null,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        creatorId: true,
        thumbnailUrl: true,
      },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    const sponsor = await this.prisma.user.findUnique({
      where: { id: sponsorUserId },
      select: {
        username: true,
        fullName: true,
      },
    });

    const sponsorName = sponsor?.username || sponsor?.fullName || 'Someone';

    this.notificationService
      .createNotification({
        recipientIds: [event.creatorId],
        title: notificationConstants.EVENT_REGISTRATION_TITLE,
        message: `${sponsorName} funded a registration spot for your event`,
        type: notificationConstants.EVENT_REGISTRATION,
        imageUrl: event.thumbnailUrl || '',
        data: {
          eventId: event.id,
          transactionId,
          beneficiaryType: 'SPONSORED',
        },
        link: '/event/' + event.id,
      })
      .then(() => {});

    this.feedIntegrationService
      .onRegistrationCompleted(eventId, sponsorUserId, null, {
        beneficiaryType: 'SPONSORED',
        sponsorshipNote: sponsorshipNote || null,
      })
      .then(() => {});

    return {
      eventId,
      sponsorUserId,
      transactionId,
      sponsorshipNote: sponsorshipNote || null,
    };
  }

  async getUserRegistrations(userId: string) {
    return this.prisma.registration.findMany({
      where: { userId, status: 'active' },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            thumbnailUrl: true,
            startDate: true,
            endDate: true,
            location: true,
            registrationType: true,
            isPhysicalEvent: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async queueRegistrationConfirmationEmail(registration: {
    id: string;
    qrCode: string;
    event: {
      id: string;
      title: string;
      startDate: Date;
      location?: string | null;
    };
    user: {
      email: string | null;
      username?: string | null;
      fullName?: string | null;
    };
  }) {
    if (!registration.user.email) {
      return;
    }

    try {
      const result = await this.mailService.sendRegistrationConfirmation({
        to: registration.user.email,
        name: this.resolveDisplayName(registration.user),
        eventTitle: registration.event.title,
        eventDate: registration.event.startDate.toLocaleDateString(),
        venue: registration.event.location || 'Online',
        registrationId: registration.id,
        registrationType: 'Attendee',
        confirmationCode: registration.id,
        qrCode: registration.qrCode,
        showQrCode: false,
        profileUrl: this.buildFrontendUrl(`/event/${registration.event.id}`),
      });

      if (result.skipped) {
        this.logger.warn(
          `Skipped registration confirmation email for ${registration.user.email}: ${result.reason}`,
        );
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'unknown mail error';
      this.logger.warn(
        `Failed to queue registration confirmation email for ${registration.user.email}: ${reason}`,
      );
    }
  }

  private buildFrontendUrl(path: string) {
    const baseUrl = process.env.FRONTEND_URL?.trim();
    if (!baseUrl) {
      return undefined;
    }

    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.replace(/^\/+/, '');
    return `${normalizedBaseUrl}/${normalizedPath}`;
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

  async getEventRegistrations(eventId: string, userId?: string) {
    // Check if event exists
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    // Only event creator can see all registrations
    if (userId && event.creatorId !== userId) {
      throw new Error('Only event creator can view all registrations');
    }

    return this.prisma.registration.findMany({
      where: { eventId, status: 'active' },
      include: {
        user: {
          select: {
            id: true,
            username: true,
            fullName: true,
            profilePicUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  //   async verifyRegistration(qrCode: string, markAsCheckedIn = true) {
  //     const registration = await this.prisma.registration.findUnique({
  //       where: { qrCode },
  //       include: {
  //         event: true,
  //         user: true,
  //       },
  //     });

  //     if (!registration) {
  //       throw new NotFoundException('Registration not found');
  //     }

  //     if (registration.isCheckedIn) {
  //       throw new Error('User already checked in');
  //     }

  //     if (markAsCheckedIn) {
  //       await this.prisma.registration.update({
  //         where: { id: registration.id },
  //         data: { isCheckedIn: true },
  //       });
  //     }

  //     return {
  //       message: 'Registration verified successfully',
  //       registrationId: registration.id,
  //       event: registration.event,
  //       user: {
  //         id: registration.user.id,
  //         name: registration.user.username || registration.user.fullName,
  //       },
  //       isCheckedIn: markAsCheckedIn ? true : registration.isCheckedIn,
  //     };
  //   }

  async cancelRegistration(registrationId: string, userId: string) {
    const registration = await this.prisma.registration.findUnique({
      where: { id: registrationId },
    });

    if (!registration) {
      throw new NotFoundException('Registration not found');
    }

    // Only the registrant or event creator can cancel
    if (registration.userId !== userId) {
      const event = await this.prisma.event.findUnique({
        where: { id: registration.eventId },
        select: { creatorId: true },
      });

      if (event?.creatorId !== userId) {
        throw new Error('Unauthorized to cancel this registration');
      }
    }

    // Update registration status
    await this.prisma.registration.update({
      where: { id: registrationId },
      data: { status: 'cancelled' },
    });

    return { success: true, message: 'Registration cancelled' };
  }
}
