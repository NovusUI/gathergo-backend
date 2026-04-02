import { Injectable } from '@nestjs/common';
import { FeedService, TicketPurchaseBatchItem } from './feed.service';

@Injectable()
export class FeedIntegrationService {
  constructor(private readonly feedService: FeedService) {}

  async onTicketPurchased(
    eventId: string,
    userId: string,
    ticketId: string,
    eventTicketId: string,
  ) {
    return this.onTicketPurchaseBatch(eventId, userId, [
      {
        eventTicketId,
        ticketIds: [ticketId],
        quantity: 1,
      },
    ]);
  }

  async onTicketPurchaseBatch(
    eventId: string,
    userId: string,
    purchases: TicketPurchaseBatchItem[],
  ) {
    return this.feedService.generateTicketPurchaseBatchFeed(
      eventId,
      userId,
      purchases,
    );
  }

  async onDonationMade(
    eventId: string,
    userId: string,
    donationId: string,
    amount: number,
    isAnonymous: boolean = false,
    supportMessage?: string | null,
  ) {
    return this.feedService.generateDonationFeed(
      eventId,
      donationId,
      amount,
      isAnonymous,
      userId,
      supportMessage,
    );
  }

  async onRegistrationCompleted(
    eventId: string,
    userId: string,
    registrationId?: string | null,
    options?: {
      beneficiaryType?: 'SELF' | 'SPONSORED';
      sponsorshipNote?: string | null;
    },
  ) {
    return this.feedService.generateRegistrationFeed(
      eventId,
      userId,
      registrationId || null,
      options,
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
