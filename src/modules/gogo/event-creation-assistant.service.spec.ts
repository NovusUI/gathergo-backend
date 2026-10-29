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
  addressedSections: [],
  messages: [{ role: 'user', content: 'A free tree planting event in Lagos' }],
  draft: {
    isPhysicalEvent: true,
    registrationType: 'registration',
    ticketCount: 0,
    volunteerRoleCount: 0,
    impactMapCount: 0,
    hasImpactGoalOrPath: false,
    hasCoverImage: false,
  },
});
const validReply: EventCreationAssistantReply = {
  reply: 'Where in Lagos will people meet?',
  choices: [],
  section: 'Location',
  completedSection: null,
  suggestedImpactStory: null,
  updates: {
    title: 'Lagos tree planting',
    registrationType: 'registration',
    registrationFee: 0,
  },
};

function completeDraft(): EventCreationAssistantDto['draft'] {
  return {
    ...request().draft,
    title: 'Park day',
    description: 'A gathering in the park.',
    startDate: '2035-02-03T09:00:00Z',
    endDate: '2035-02-03T11:00:00Z',
    location: 'Lagos park',
    registrationType: 'registration',
    registrationFee: 0,
    registrationAttendees: 25,
    hasCoverImage: true,
  };
}

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
      completedSection: null,
      suggestedImpactStory: null,
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
      completedSection: null,
      suggestedImpactStory: null,
      updates: {},
    });
    const result = await service.reply(request());
    expect(result.section).toBe('Date and Time');
    const body = post.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[0].content).toContain('only your CURRENT question');
    expect(body.messages[0].content).toContain(
      'gently invite optional steps IN ORDER',
    );
  });
  it('can invite human review without creating or publishing an event', async () => {
    respond({
      reply: 'Ready to review your event?',
      choices: [],
      section: 'Review',
      completedSection: null,
      suggestedImpactStory: null,
      updates: {},
    });
    const dto = request();
    dto.draft = completeDraft();
    dto.addressedSections = [
      'Impact story',
      'Impact map',
      'Volunteering',
      'Links',
      'Interests',
    ];
    expect((await service.reply(dto)).section).toBe('Review');
  });
  it('invites the cover picker before review and accepts a natural-language skip', async () => {
    const dto = request();
    dto.draft = { ...completeDraft(), hasCoverImage: false };
    dto.addressedSections = ['Impact story', 'Links', 'Interests'];
    respond({ ...validReply, section: 'Review', updates: {} });
    expect(await service.reply(dto)).toMatchObject({
      section: 'Cover',
      reply: 'Would you like to add a cover image?',
      choices: [],
    });
    const body = post.mock.calls[0][1] as { messages: { content: string }[] };
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      currentSection: 'Cover',
      currentOptionalSection: 'Cover',
      draft: { hasCoverImage: false },
    });
    dto.messages.push({ role: 'user', content: 'Skip the image for now' });
    respond({
      ...validReply,
      section: 'Review',
      completedSection: 'Cover',
      updates: {},
    });
    expect(await service.reply(dto)).toMatchObject({
      section: 'Review',
      completedSection: 'Cover',
    });
  });
  it('requires an actual boolean for the image-selection flag', async () => {
    for (const hasCoverImage of [undefined, 'true']) {
      const dto = request();
      Object.assign(dto.draft, { hasCoverImage });
      await expect(service.reply(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    expect(post).not.toHaveBeenCalled();
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
  it('extracts the initial name, description, dates, venue and registration price in a single draft patch', async () => {
    const updates = {
      title: 'Lagos park day',
      description: 'Meet neighbours for a morning in the park.',
      startDate: '2035-02-03T09:00:00Z',
      endDate: '2035-02-03T11:00:00Z',
      isPhysicalEvent: true,
      location: 'Lagos park',
      registrationType: 'registration' as const,
      registrationFee: 1500,
      registrationAttendees: 25,
    };
    respond({ ...validReply, section: 'Review', updates });
    const result = await service.reply(request());
    expect(result.updates).toEqual(updates);
    expect(result.section).toBe('Impact story');
    const body = post.mock.calls[0][1] as { messages: { content: string }[] };
    expect(body.messages[0].content).toContain(
      'extract ALL available details in one updates patch',
    );
  });
  it('keeps optional invitations behind incomplete required details', async () => {
    respond({ ...validReply, section: 'Impact map', updates: {} });
    expect((await service.reply(request())).section).toBe('Story');
  });
  it('advances a natural-language decline without repeating the optional step', async () => {
    const dto = request();
    dto.draft = completeDraft();
    dto.messages.push({
      role: 'user',
      content: 'No thanks, skip the impact story',
    });
    respond({
      ...validReply,
      section: 'Review',
      completedSection: 'Impact story',
      updates: {},
    });
    const result = await service.reply(dto);
    expect(result.completedSection).toBe('Impact story');
    expect(result.section).toBe('Links');
  });
  it('moves from links to review instead of offering interests for a mapped impact story', async () => {
    const dto = request();
    dto.draft = {
      ...completeDraft(),
      impactDescription: 'Restore our neighbourhood park.',
      impactMapCount: 1,
      hasImpactGoalOrPath: true,
    };
    dto.addressedSections = ['Impact story', 'Impact map', 'Volunteering'];
    respond({
      ...validReply,
      reply: 'Which interests fit your event?',
      section: 'Interests',
      choices: ['Nature', 'Community'],
      completedSection: 'Links',
      updates: {},
    });
    expect(await service.reply(dto)).toMatchObject({
      reply: 'Ready to review your event?',
      section: 'Review',
      choices: [],
      completedSection: 'Links',
      updates: {},
    });
  });
  it.each(['Links', 'Interests'] as const)(
    'continues to review when Gogo confirms %s already completed in the editor',
    async (completedSection) => {
      const dto = request();
      dto.draft = {
        ...completeDraft(),
        impactDescription: 'Restore our neighbourhood park.',
        impactMapCount: 1,
        hasImpactGoalOrPath: true,
        links: ['https://example.com/park'],
        tags: ['Nature'],
      };
      dto.addressedSections = ['Impact story', 'Impact map', completedSection];
      dto.messages.push({
        role: 'user',
        content:
          'I’ve updated the draft using the form. What should we add next?',
      });
      respond({
        ...validReply,
        reply: 'Ready to review your event?',
        section: 'Review',
        completedSection,
        updates: {},
      });
      expect(await service.reply(dto)).toMatchObject({
        section: 'Review',
        completedSection,
        updates: {},
      });
      expect(dto.addressedSections).toEqual([
        'Impact story',
        'Impact map',
        completedSection,
      ]);
      expect(warn).not.toHaveBeenCalled();
    },
  );
  it('continues after the app has already recorded a skipped step', async () => {
    const dto = request();
    dto.draft = completeDraft();
    dto.addressedSections = ['Impact story'];
    dto.messages.push({
      role: 'user',
      content: 'Skip Impact story for now. What is next?',
    });
    respond({
      ...validReply,
      section: 'Links',
      completedSection: 'Impact story',
      updates: {},
    });
    expect((await service.reply(dto)).section).toBe('Links');
  });
  it('continues to required roles after the app has accepted the impact story', async () => {
    const dto = request();
    dto.draft = {
      ...completeDraft(),
      registrationType: 'volunteer',
      impactDescription: 'Restore our park together.',
    };
    dto.addressedSections = ['Impact story'];
    dto.messages.push({
      role: 'user',
      content: 'Use this impact story. What is next?',
    });
    respond({
      ...validReply,
      section: 'Volunteering',
      completedSection: 'Impact story',
      updates: {},
    });
    expect((await service.reply(dto)).section).toBe('Volunteering');
  });
  it('does not allow the model to mark an unoffered optional step complete', async () => {
    const dto = request();
    dto.draft = completeDraft();
    respond({
      ...validReply,
      section: 'Review',
      completedSection: 'Interests',
      updates: {},
    });
    await expect(service.reply(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it.each([
    ['invalid JSON', 'private organiser text', 'invalid JSON'],
    [
      'an oversized reply',
      { ...validReply, reply: 'private organiser text'.repeat(40) },
      'schema validation (string.max)',
    ],
    [
      'an ineligible update',
      { ...validReply, updates: { registrationType: 'ticket' } },
      'participation type changed',
    ],
  ])(
    'logs the reason for %s without logging content',
    async (_, content, reason) => {
      respond(content);
      await expect(service.reply(request())).rejects.toBeInstanceOf(
        BadGatewayException,
      );
      expect(warn).toHaveBeenCalledWith(
        `Gogo event draft reply rejected: ${reason}`,
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        'private organiser text',
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain('server-secret');
    },
  );
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
    ).rejects.toBeInstanceOf(BadRequestException);
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
      (
        await service.reply({
          ...request(),
          eventType: 'donation',
          draft: { ...request().draft, registrationType: 'donation' },
        })
      ).updates.donationTarget,
    ).toBe(1000000);
  });
  it('keeps the participation type selected on the first page', async () => {
    respond({ ...validReply, updates: { registrationType: 'volunteer' } });
    const dto = request();
    dto.draft.impactDescription = 'Planting trees to restore the local park.';
    await expect(service.reply(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('lets a volunteer-only draft collect its venue before an impact story exists', async () => {
    const dto = request();
    dto.draft.registrationType = 'volunteer';
    respond({
      ...validReply,
      updates: { isPhysicalEvent: true, location: 'Lagos park' },
    });
    expect((await service.reply(dto)).updates.location).toBe('Lagos park');
    respond({ ...validReply, updates: { isPhysicalEvent: false } });
    await expect(service.reply(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it.each(['registration', 'volunteer'] as const)(
    'proposes an impact story without applying it to the %s draft',
    async (registrationType) => {
      const dto = request();
      dto.draft = { ...completeDraft(), registrationType };
      respond({
        ...validReply,
        section: 'Impact story',
        suggestedImpactStory: 'Restore our neighbourhood park together.',
        updates: {},
      });
      const result = await service.reply(dto);
      expect(result.section).toBe('Impact story');
      expect(result.suggestedImpactStory).toBe(
        'Restore our neighbourhood park together.',
      );
      expect(result.updates.impactDescription).toBeUndefined();
      expect(result.completedSection).toBeNull();
    },
  );
  it('does not accept a proposal that also silently applies the story', async () => {
    const dto = request();
    dto.draft = completeDraft();
    respond({
      ...validReply,
      section: 'Impact story',
      suggestedImpactStory: 'Restore our park.',
      updates: { impactDescription: 'Restore our park.' },
    });
    await expect(service.reply(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('accepts an organiser-written impact story in the required volunteer step', async () => {
    const dto = request();
    dto.draft = { ...completeDraft(), registrationType: 'volunteer' };
    respond({
      ...validReply,
      section: 'Volunteering',
      completedSection: 'Impact story',
      updates: { impactDescription: 'Restore our park together.' },
    });
    const result = await service.reply(dto);
    expect(result.section).toBe('Volunteering');
    expect(result.updates.impactDescription).toBe('Restore our park together.');
  });
  it.each([{ isPhysicalEvent: false }, { impactDescription: '' }])(
    'protects events with existing volunteer roles (%#)',
    async (updates) => {
      const dto = request();
      dto.draft = {
        ...dto.draft,
        registrationType: 'volunteer',
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
    dto.draft.registrationType = 'foodbank';
    expect((await service.reply(dto)).updates.donationsEnabled).toBe(true);
  });
  it('extracts food bank collection facts in one draft patch and retains them in later requests', async () => {
    const dto = request();
    dto.draft.registrationType = 'foodbank';
    dto.messages = [
      {
        role: 'user',
        content:
          'Share 100 meals at Lagos park on 3 February 2035, 25 people every 30 minutes from 9 to 11 UTC.',
      },
    ];
    const updates = {
      title: 'Lagos community table',
      description: 'Share meals with neighbours at Lagos park.',
      location: 'Lagos park',
      startDate: '2035-02-03T09:00:00Z',
      endDate: '2035-02-03T11:00:00Z',
      foodBankTotalMeals: 100,
      foodBankSlotCapacity: 25,
      foodBankSlotMinutes: 30,
    };
    respond({ ...validReply, updates, section: 'Impact story' });
    const reply = await service.reply(dto);
    expect(reply.updates).toEqual(updates);
    expect(reply.section).toBe('Impact story');
    dto.draft = { ...dto.draft, ...updates };
    respond({ ...validReply, updates: {}, section: 'Impact story' });
    await service.reply(dto);
    const body = post.mock.calls[1][1] as { messages: { content: string }[] };
    expect(JSON.parse(body.messages[1].content)).toMatchObject({
      draft: updates,
    });
    expect(body.messages[0].content).toContain(
      'Food bank events are ALWAYS physical',
    );
    expect(body.messages[0].content).toContain(
      'Never invent meal totals or window sizes',
    );
  });
  it.each([
    { foodBankTotalMeals: 0 },
    { foodBankTotalMeals: 1000001 },
    { foodBankSlotCapacity: 1.5 },
    { foodBankSlotCapacity: 10001 },
    { foodBankSlotMinutes: 4 },
    { foodBankSlotMinutes: 121 },
    { isPhysicalEvent: false },
  ])('rejects an invalid food bank update %j', async (updates) => {
    const dto = request();
    dto.draft.registrationType = 'foodbank';
    respond({ ...validReply, updates });
    await expect(service.reply(dto)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it('rejects collection settings on ordinary events', async () => {
    respond({ ...validReply, updates: { foodBankTotalMeals: 100 } });
    await expect(service.reply(request())).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });
  it.each(['www.example.com/event', 'ftp://example.com', 'https://bad link'])(
    'reports a draft link error before calling the provider (%s)',
    async (link) => {
      const dto = request();
      dto.draft = { ...completeDraft(), links: [link] };
      await expect(service.reply(dto)).rejects.toThrow(
        'Check the event links. Use valid http:// or https:// URLs.',
      );
      expect(post).not.toHaveBeenCalled();
    },
  );
  it('accepts normalized app links and reaches review', async () => {
    const dto = request();
    dto.draft = {
      ...completeDraft(),
      links: [
        'https://www.example.com/event',
        'https://chat.whatsapp.com/invite',
      ],
    };
    dto.addressedSections = ['Impact story', 'Links', 'Interests'];
    respond({ ...validReply, section: 'Review', updates: {} });
    expect((await service.reply(dto)).section).toBe('Review');
    const body = post.mock.calls[0][1] as { messages: { content: string }[] };
    expect(JSON.parse(body.messages[1].content)).toHaveProperty(
      'draft.links',
      dto.draft.links,
    );
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
  it.each(['ticket', 'registration', 'donation'] as const)(
    'rejects volunteer roles in a %s draft before calling the provider',
    async (registrationType) => {
      const dto = request();
      dto.eventType = registrationType === 'donation' ? 'donation' : 'general';
      dto.draft = {
        ...completeDraft(),
        registrationType,
        impactDescription: 'Plant trees.',
        volunteerRoleCount: 1,
      };
      await expect(service.reply(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(post).not.toHaveBeenCalled();
    },
  );
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
