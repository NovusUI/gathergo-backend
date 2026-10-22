import {
  BadGatewayException,
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import type { DeepSeekChatCompletion } from './deepseek.types';
import { EventCreationAssistantService } from './event-creation-assistant.service';
import type { EventCreationAssistantDto } from './dto/event-creation-assistant.dto';
import type { EventCreationAssistantReply } from './event-creation-assistant.types';

const request = (): EventCreationAssistantDto => ({
  eventType: 'general',
  timeZone: 'Africa/Lagos',
  messages: [{ role: 'user', content: 'A free tree planting event in Lagos' }],
  draft: { isPhysicalEvent: true, ticketCount: 0, volunteerRoleCount: 0 },
});
const validReply: EventCreationAssistantReply = {
  reply: 'Where in Lagos will people meet?',
  choices: [],
  section: 'Location',
  updates: {
    title: 'Lagos tree planting',
    registrationType: 'registration',
    registrationFee: 0,
  },
};

describe('Gogo event creation', () => {
  let post: jest.SpyInstance<
    ReturnType<typeof axios.post>,
    Parameters<typeof axios.post>
  >;
  let service: EventCreationAssistantService;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    post = jest.spyOn(axios, 'post');
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    service = new EventCreationAssistantService(
      new ConfigService({ DEEPSEEK_API_KEY: 'server-secret' }),
    );
  });
  afterEach(() => jest.restoreAllMocks());
  function respond(
    content: unknown = validReply,
    finishReason: DeepSeekChatCompletion['choices'][number]['finish_reason'] = 'stop',
  ) {
    const response: AxiosResponse<DeepSeekChatCompletion> = {
      data: {
        choices: [
          {
            finish_reason: finishReason,
            message: {
              content:
                typeof content === 'string' ? content : JSON.stringify(content),
            },
          },
        ],
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
    post.mockResolvedValue(response);
  }
  it('uses the current draft, history, local time zone and server-only credentials', async () => {
    respond();
    const dto = request();
    expect(await service.reply(dto)).toEqual(validReply);
    expect(post).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        stream: false,
      }),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer server-secret',
          'Content-Type': 'application/json',
        },
      }),
    );
    const body = post.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const sent: unknown = JSON.parse(body.messages[1].content);
    expect(sent).toMatchObject(dto);
    expect(sent).toHaveProperty('now');
    expect(JSON.stringify(await service.reply(dto))).not.toContain(
      'server-secret',
    );
  });
  it('allows quick choices without claiming that an event was published', async () => {
    const reply = {
      reply: 'Will people meet in person or online?',
      choices: ['In person', 'Online'],
      section: null,
      updates: {},
    };
    respond(reply);
    expect(await service.reply(request())).toEqual(reply);
  });
  it('returns one validated editor for the current question', async () => {
    respond({
      ...validReply,
      reply: 'When should people meet?',
      section: 'Date and Time',
      updates: {},
    });
    const result = await service.reply(request());
    expect(result.section).toBe('Date and Time');
    const body = post.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[0].content).toContain('only your CURRENT question');
    expect(body.messages[0].content).toContain(
      'Do not add extra questions for optional',
    );
  });
  it('can invite human review without creating or publishing an event', async () => {
    respond({
      reply: 'Ready to review your event?',
      choices: [],
      section: 'Review',
      updates: {},
    });
    expect((await service.reply(request())).section).toBe('Review');
  });
  it.each([
    'not json',
    { ...validReply, choices: ['a', 'b', 'c', 'd'] },
    { ...validReply, choices: ['Online', 'Online'] },
    { ...validReply, choices: undefined },
    { ...validReply, section: undefined },
    { ...validReply, section: 'Publish' },
    { ...validReply, updates: { tickets: [] } },
    { ...validReply, updates: { volunteerRoles: [] } },
    { ...validReply, updates: { publish: true } },
    { ...validReply, updates: { registrationFee: -1 } },
    { ...validReply, updates: { registrationAttendees: 0 } },
    { ...validReply, updates: { donationTarget: 499999 } },
    { ...validReply, updates: { links: ['javascript:alert(1)'] } },
    { ...validReply, updates: { startDate: '2030-02-01' } },
    { ...validReply, updates: { startDate: '2020-02-01T12:00:00Z' } },
    {
      ...validReply,
      updates: {
        startDate: '2035-02-01T12:00:00Z',
        endDate: '2035-02-01T11:00:00Z',
      },
    },
  ])('rejects malformed or unsafe provider patches (%#)', async (response) => {
    respond(response);
    await expect(service.reply(request())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('rejects a truncated completion', async () => {
    respond(validReply, 'length');
    await expect(service.reply(request())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('preserves general and fundraiser entry types', async () => {
    respond({ ...validReply, updates: { registrationType: 'donation' } });
    await expect(service.reply(request())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    respond();
    await expect(
      service.reply({ ...request(), eventType: 'donation' }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('preserves naira registration fees and kobo fundraising targets', async () => {
    respond({
      ...validReply,
      updates: { registrationType: 'registration', registrationFee: 1500 },
    });
    expect((await service.reply(request())).updates.registrationFee).toBe(1500);
    respond({
      ...validReply,
      updates: { registrationType: 'donation', donationTarget: 1000000 },
    });
    expect(
      (await service.reply({ ...request(), eventType: 'donation' })).updates
        .donationTarget,
    ).toBe(1000000);
  });
  it('requires a physical event and impact story before volunteer-only participation', async () => {
    respond({ ...validReply, updates: { registrationType: 'volunteer' } });
    await expect(service.reply(request())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    const dto = request();
    dto.draft.impactDescription = 'Planting trees to restore the local park.';
    expect((await service.reply(dto)).updates.registrationType).toBe(
      'volunteer',
    );
    dto.draft.isPhysicalEvent = false;
    await expect(service.reply(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it.each([{ isPhysicalEvent: false }, { impactDescription: '' }])(
    'protects events with existing volunteer roles (%#)',
    async (updates) => {
      const dto = request();
      dto.draft = {
        ...dto.draft,
        registrationType: 'ticket',
        impactDescription: 'Plant trees.',
        volunteerRoleCount: 1,
      };
      respond({ ...validReply, updates });
      await expect(service.reply(dto)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    },
  );
  it('only offers optional donations for eligible participation types', async () => {
    respond({ ...validReply, updates: { donationsEnabled: true } });
    await expect(service.reply(request())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    const dto = request();
    dto.draft = {
      ...dto.draft,
      registrationType: 'volunteer',
      impactDescription: 'Plant trees.',
    };
    expect((await service.reply(dto)).updates.donationsEnabled).toBe(true);
  });
  it('rejects invalid draft fields and time zones before calling the provider', async () => {
    const dto = request();
    dto.draft.ticketCount = -1;
    await expect(service.reply(dto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.reply({ ...request(), timeZone: 'Mars/NotATimeZone' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(post).not.toHaveBeenCalled();
  });
  it('reports missing configuration and real provider failures without leaking credentials', async () => {
    service = new EventCreationAssistantService(
      new ConfigService({ DEEPSEEK_API_KEY: '' }),
    );
    await expect(service.reply(request())).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(post).not.toHaveBeenCalled();
    service = new EventCreationAssistantService(
      new ConfigService({ DEEPSEEK_API_KEY: 'server-secret' }),
    );
    post.mockRejectedValue(new AxiosError('Bearer server-secret'));
    await expect(service.reply(request())).rejects.toThrow(
      'Gogo is unavailable right now. Try again or use the manual form.',
    );
    expect(warn).toHaveBeenCalledWith(
      'Gogo event draft request failed: network error',
    );
  });
});
