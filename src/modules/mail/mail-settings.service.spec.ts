import { ConfigService } from '@nestjs/config';
import { MailSettingsService } from './mail-settings.service';
import { MailFeature, MailProviderName } from './mail.types';

describe('MailSettingsService', () => {
  const buildService = (config: Record<string, any>) =>
    new MailSettingsService({
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService);

  it('disables all features when mail is globally off', () => {
    const service = buildService({
      MAIL_ENABLED: 'false',
    });

    expect(service.isMailEnabled()).toBe(false);
    expect(service.isFeatureEnabled(MailFeature.WELCOME_EMAIL)).toBe(false);
    expect(service.explainFeatureState(MailFeature.WELCOME_EMAIL)).toEqual({
      enabled: false,
      reason: 'MAIL_ENABLED is false',
    });
  });

  it('supports per-feature and list-based disabling', () => {
    const service = buildService({
      MAIL_ENABLED: 'true',
      MAIL_PROVIDER: 'resend',
      MAIL_TEMPLATE_KEY_DONATION_CONFIRMATION: 'tpl_donation_123',
      MAIL_DISABLED_FEATURES: 'welcome_email, custom_email',
      MAIL_TICKET_CONFIRMATION_ENABLED: 'false',
    });

    expect(service.getProvider()).toBe(MailProviderName.RESEND);
    expect(service.isFeatureEnabled(MailFeature.WELCOME_EMAIL)).toBe(false);
    expect(service.isFeatureEnabled(MailFeature.CUSTOM_EMAIL)).toBe(false);
    expect(service.isFeatureEnabled(MailFeature.TICKET_CONFIRMATION)).toBe(
      false,
    );
    expect(service.isFeatureEnabled(MailFeature.DONATION_CONFIRMATION)).toBe(
      true,
    );
    expect(
      service.explainFeatureState(MailFeature.DONATION_CONFIRMATION),
    ).toEqual({
      enabled: true,
      reason: 'Enabled via resend provider',
    });
  });

  it('marks a feature unavailable when its template id is missing', () => {
    const service = buildService({
      MAIL_ENABLED: 'true',
      MAIL_PROVIDER: 'resend',
    });

    expect(
      service.explainFeatureState(MailFeature.WELCOME_EMAIL),
    ).toEqual({
      enabled: false,
      reason: 'No template configured for MAIL_TEMPLATE_KEY_WELCOME_EMAIL',
    });
  });
});
