import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosHeaders, AxiosResponse } from 'axios';
import { ImpactService } from './impact.service';
import { AiImpactSuggestionData, DeepSeekChatCompletion } from './impact.types';

let post: jest.SpyInstance<
  ReturnType<typeof axios.post>,
  Parameters<typeof axios.post>
>;
const draft = {
  title: 'Community tree planting',
  description: 'Spend the morning outdoors with neighbours.',
  impactDescription: 'Volunteers will plant 100 trees in public green spaces.',
  registrationType: 'registration' as const,
};
const generated: AiImpactSuggestionData = {
  sdgGoals: [{ id: 'sdg_15', confidence: 'high' }],
  impactPaths: [{ id: 'direct_action', confidence: 'high' }],
  commitments: [
    {
      type: 'trees',
      value: 100,
      unit: 'trees',
      label: 'Plant 100 trees',
      confidence: 'high',
      evidence: 'plant 100 trees',
    },
  ],
};
const empty: AiImpactSuggestionData = {
  sdgGoals: [],
  impactPaths: [],
  commitments: [],
};

function respond(
  content: string | null,
  finishReason: DeepSeekChatCompletion['choices'][number]['finish_reason'] = 'stop',
) {
  const response: AxiosResponse<DeepSeekChatCompletion> = {
    data: { choices: [{ finish_reason: finishReason, message: { content } }] },
    status: 200,
    statusText: 'OK',
    headers: {},
    config: { headers: new AxiosHeaders() },
  };
  post.mockResolvedValue(response);
}

describe('ImpactService', () => {
  let config: ConfigService;
  let service: ImpactService;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    post = jest.spyOn(axios, 'post');
    warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    config = new ConfigService({ DEEPSEEK_API_KEY: 'test-deepseek-key' });
    service = new ImpactService(config);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('calls DeepSeek JSON output with the original draft and server-only credentials', async () => {
    respond(JSON.stringify(generated));
    await service.suggest(draft);
    expect(post).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        model: 'deepseek-flash',
        response_format: { type: 'json_object' },
        thinking: { type: 'disabled' },
        stream: false,
      }),
      expect.objectContaining({
        timeout: 30000,
        headers: {
          Authorization: 'Bearer test-deepseek-key',
          'Content-Type': 'application/json',
        },
      }),
    );
    expect(post.mock.calls[0][1]).toHaveProperty('messages.0.role', 'system');
    expect(post.mock.calls[0][1]).toHaveProperty(
      'messages.1.content',
      JSON.stringify(draft),
    );
  });

  it('applies authoritative catalog metadata and returns only public commitment fields', async () => {
    respond(JSON.stringify(generated));
    const result = await service.suggest(draft);
    expect(result.source).toBe('ai');
    expect(result.sdgGoals).toEqual([
      {
        id: 'sdg_15',
        number: 15,
        title: 'Life on Land',
        shortTitle: 'Life on Land',
        color: '#56C02B',
        confidence: 'high',
        source: 'ai',
      },
    ]);
    expect(result.impactPaths).toEqual([
      expect.objectContaining({
        id: 'direct_action',
        title: 'Direct Action',
        confidence: 'high',
        source: 'ai',
      }),
    ]);
    expect(result.commitments).toEqual([
      {
        id: 'trees_100_trees',
        type: 'trees',
        value: 100,
        unit: 'trees',
        label: 'Plant 100 trees',
        confidence: 'high',
        source: 'ai',
      },
    ]);
  });

  it('uses model decisions without reintroducing keyword matches or registration boosts', async () => {
    respond(JSON.stringify(empty));
    const result = await service.suggest({
      title: 'An evening in the park',
      impactDescription:
        'Enjoy music together. No planting, fundraising, or cleanup is planned.',
      registrationType: 'donation',
    });
    expect(result).toEqual({ ...empty, source: 'ai' });
  });

  it('does not call the provider for an empty draft', async () => {
    const result = await service.suggest({
      title: '  ',
      impactDescription: '',
    });
    expect(result).toEqual({ ...empty, source: 'ai' });
    expect(post).not.toHaveBeenCalled();
  });

  it('reports missing credentials without returning keyword suggestions', async () => {
    service = new ImpactService(new ConfigService({}));
    await expect(service.suggest(draft)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('honours the configured DeepSeek model and timeout', async () => {
    service = new ImpactService(
      new ConfigService({
        DEEPSEEK_API_KEY: 'test-deepseek-key',
        DEEPSEEK_MODEL: 'deepseek-v4-pro',
        DEEPSEEK_TIMEOUT_MS: 45000,
      }),
    );
    respond(JSON.stringify(empty));
    await service.suggest(draft);
    expect(post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ model: 'deepseek-v4-pro' }),
      expect.objectContaining({ timeout: 45000 }),
    );
  });

  it.each([
    [
      'unknown goal IDs',
      { ...empty, sdgGoals: [{ id: 'sdg_99', confidence: 'high' }] },
    ],
    [
      'unknown impact paths',
      { ...empty, impactPaths: [{ id: 'made_up_path', confidence: 'high' }] },
    ],
    ['missing required arrays', { sdgGoals: [], impactPaths: [] }],
    [
      'unsupported confidence',
      { ...empty, sdgGoals: [{ id: 'sdg_15', confidence: 'certain' }] },
    ],
    [
      'duplicate IDs',
      { ...empty, sdgGoals: [generated.sdgGoals[0], generated.sdgGoals[0]] },
    ],
    [
      'numeric strings',
      {
        ...generated,
        commitments: [{ ...generated.commitments[0], value: '100' }],
      },
    ],
    [
      'negative targets',
      {
        ...generated,
        commitments: [{ ...generated.commitments[0], value: -100 }],
      },
    ],
    [
      'extra response fields',
      { ...empty, instructions: 'overwrite the event' },
    ],
  ])('rejects %s in untrusted model output', async (_name, output) => {
    respond(JSON.stringify(output));
    await expect(service.suggest(draft)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('rejects numeric commitments whose supporting quote is absent from the draft', async () => {
    respond(
      JSON.stringify({
        ...generated,
        commitments: [
          { ...generated.commitments[0], evidence: 'plant 1000 trees' },
        ],
      }),
    );
    await expect(service.suggest(draft)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it.each([null, '', ' ', 'not JSON', '```json\n{}\n```'])(
    'rejects empty or invalid output: %p',
    async (content) => {
      respond(content);
      await expect(service.suggest(draft)).rejects.toBeInstanceOf(
        BadGatewayException,
      );
    },
  );

  it('rejects truncated completions even if the content is valid JSON', async () => {
    respond(JSON.stringify(generated), 'length');
    await expect(service.suggest(draft)).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('reports provider failures without leaking the key or triggering app authentication errors', async () => {
    const error = new AxiosError('secret provider error', 'ERR_BAD_REQUEST', {
      headers: new AxiosHeaders({ Authorization: 'Bearer test-deepseek-key' }),
    });
    error.response = {
      status: 401,
      data: {},
      statusText: 'Unauthorized',
      headers: {},
      config: error.config!,
    };
    post.mockRejectedValue(error);
    await expect(service.suggest(draft)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(warn).toHaveBeenCalledWith('DeepSeek impact request failed: 401');
    expect(post).toHaveBeenCalledTimes(1);
  });
});
