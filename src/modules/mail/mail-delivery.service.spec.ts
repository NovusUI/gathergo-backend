import { MailDeliveryService } from './mail-delivery.service';
import { MailFeature, MailProviderName } from './mail.types';

describe('MailDeliveryService', () => {
  const configService = {
    get: jest.fn(),
  } as any;
  const mailSettingsService = {
    getProvider: jest.fn(),
  } as any;

  let service: MailDeliveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MailDeliveryService(configService, mailSettingsService);
  });

  it('throws when Resend returns an error payload', async () => {
    mailSettingsService.getProvider.mockReturnValue(MailProviderName.RESEND);
    configService.get.mockImplementation((key: string) => {
      if (key === 'RESEND_DEFAULT_FROM') {
        return 'GatherGo <hello@gathergo.test>';
      }

      return null;
    });

    (service as any).resendClient = {
      emails: {
        send: jest.fn().mockResolvedValue({
          data: null,
          error: {
            message: 'Template not found',
            statusCode: 422,
          },
        }),
      },
    };

    await expect(
      service.sendTemplate(MailFeature.EMAIL_VERIFICATION_CODE, {
        to: ['user@example.com'],
        templateId: 'tpl_missing',
        variables: {
          name: 'Ade',
          code: '123456',
        },
      }),
    ).rejects.toThrow('Template not found');
  });

  it('returns the Resend message payload when send succeeds', async () => {
    mailSettingsService.getProvider.mockReturnValue(MailProviderName.RESEND);
    configService.get.mockImplementation((key: string) => {
      if (key === 'RESEND_DEFAULT_FROM') {
        return 'GatherGo <hello@gathergo.test>';
      }

      return null;
    });

    (service as any).resendClient = {
      emails: {
        send: jest.fn().mockResolvedValue({
          data: {
            id: 'email_123',
          },
          error: null,
        }),
      },
    };

    await expect(
      service.sendTemplate(MailFeature.WELCOME_EMAIL, {
        to: ['user@example.com'],
        templateId: 'tpl_welcome',
        variables: {
          name: 'Ade',
        },
      }),
    ).resolves.toEqual({
      id: 'email_123',
    });
  });

  it('casts template variables to strings before sending to Resend', async () => {
    mailSettingsService.getProvider.mockReturnValue(MailProviderName.RESEND);
    configService.get.mockImplementation((key: string) => {
      if (key === 'RESEND_DEFAULT_FROM') {
        return 'GatherGo <hello@gathergo.test>';
      }

      return null;
    });

    const send = jest.fn().mockResolvedValue({
      data: {
        id: 'email_456',
      },
      error: null,
    });

    (service as any).resendClient = {
      emails: {
        send,
      },
    };

    await service.sendTemplate(MailFeature.EMAIL_VERIFICATION_CODE, {
      to: ['user@example.com'],
      templateId: 'tpl_verification',
      variables: {
        name: 'Ade',
        code: '123456',
        expiresInMinutes: 10,
      },
    });

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        template: {
          id: 'tpl_verification',
          variables: {
            name: 'Ade',
            code: '123456',
            expiresInMinutes: '10',
          },
        },
      }),
    );
  });
});
