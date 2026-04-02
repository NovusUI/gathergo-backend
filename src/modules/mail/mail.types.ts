export enum MailFeature {
  EMAIL_VERIFICATION_CODE = 'email_verification_code',
  PASSWORD_RESET_CODE = 'password_reset_code',
  TICKET_CONFIRMATION = 'ticket_confirmation',
  DONATION_CONFIRMATION = 'donation_confirmation',
  REGISTRATION_CONFIRMATION = 'registration_confirmation',
  DONATION_TARGET_REACHED = 'donation_target_reached',
  IMPACT_MAP = 'impact_map',
  WELCOME_EMAIL = 'welcome_email',
  CUSTOM_EMAIL = 'custom_email',
}

export enum MailProviderName {
  RESEND = 'resend',
  NOOP = 'noop',
}

export type MailTemplateVariables = Record<string, string | number>;

export type MailTemplateSendInput = {
  to: string[];
  templateId: string;
  variables: MailTemplateVariables;
  subject?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  attachments?: any[];
  from?: string;
};

export type MailDispatchResult = {
  feature: MailFeature;
  templateKey: string;
  queued: boolean;
  skipped: boolean;
  reason?: string;
};
