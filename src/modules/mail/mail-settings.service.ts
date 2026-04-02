import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailFeature, MailProviderName } from './mail.types';

const FEATURE_FLAG_ENV_MAP: Record<MailFeature, string> = {
  [MailFeature.EMAIL_VERIFICATION_CODE]:
    'MAIL_EMAIL_VERIFICATION_CODE_ENABLED',
  [MailFeature.PASSWORD_RESET_CODE]: 'MAIL_PASSWORD_RESET_CODE_ENABLED',
  [MailFeature.TICKET_CONFIRMATION]: 'MAIL_TICKET_CONFIRMATION_ENABLED',
  [MailFeature.DONATION_CONFIRMATION]: 'MAIL_DONATION_CONFIRMATION_ENABLED',
  [MailFeature.REGISTRATION_CONFIRMATION]:
    'MAIL_REGISTRATION_CONFIRMATION_ENABLED',
  [MailFeature.DONATION_TARGET_REACHED]:
    'MAIL_DONATION_TARGET_REACHED_ENABLED',
  [MailFeature.IMPACT_MAP]: 'MAIL_IMPACT_MAP_ENABLED',
  [MailFeature.WELCOME_EMAIL]: 'MAIL_WELCOME_EMAIL_ENABLED',
  [MailFeature.CUSTOM_EMAIL]: 'MAIL_CUSTOM_EMAIL_ENABLED',
};

@Injectable()
export class MailSettingsService {
  constructor(private readonly configService: ConfigService) {}

  isMailEnabled() {
    return this.getBoolean('MAIL_ENABLED', false);
  }

  getProvider(): MailProviderName {
    const configuredProvider = this.configService
      .get<string>('MAIL_PROVIDER')
      ?.trim()
      .toLowerCase();

    if (configuredProvider === MailProviderName.RESEND) {
      return MailProviderName.RESEND;
    }

    return MailProviderName.NOOP;
  }

  getTemplateId(templateKey: string) {
    const envKey = this.getTemplateEnvKey(templateKey);
    const templateId = this.configService.get<string>(envKey)?.trim();

    return templateId || null;
  }

  isFeatureEnabled(feature: MailFeature) {
    if (!this.isMailEnabled()) {
      return false;
    }

    const disabledFeatures = this.getDisabledFeatures();
    if (disabledFeatures.has(feature)) {
      return false;
    }

    return this.getBoolean(FEATURE_FLAG_ENV_MAP[feature], true);
  }

  explainFeatureState(feature: MailFeature, templateKey: string = feature) {
    if (!this.isMailEnabled()) {
      return {
        enabled: false,
        reason: 'MAIL_ENABLED is false',
      };
    }

    if (this.getDisabledFeatures().has(feature)) {
      return {
        enabled: false,
        reason: `Feature ${feature} is listed in MAIL_DISABLED_FEATURES`,
      };
    }

    if (!this.getBoolean(FEATURE_FLAG_ENV_MAP[feature], true)) {
      return {
        enabled: false,
        reason: `${FEATURE_FLAG_ENV_MAP[feature]} is false`,
      };
    }

    if (this.getProvider() === MailProviderName.NOOP) {
      return {
        enabled: false,
        reason: 'MAIL_PROVIDER is noop',
      };
    }

    if (!this.getTemplateId(templateKey)) {
      return {
        enabled: false,
        reason: `No template configured for ${this.getTemplateEnvKey(templateKey)}`,
      };
    }

    return {
      enabled: true,
      reason: `Enabled via ${this.getProvider()} provider`,
    };
  }

  private getDisabledFeatures() {
    const rawValue = this.configService.get<string>('MAIL_DISABLED_FEATURES');

    return new Set(
      (rawValue || '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter((value): value is MailFeature =>
          Object.values(MailFeature).includes(value as MailFeature),
        ),
    );
  }

  private getTemplateEnvKey(templateKey: string) {
    const normalizedTemplateKey = templateKey
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return `MAIL_TEMPLATE_KEY_${normalizedTemplateKey}`;
  }

  private getBoolean(key: string, defaultValue: boolean) {
    const rawValue = this.configService.get<string | boolean>(key);

    if (typeof rawValue === 'boolean') {
      return rawValue;
    }

    if (typeof rawValue !== 'string') {
      return defaultValue;
    }

    const normalizedValue = rawValue.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalizedValue)) {
      return true;
    }

    if (['false', '0', 'no', 'off'].includes(normalizedValue)) {
      return false;
    }

    return defaultValue;
  }
}
