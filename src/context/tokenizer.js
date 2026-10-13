// src/context/tokenizer.js
// Token estimation. When a model-specific tokenizer is unavailable we report
// ESTIMATES, never exact counts. Providers' reported usage is authoritative.

/**
 * Estimate token count from text using a chars/4 heuristic with per-message
 * role overhead (an OpenAI-style approximation). Clearly labeled as estimate.
 */
export function estimateTokensForText(text) {
  if (text == null) return 0;
  const s = String(text);
  if (s.length === 0) return 0;
  // ~4 chars per token on average for English/code mix.
  return Math.ceil(s.length / 4);
}

export function estimateTokensForMessages(messages) {
  if (!Array.isArray(messages)) return 0;
  let total = 0;
  for (const m of messages) {
    total += 4; // per-message overhead
    total += estimateTokensForText(roleText(m));
    if (typeof m.content === 'string') {
      total += estimateTokensForText(m.content);
    } else if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && typeof part === 'object' && typeof part.text === 'string') {
          total += estimateTokensForText(part.text);
        }
      }
    }
    if (Array.isArray(m.tool_calls)) {
      total += estimateTokensForText(JSON.stringify(m.tool_calls));
    }
  }
  total += 2; // priming
  return total;
}

function roleText(m) {
  return m && typeof m.role === 'string' ? m.role : '';
}

export function tokenMeasurementMethod() {
  return 'estimate';
}
