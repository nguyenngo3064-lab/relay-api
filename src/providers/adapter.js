// src/providers/adapter.js
// Provider adapters. The initial custom provider uses OpenAI-compatible Chat
// Completions. Other formats are explicit adapters, not silent assumptions.

/**
 * Build an OpenAI-compatible Chat Completions request body from a normalized
 * relay request. Only fields supported by the selected provider/model are sent.
 */
export function buildOpenAIChatRequest(normalized, provider) {
  const body = {
    model: normalized.model,
    messages: normalized.messages,
    stream: !!normalized.stream,
  };
  if (normalized.maxTokens != null) {
    if (provider?.capabilities?.useMaxCompletionTokens) {
      body.max_completion_tokens = normalized.maxTokens;
    } else {
      body.max_tokens = normalized.maxTokens;
    }
  } else if (provider?.maxOutputTokens != null) {
    if (provider?.capabilities?.useMaxCompletionTokens) {
      body.max_completion_tokens = provider.maxOutputTokens;
    } else {
      body.max_tokens = provider.maxOutputTokens;
    }
  }
  if (normalized.temperature != null) body.temperature = normalized.temperature;
  if (normalized.topP != null) body.top_p = normalized.topP;
  if (normalized.stop != null) body.stop = normalized.stop;
  if (normalized.tools && normalized.tools.length) body.tools = normalized.tools;
  if (normalized.toolChoice != null) body.tool_choice = normalized.toolChoice;
  if (normalized.responseFormat) body.response_format = normalized.responseFormat;
  return body;
}

/** Parse usage metadata from an OpenAI-compatible response. */
export function parseOpenAIUsage(json) {
  if (!json || typeof json !== 'object') return { usage: null };
  const u = json.usage;
  if (!u || typeof u !== 'object') return { usage: null };
  const prompt = Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
  const completion = Number.isFinite(u.completion_tokens) ? u.completion_tokens : null;
  const total = Number.isFinite(u.total_tokens)
    ? u.total_tokens
    : prompt != null && completion != null
      ? prompt + completion
      : null;
  if (prompt == null && completion == null && total == null) return { usage: null };
  return {
    usage: {
      promptTokens: prompt,
      completionTokens: completion,
      totalTokens: total,
      source: 'provider',
    },
  };
}

/** Extract assistant text and tool calls from a non-streaming response. */
export function parseOpenAIChoice(json) {
  const choice = json?.choices?.[0];
  if (!choice) return { text: null, toolCalls: null, finishReason: null };
  const msg = choice.message || {};
  const text = typeof msg.content === 'string' ? msg.content : null;
  const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : null;
  return { text, toolCalls, finishReason: choice.finish_reason ?? null };
}

/**
 * Build the Authorization header according to the provider auth style.
 * Never assume identical authentication across providers.
 */
export function buildAuthHeader(authStyle, apiKey) {
  switch (authStyle) {
    case 'bearer':
      return { authorization: `Bearer ${apiKey}` };
    case 'x-api-key':
      return { 'x-api-key': apiKey };
    case 'raw':
      return { authorization: apiKey };
    default:
      throw new Error(`Unsupported auth style: ${authStyle}`);
  }
}

/** Normalize an OpenAI-compatible SSE line into a parsed event or null. */
export function parseSSELine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  if (!trimmed.startsWith('data:')) return null;
  const data = trimmed.slice(5).trim();
  if (data === '[DONE]') return { done: true };
  try {
    return { data: JSON.parse(data) };
  } catch {
    return { data: null, raw: data };
  }
}

export const ADAPTERS = {
  openai_chat_completions: {
    buildRequest: buildOpenAIChatRequest,
    parseUsage: parseOpenAIUsage,
    parseChoice: parseOpenAIChoice,
    authHeader: buildAuthHeader,
    endpointPath: '/chat/completions',
  },
};

export function getAdapter(format) {
  const adapter = ADAPTERS[format];
  if (!adapter) {
    throw new Error(`No adapter registered for API format: ${format}`);
  }
  return adapter;
}
