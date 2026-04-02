import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MailDeliveryService } from './mail-delivery.service';
import { MailSettingsService } from './mail-settings.service';
import {
  MailFeature,
  MailTemplateVariables,
} from './mail.types';

@Processor('mailQueue')
@Injectable()
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  constructor(
    private readonly mailDeliveryService: MailDeliveryService,
    private readonly mailSettingsService: MailSettingsService,
  ) {
    super();
  }

  async process(job: Job) {
    const feature = this.resolveFeature(job.name, job.data);
    const templateKey = String(job.data?.templateKey || feature);
    const state = this.mailSettingsService.explainFeatureState(
      feature,
      templateKey,
    );

    if (!state.enabled) {
      this.logger.log(
        `Skipping queued email job ${job.id} for ${feature}: ${state.reason}`,
      );
      return;
    }

    const templateId = this.mailSettingsService.getTemplateId(templateKey);
    if (!templateId) {
      this.logger.warn(
        `Skipping queued email job ${job.id} for ${feature}: template ${templateKey} is not configured`,
      );
      return;
    }
 
    console.log("first leg")

    try {
      await this.mailDeliveryService.sendTemplate(feature, {
        to: this.asRecipients(job.data.to),
        templateId,
        variables: await this.buildVariables(job.name, job.data),
        subject: job.data.subject,
        cc: this.asOptionalRecipients(job.data.cc),
        bcc: this.asOptionalRecipients(job.data.bcc),
        replyTo: job.data.replyTo,
        attachments: job.data.attachments,
      });
    } catch (error) {
      this.logger.error(`Failed to process mail job ${job.id}:`, error);
      throw error;
    }
  }

  private async buildVariables(
    jobName: string,
    data: any,
  ): Promise<MailTemplateVariables> {
    const baseVariables = {
      year: new Date().getFullYear(),
      currentDate: new Date().toLocaleDateString(),
    };

    switch (jobName) {
      case 'emailVerificationCode':
        return {
          ...baseVariables,
          name: data.name,
          code: data.code,
          expiresInMinutes: data.expiresInMinutes ?? 10,
        };

      case 'passwordResetCode':
        return {
          ...baseVariables,
          name: data.name,
          code: data.code,
          expiresInMinutes: data.expiresInMinutes ?? 10,
        };

      case 'ticketConfirmation':
        return {
          ...baseVariables,
          name: data.name,
          eventTitle: data.eventTitle,
          eventDate: data.eventDate || 'TBD',
          venue: data.venue || 'Online',
          ticketId: data.ticketId || 'N/A',
          ticketType: data.ticketType || 'General Admission',
          price: data.price ?? 0,
          quantity: data.quantity || 1,
          totalAmount:
            typeof data.price === 'number' && typeof data.quantity === 'number'
              ? data.price * data.quantity
              : data.price ?? 0,
          eventImage: data.eventImage || '',
          qrCode: data.qrCode || '',
          qrCodeImageUrl: this.buildQrCodeImageUrl(data.qrCode),
          qrCodeSectionStyle: data.qrCode ? 'display:block;' : 'display:none;',
        };

      case 'donationConfirmation':
        return {
          ...baseVariables,
          name: data.name,
          amount: data.amount,
          currency: data.currency || 'USD',
          donationId: data.donationId || 'N/A',
          campaignTitle: data.campaignTitle || 'General Fund',
          campaignId: data.campaignId || '',
          paymentMethod: data.paymentMethod || 'Card',
          isRecurring: data.isRecurring ? 1 : 0,
          recurrence: data.recurrence || 'Monthly',
          taxReceipt: data.taxReceipt ? 1 : 0,
          transactionTime: new Date().toLocaleTimeString(),
          receiptNumber: data.donationId
            ? `REC-${data.donationId}`
            : `REC-${Date.now()}`,
        };

      case 'registrationConfirmation':
        return {
          ...baseVariables,
          name: data.name,
          eventTitle: data.eventTitle || 'Event Registration',
          eventDate: data.eventDate || 'TBD',
          venue: data.venue || 'Online',
          registrationId: data.registrationId || 'N/A',
          registrationType: data.registrationType || 'Attendee',
          confirmationCode: data.confirmationCode || 'N/A',
          qrCode: data.qrCode || '',
          qrCodeImageUrl: this.buildQrCodeImageUrl(data.qrCode),
          qrCodeSectionStyle:
            data.showQrCode && data.qrCode ? 'display:block;' : 'display:none;',
          loginUrl: data.loginUrl || '#',
          profileUrl: data.profileUrl || '#',
          registrationDate: new Date().toLocaleDateString(),
        };

      case 'donationTargetReached':
        return {
          ...baseVariables,
          campaignTitle: data.campaignTitle,
          targetAmount: data.targetAmount,
          currentAmount: data.currentAmount,
          donorsCount: data.donorsCount,
          campaignUrl: data.campaignUrl || '#',
          campaignImage: data.campaignImage || '',
          organizerName: data.organizerName || 'The Campaign Team',
          percentage: this.calculatePercentage(
            data.currentAmount,
            data.targetAmount,
          ),
          achievementDate: new Date().toLocaleDateString(),
          overfundedAmount:
            data.currentAmount > data.targetAmount
              ? data.currentAmount - data.targetAmount
              : 0,
        };

      case 'impactMap':
        return {
          ...baseVariables,
          name: data.name || 'there',
          eventTitle: data.eventTitle || 'Your GatherGo campaign',
          organizerName: data.organizerName || 'the GatherGo community',
          eventEndDate: data.eventEndDate || baseVariables.currentDate,
          donationTarget: this.formatCurrency(data.donationTarget ?? 0),
          amountRaised: this.formatCurrency(data.amountRaised ?? 0),
          supportersCount: data.supportersCount ?? 0,
          impactTitle: data.impactTitle || 'your chosen cause',
          impactDescription:
            data.impactDescription ||
            'This campaign gives back directly to a real-world cause.',
          impactPercentage: data.impactPercentage ?? 100,
          campaignUrl: data.campaignUrl || '#',
          campaignImage: data.campaignImage || '',
        };

      case 'welcomeEmail':
        return {
          ...baseVariables,
          name: data.name,
          activationLink: data.activationLink || '#',
          loginLink: data.loginLink || '#',
          profileSetupLink: data.profileSetupLink || '#',
          signupDate: new Date().toLocaleDateString(),
        };

      default:
        return {
          ...baseVariables,
          ...this.normalizeCustomVariables(data.variables || {}),
        };
    }
  }

  private normalizeCustomVariables(
    variables: Record<string, any>,
  ): MailTemplateVariables {
    return Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [
        key,
        typeof value === 'number' ? value : String(value ?? ''),
      ]),
    );
  }

  private calculatePercentage(currentAmount: number, targetAmount: number) {
    if (!targetAmount) {
      return 0;
    }

    return Math.min(100, Math.round((currentAmount / targetAmount) * 100));
  }

  private formatCurrency(amount: number) {
    return `N${Number(amount || 0).toLocaleString()}`;
  }

  private buildQrCodeImageUrl(value?: string) {
    if (!value) {
      return '';
    }

    const configuredBaseUrl =
      process.env.MAIL_QR_CODE_IMAGE_BASE_URL?.trim() ||
      'https://quickchart.io/qr?size=240&margin=1&text=';

    return `${configuredBaseUrl}${encodeURIComponent(value)}`;
  }

  private resolveFeature(jobName: string, data?: Record<string, any>) {
    if (data?.feature && Object.values(MailFeature).includes(data.feature)) {
      return data.feature as MailFeature;
    }

    switch (jobName) {
      case 'emailVerificationCode':
        return MailFeature.EMAIL_VERIFICATION_CODE;
      case 'passwordResetCode':
        return MailFeature.PASSWORD_RESET_CODE;
      case 'ticketConfirmation':
        return MailFeature.TICKET_CONFIRMATION;
      case 'donationConfirmation':
        return MailFeature.DONATION_CONFIRMATION;
      case 'registrationConfirmation':
        return MailFeature.REGISTRATION_CONFIRMATION;
      case 'donationTargetReached':
        return MailFeature.DONATION_TARGET_REACHED;
      case 'impactMap':
        return MailFeature.IMPACT_MAP;
      case 'welcomeEmail':
        return MailFeature.WELCOME_EMAIL;
      default:
        return MailFeature.CUSTOM_EMAIL;
    }
  }

  private asRecipients(value: string | string[]) {
    return Array.isArray(value) ? value : [value];
  }

  private asOptionalRecipients(value?: string | string[]) {
    if (!value) {
      return undefined;
    }

    return this.asRecipients(value);
  }
}
