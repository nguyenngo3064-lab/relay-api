// src/relay/normalize.js
// Provider-aware request normalization for the OpenAI-compatible relay.

export class NormalizeError extends Error {
  constructor(message, code = 'INVALID_REQUEST', field = null) {
    super(message);
    this.name = 'NormalizeError';
    this.code = code;
    this.field = field;
  }
}

const ALLOWED_ROLES = new Set(['system', 'developer', 'user', 'assistant', 'tool', 'function']);

/**
 * Validate and normalize an inbound OpenAI-compatible chat request.
 * Throws NormalizeError with a precise field on failure.
 */
export function normalizeChatRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new NormalizeError('Request body must be a JSON object.', 'INVALID_REQUEST');
  }
  if (typeof body.model !== 'string' || body.model.trim() === '') {
    throw new NormalizeError('Field "model" is required and must be a string.', 'INVALID_REQUEST', 'model');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new NormalizeError('Field "messages" must be a non-empty array.', 'INVALID_REQUEST', 'messages');
  }

  const messages = body.messages.map((m, i) => normalizeMessage(m, i));

  const stream = body.stream === true;

  let maxTokens = null;
  if (Number.isFinite(body.max_tokens)) maxTokens = body.max_tokens;
  else if (Number.isFinite(body.max_completion_tokens)) maxTokens = body.max_completion_tokens;
  if (maxTokens != null && (maxTokens <= 0 || maxTokens > 1_000_000)) {
    throw new NormalizeError(
      'Token limit is out of range.',
      'INVALID_REQUEST',
      'max_tokens'
    );
  }

  const normalized = {
    model: body.model.trim(),
    messages,
    stream,
    maxTokens,
    temperature: Number.isFinite(body.temperature) ? body.temperature : null,
    topP: Number.isFinite(body.top_p) ? body.top_p : null,
    stop: Array.isArray(body.stop) ? body.stop : typeof body.stop === 'string' ? body.stop : null,
    tools: Array.isArray(body.tools) ? body.tools : null,
    toolChoice: body.tool_choice !== undefined ? body.tool_choice : null,
    responseFormat: body.response_format !== undefined ? body.response_format : null,
    passthrough: {},
  };

  // Preserve explicitly-allowed provider extras we do not interpret.
  for (const key of ['user', 'seed', 'frequency_penalty', 'presence_penalty', 'n']) {
    if (body[key] !== undefined) normalized.passthrough[key] = body[key];
  }

  return normalized;
}

/**
 * Attach an admin-configured prompt to the message list. The prompt is appended
 * as a trailing system message so it rides along with every relayed request
 * without rewriting the caller's own system prompt.
 */
export function withAttachedPrompt(messages, prompt) {
  if (typeof prompt !== 'string' || prompt.trim() === '') return messages;
  return messages.concat([{ role: 'system', content: prompt.trim() }]);
}

function normalizeMessage(m, index) {
  if (!m || typeof m !== 'object') {
    throw new NormalizeError(`messages[${index}] must be an object.`, 'INVALID_REQUEST', `messages[${index}]`);
  }
  if (typeof m.role !== 'string' || !ALLOWED_ROLES.has(m.role)) {
    throw new NormalizeError(
      `messages[${index}].role must be one of: ${[...ALLOWED_ROLES].join(', ')}.`,
      'INVALID_REQUEST',
      `messages[${index}].role`
    );
  }
  const out = { role: m.role };
  if (typeof m.content === 'string') out.content = m.content;
  else if (Array.isArray(m.content)) out.content = m.content;
  else if (m.content === null) out.content = null;
  else if (m.role === 'assistant' && m.tool_calls) out.content = m.content ?? null;
  else throw new NormalizeError(`messages[${index}].content is invalid.`, 'INVALID_REQUEST', `messages[${index}].content`);

  if (m.name !== undefined) out.name = m.name;
  if (Array.isArray(m.tool_calls)) out.tool_calls = m.tool_calls;
  if (m.role === 'tool' && m.tool_call_id !== undefined) out.tool_call_id = m.tool_call_id;
  return out;
}
