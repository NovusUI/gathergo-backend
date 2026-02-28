import { Injectable } from '@nestjs/common';
import { FeedService } from './feed.service';

@Injectable()
export class FeedIntegrationService {
  constructor(private readonly feedService: FeedService) {}

  async onTicketPurchased(
    eventId: string,
    userId: string,
    ticketId: string,
    eventTicketId: string,
  ) {
    return this.feedService.generateTicketPurchaseFeed(
      eventId,
      userId,
      ticketId,
      eventTicketId,
    );
  }

  async onDonationMade(
    eventId: string,
    userId: string,
    donationId: string,
    amount: number,
    isAnonymous: boolean = false,
  ) {
    return this.feedService.generateDonationFeed(
      eventId,
      donationId,
      amount,
      isAnonymous,
      userId,
    );
  }

  async onRegistrationCompleted(
    eventId: string,
    userId: string,
    registrationId: string,
  ) {
    return this.feedService.generateRegistrationFeed(
      eventId,
      userId,
      registrationId,
    );
  }

  async onEventCreated(eventId: string, userId: string) {
    return this.feedService.generateEventCreatedFeed(eventId, userId);
  }

  async updateTicketProgress(eventId: string) {
    const ticketsSold = await this.feedService['getEventTicketsSold'](eventId);
    const totalTickets =
      await this.feedService['getEventTotalTickets'](eventId);

    return this.feedService.generateProgressMilestoneFeed(
      eventId,
      'TICKET',
      ticketsSold,
      totalTickets,
    );
  }

  async updateDonationProgress(eventId: string) {
    const totalDonations =
      await this.feedService['getEventTotalDonations'](eventId);
    const donationTarget =
      await this.feedService['getEventDonationTarget'](eventId);

    return this.feedService.generateProgressMilestoneFeed(
      eventId,
      'DONATION',
      totalDonations,
      donationTarget,
    );
  }

  async updateRegistrationProgress(eventId: string) {
    const registrationsCount =
      await this.feedService['getEventRegistrationsCount'](eventId);
    const registrationLimit =
      await this.feedService['getEventRegistrationLimit'](eventId);

    return this.feedService.generateProgressMilestoneFeed(
      eventId,
      'REGISTRATION',
      registrationsCount,
      registrationLimit,
    );
  }
}
