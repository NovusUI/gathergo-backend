import { MailService } from './mail.service';
import { MailFeature } from './mail.types';

describe('MailService', () => {
  const queue = {
    add: jest.fn(),
  } as any;
  const settings = {
    explainFeatureState: jest.fn(),
  } as any;

  let service: MailService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MailService(queue, settings);
  });

  it('skips queueing when a feature is disabled', async () => {
    settings.explainFeatureState.mockReturnValue({
      enabled: false,
      reason: 'MAIL_WELCOME_EMAIL_ENABLED is false',
    });

    await expect(
      service.sendWelcomeEmail({
        to: 'user@example.com',
        subject: 'Welcome',
        name: 'Ade',
      }),
    ).resolves.toEqual({
      feature: MailFeature.WELCOME_EMAIL,
      templateKey: MailFeature.WELCOME_EMAIL,
      queued: false,
      skipped: true,
      reason: 'MAIL_WELCOME_EMAIL_ENABLED is false',
    });

    expect(queue.add).not.toHaveBeenCalled();
  });

  it('queues mail jobs when a feature is enabled', async () => {
    settings.explainFeatureState.mockReturnValue({
      enabled: true,
      reason: 'Enabled via resend provider',
    });
    queue.add.mockResolvedValue({ id: 'job-1' });

    await expect(
      service.sendTicketConfirmation({
        to: 'user@example.com',
        subject: 'Ticket',
        name: 'Ade',
        eventTitle: 'Launch',
      }),
    ).resolves.toEqual({
      feature: MailFeature.TICKET_CONFIRMATION,
      templateKey: MailFeature.TICKET_CONFIRMATION,
      queued: true,
      skipped: false,
    });

    expect(queue.add).toHaveBeenCalledWith(
      'ticketConfirmation',
      expect.objectContaining({
        feature: MailFeature.TICKET_CONFIRMATION,
        templateKey: MailFeature.TICKET_CONFIRMATION,
      }),
    );
  });

  it('passes a deterministic job id when provided', async () => {
    settings.explainFeatureState.mockReturnValue({
      enabled: true,
      reason: 'Enabled via resend provider',
    });
    queue.add.mockResolvedValue({ id: 'job-2' });

    await expect(
      service.sendImpactMap({
        to: 'user@example.com',
        name: 'Ade',
        eventTitle: 'Fundraiser',
        jobId: 'impact-map:event-1:user-1',
      }),
    ).resolves.toEqual({
      feature: MailFeature.IMPACT_MAP,
      templateKey: MailFeature.IMPACT_MAP,
      queued: true,
      skipped: false,
    });

    expect(queue.add).toHaveBeenCalledWith(
      'impactMap',
      expect.objectContaining({
        feature: MailFeature.IMPACT_MAP,
        templateKey: MailFeature.IMPACT_MAP,
      }),
      {
        jobId: 'impact-map:event-1:user-1',
      },
    );
  });
});
