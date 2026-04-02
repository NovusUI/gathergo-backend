import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import {
  MailFeature,
  MailProviderName,
  MailTemplateSendInput,
  MailTemplateVariables,
} from './mail.types';
import { MailSettingsService } from './mail-settings.service';

@Injectable()
export class MailDeliveryService {
  private readonly logger = new Logger(MailDeliveryService.name);
  private resendClient: Resend | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly mailSettingsService: MailSettingsService,
  ) {}

  async sendTemplate(feature: MailFeature, input: MailTemplateSendInput) {
    const provider = this.mailSettingsService.getProvider();

    if (provider === MailProviderName.NOOP) {
      this.logger.log(
        `Skipping outbound email for ${feature} because MAIL_PROVIDER is noop`,
      );
      return;
    }

    if (provider === MailProviderName.RESEND) {
      const resend = this.getResendClient();
      const payload = {
        ...(input.from || this.resolveDefaultFrom()
          ? {
              from: input.from || this.resolveDefaultFrom(),
            }
          : {}),
        to: input.to,
        ...(input.subject ? { subject: input.subject } : {}),
        cc: input.cc,
        bcc: input.bcc,
        replyTo: input.replyTo,
        attachments: input.attachments,
        template: {
          id: input.templateId,
          variables: this.sanitizeTemplateVariables(input.variables),
        },
      };

      const response = await resend.emails.send(payload);
      if (response.error) {
        const errorMessage =
          response.error.message || 'Resend rejected the outbound email';
        const statusCode =
          typeof response.error.statusCode === 'number'
            ? ` (status ${response.error.statusCode})`
            : '';

        this.logger.error(
          `Failed to send ${feature} via Resend using template ${input.templateId}${statusCode}: ${errorMessage}`,
        );
        throw new Error(errorMessage);
      }

      const messageId =
        typeof response.data?.id === 'string' ? response.data.id : 'unknown';
      this.logger.log(
        `Sent ${feature} email via Resend with template ${input.templateId} (message ${messageId})`,
      );

      return response.data;
    }

    this.logger.warn(`Unknown mail provider "${provider}" for ${feature}`);
  }

  private getResendClient() {
    if (this.resendClient) {
      return this.resendClient;
    }

    const apiKey =
      this.configService.get<string>('RESEND_API_KEY') ||
      this.configService.get<string>('resend.apiKey');
    if (!apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }

    this.resendClient = new Resend(apiKey);
    return this.resendClient;
  }

  private resolveDefaultFrom() {
    return (
      this.configService.get<string>('RESEND_DEFAULT_FROM') ||
      this.configService.get<string>('resend.defaultFrom') ||
      undefined
    );
  }

  private sanitizeTemplateVariables(variables: MailTemplateVariables) {
    return Object.fromEntries(
      Object.entries(variables).map(([key, value]) => [
        key,
        String(value ?? ''),
      ]),
    );
  }
}
