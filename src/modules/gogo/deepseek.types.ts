export interface DeepSeekChatCompletion {
  choices: {
    finish_reason:
      | 'stop'
      | 'length'
      | 'content_filter'
      | 'tool_calls'
      | 'insufficient_system_resource';
    message: { content: string | null };
  }[];
}
