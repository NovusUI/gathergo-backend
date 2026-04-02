import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MailSettingsService } from './mail-settings.service';
import { MailDispatchResult, MailFeature } from './mail.types';

export interface EmailData {
  to: string | string[];
  subject?: string;
  templateKey?: string;
  variables?: Record<string, any>;
  jobId?: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  attachments?: any[];
}

// Email Verification Code
export interface EmailVerificationCodeData extends EmailData {
  name: string;
  code: string;
  expiresInMinutes?: number;
}

export interface PasswordResetCodeData extends EmailData {
  name: string;
  code: string;
  expiresInMinutes?: number;
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
  qrCode?: string;
  showQrCode?: boolean;
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

export interface ImpactMapData extends EmailData {
  name: string;
  eventTitle: string;
  organizerName?: string;
  eventEndDate?: string;
  donationTarget?: number;
  amountRaised?: number;
  supportersCount?: number;
  impactTitle?: string;
  impactDescription?: string;
  impactPercentage?: number;
  campaignUrl?: string;
  campaignImage?: string;
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
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectQueue('mailQueue') private mailQueue: Queue,
    private readonly mailSettingsService: MailSettingsService,
  ) {}

  // Email Verification Code
  async sendEmailVerificationCode(data: EmailVerificationCodeData) {
    return this.queueMail(
      MailFeature.EMAIL_VERIFICATION_CODE,
      'emailVerificationCode',
      {
        ...data,
        templateKey:
          data.templateKey || MailFeature.EMAIL_VERIFICATION_CODE,
      },
    );
  }

  async sendPasswordResetCode(data: PasswordResetCodeData) {
    return this.queueMail(
      MailFeature.PASSWORD_RESET_CODE,
      'passwordResetCode',
      {
        ...data,
        templateKey: data.templateKey || MailFeature.PASSWORD_RESET_CODE,
      },
    );
  }

  // Ticket Confirmation
  async sendTicketConfirmation(data: TicketConfirmationData) {
    console.log("ticket confirmation")
    return this.queueMail(
      MailFeature.TICKET_CONFIRMATION,
      'ticketConfirmation',
      {
        ...data,
        templateKey: data.templateKey || MailFeature.TICKET_CONFIRMATION,
      },
    );
  }

  // Donation Confirmation
  async sendDonationConfirmation(data: DonationConfirmationData) {
   
    return this.queueMail(
      MailFeature.DONATION_CONFIRMATION,
      'donationConfirmation',
      {
        ...data,
        templateKey: data.templateKey || MailFeature.DONATION_CONFIRMATION,
      },
    );
  }

  // Registration Confirmation
  async sendRegistrationConfirmation(data: RegistrationConfirmationData) {
   
    return this.queueMail(
      MailFeature.REGISTRATION_CONFIRMATION,
      'registrationConfirmation',
      {
        ...data,
        templateKey: data.templateKey || MailFeature.REGISTRATION_CONFIRMATION,
      },
    );
  }

  // Donation Target Reached
  async sendDonationTargetReached(data: DonationTargetReachedData) {
    return this.queueMail(
      MailFeature.DONATION_TARGET_REACHED,
      'donationTargetReached',
      {
        ...data,
        templateKey: data.templateKey || MailFeature.DONATION_TARGET_REACHED,
      },
    );
  }

  async sendImpactMap(data: ImpactMapData) {
    return this.queueMail(MailFeature.IMPACT_MAP, 'impactMap', {
      ...data,
      templateKey: data.templateKey || MailFeature.IMPACT_MAP,
    });
  }

  // Welcome Email
  async sendWelcomeEmail(data: WelcomeEmailData) {
    return this.queueMail(
      MailFeature.WELCOME_EMAIL,
      'welcomeEmail',
      {
        ...data,
        templateKey: data.templateKey || MailFeature.WELCOME_EMAIL,
      },
    );
  }

  // Generic email with custom template
  async sendCustomEmail(data: {
    templateKey: string;
    to: string | string[];
    subject?: string;
    variables: Record<string, any>;
    cc?: string | string[];
    bcc?: string | string[];
    replyTo?: string;
    attachments?: any[];
  }) {
    return this.queueMail(MailFeature.CUSTOM_EMAIL, 'customEmail', data);
  }

  private async queueMail(
    feature: MailFeature,
    jobName: string,
    data: Record<string, any>,
  ): Promise<MailDispatchResult> {
    const templateKey = String(data.templateKey || feature);
    const state = this.mailSettingsService.explainFeatureState(
      feature,
      templateKey,
    );

    if (!state.enabled) {
      this.logger.warn(
        `Skipping ${feature} mail queueing for template ${templateKey}: ${state.reason}`,
      );
      return {
        feature,
        templateKey,
        queued: false,
        skipped: true,
        reason: state.reason,
      };
    }

    const payload = {
      ...data,
      feature,
    };

    if (data.jobId) {
      await this.mailQueue.add(jobName, payload, {
        jobId: String(data.jobId),
      });
    } else {
      await this.mailQueue.add(jobName, payload);
    }

    this.logger.log(`Queued ${feature} mail job for template ${templateKey}`);

    return {
      feature,
      templateKey,
      queued: true,
      skipped: false,
    };
  }
}
