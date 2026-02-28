import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export interface EmailData {
  to: string | string[];
  subject: string;
  variables?: Record<string, any>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: any[];
}

// Ticket Confirmation
export interface TicketConfirmationData extends EmailData {
  name: string;
  eventTitle: string;
  eventDate?: string;
  venue?: string;
  ticketId?: string;
  ticketType?: string;
  price?: number;
  quantity?: number;
  eventImage?: string;
  qrCode?: string;
}

// Donation Confirmation
export interface DonationConfirmationData extends EmailData {
  name: string;
  amount: number;
  currency?: string;
  donationId?: string;
  campaignTitle?: string;
  campaignId?: string;
  paymentMethod?: string;
  isRecurring?: boolean;
  recurrence?: string;
  taxReceipt?: boolean;
}

// Registration Confirmation
export interface RegistrationConfirmationData extends EmailData {
  name: string;
  eventTitle?: string;
  eventDate?: string;
  venue?: string;
  registrationId?: string;
  registrationType?: string;
  confirmationCode?: string;
  loginUrl?: string;
  profileUrl?: string;
}

// Donation Target Reached
export interface DonationTargetReachedData extends EmailData {
  campaignTitle: string;
  targetAmount: number;
  currentAmount: number;
  donorsCount: number;
  campaignUrl?: string;
  campaignImage?: string;
  organizerName?: string;
}

// Welcome Email
export interface WelcomeEmailData extends EmailData {
  name: string;
  activationLink?: string;
  loginLink?: string;
  profileSetupLink?: string;
}

@Injectable()
export class MailService {
  constructor(@InjectQueue('mailQueue') private mailQueue: Queue) {}

  // Ticket Confirmation
  async sendTicketConfirmation(data: TicketConfirmationData) {
    await this.mailQueue.add('ticketConfirmation', {
      ...data,
      templateName: 'ticket-confirmation',
    });
  }

  // Donation Confirmation
  async sendDonationConfirmation(data: DonationConfirmationData) {
    await this.mailQueue.add('donationConfirmation', {
      ...data,
      templateName: 'donation-confirmation',
    });
  }

  // Registration Confirmation
  async sendRegistrationConfirmation(data: RegistrationConfirmationData) {
    await this.mailQueue.add('registrationConfirmation', {
      ...data,
      templateName: 'registration-confirmation',
    });
  }

  // Donation Target Reached
  async sendDonationTargetReached(data: DonationTargetReachedData) {
    await this.mailQueue.add('donationTargetReached', {
      ...data,
      templateName: 'donation-target-reached',
    });
  }

  // Welcome Email
  async sendWelcomeEmail(data: WelcomeEmailData) {
    await this.mailQueue.add('welcomeEmail', {
      ...data,
      templateName: 'welcome',
    });
  }

  // Generic email with custom template
  async sendCustomEmail(data: {
    templateName: string;
    to: string | string[];
    subject: string;
    variables: Record<string, any>;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    attachments?: any[];
  }) {
    await this.mailQueue.add('customEmail', data);
  }
}
