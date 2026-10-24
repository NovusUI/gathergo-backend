import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { DeepSeekChatCompletion } from './deepseek.types';

export async function requestDeepSeekJson(
  config: ConfigService,
  apiKey: string,
  systemPrompt: string,
  content: string,
  maxTokens: number,
): Promise<DeepSeekChatCompletion> {
  const response = await axios.post<DeepSeekChatCompletion>(
    'https://api.deepseek.com/chat/completions',
    {
      model: config.get<string>('DEEPSEEK_MODEL', 'deepseek-flash'),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      temperature: 0.2,
      stream: false,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: config.get<number>('DEEPSEEK_TIMEOUT_MS', 30000),
    },
  );
  return response.data;
}
