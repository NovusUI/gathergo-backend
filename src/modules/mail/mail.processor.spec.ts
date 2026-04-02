import { MailProcessor } from './mail.processor';

describe('MailProcessor', () => {
  let processor: MailProcessor;

  beforeEach(() => {
    processor = new MailProcessor({} as any, {} as any);
  });

  it('builds compact QR image URLs for ticket confirmation templates', async () => {
    const variables = await (processor as any).buildVariables(
      'ticketConfirmation',
      {
        name: 'Ade',
        eventTitle: 'GatherGo Live',
        qrCode: 'ticket_qr_123456',
      },
    );

    expect(variables.qrCodeImageUrl).toContain(
      'https://quickchart.io/qr?size=240&margin=1&text=',
    );
    expect(String(variables.qrCodeImageUrl).length).toBeLessThan(2000);
    expect(variables.qrCodeSectionStyle).toBe('display:block;');
  });
});
