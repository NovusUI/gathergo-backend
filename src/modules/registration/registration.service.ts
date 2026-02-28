// registration.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { nanoid } from 'nanoid';
import { NotificationService } from '../notification/notification.service';
import { notificationConstants } from 'src/common/constants';
import { FeedIntegrationService } from '../feed/feed-integration.service';

@Injectable()
export class RegistrationService {
  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private feedIntegrationService: FeedIntegrationService,
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
        qrCode: nanoid(16),
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
      .onRegistrationCompleted(eventId, userId, registration.id)
      .then(() => {});

    return registration;
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
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
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
