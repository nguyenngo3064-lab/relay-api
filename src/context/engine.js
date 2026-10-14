// src/context/engine.js
// Smart context filtering engine. Reduces input tokens while preserving the
// information required for correct behavior. Deterministic + heuristic only by
// default. Optional semantic summarization is disabled by default and is never
// done via a paid API unless explicitly enabled/configured by the owner.
//
// Stages:
//  A. Context inventory
//  B. Requirement extraction
//  C. Relevance filtering (dedupe, superseded/stale, redundant)
//  D. Semantic compression (optional, local heuristics; off by default)
//  E. Protected content (system/dev, code, structured data, tool calls, ...)
//  F. Validation and safe fallback to the original request

import { estimateTokensForMessages } from './tokenizer.js';

export const MODES = Object.freeze({ OFF: 'off', SAFE: 'safe', SMART: 'smart' });

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  mode: MODES.SAFE,
  minSavingsRatio: 0.05,
  maxContextTokens: 120000,
  maxRetainedHistory: 200,
  processingTimeoutMs: 5000,
  protectStructuredData: true,
  safeFallback: true,
  semanticSummarization: false,
});

function clone(messages) {
  return JSON.parse(JSON.stringify(messages));
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

function contentSignature(m) {
  let text = '';
  if (typeof m.content === 'string') text = m.content;
  else if (Array.isArray(m.content)) {
    text = m.content
      .map((p) => (p && typeof p === 'object' && typeof p.text === 'string' ? p.text : ''))
      .join('');
  }
  if (Array.isArray(m.tool_calls)) text += '|tools|' + stableStringify(m.tool_calls);
  return text.trim();
}

function isProtected(m) {
  if (m.role === 'system' || m.role === 'developer') return true;
  if (typeof m.content === 'string') {
    const lower = m.content.toLowerCase();
    if (/\b(security|secret|credential|do not|must not|never|policy|api[ _-]?key)\b/.test(lower)) {
      return true;
    }
  }
  return false;
}

function looksStructured(text) {
  const t = text.trim();
  if (!t) return false;
  return (
    (t.startsWith('{') && t.endsWith('}')) ||
    (t.startsWith('[') && t.endsWith(']')) ||
    /^---\n/.test(t) ||
    /\n\s{2,}\w+:\s/.test(t)
  );
}

function looksLikeCode(text) {
  return /```|\bfunction\b|\bclass\b|\bconst\b|\bimport\b|\bdef \b|<\/?[a-z]+>|\{\s*"[^"]+"\s*:/.test(text);
}

function analyze(messages) {
  const inventory = {
    total: messages.length,
    roles: {},
    protected: new Set(),
    duplicates: new Map(),
    structured: new Set(),
    code: new Set(),
    currentTaskIndex: -1,
  };
  messages.forEach((m, i) => {
    inventory.roles[m.role] = (inventory.roles[m.role] || 0) + 1;
    if (isProtected(m)) inventory.protected.add(i);
    const text = typeof m.content === 'string' ? m.content : '';
    if (text) {
      if (looksStructured(text)) inventory.structured.add(i);
      if (looksLikeCode(text)) inventory.code.add(i);
    }
    const sig = contentSignature(m);
    if (sig) {
      if (!inventory.duplicates.has(sig)) inventory.duplicates.set(sig, []);
      inventory.duplicates.get(sig).push(i);
    }
    if (m.role === 'user') inventory.currentTaskIndex = i;
  });
  return inventory;
}

function relevanceFilter(messages, inventory, mode) {
  const remove = new Set();
  for (const [, indices] of inventory.duplicates) {
    if (indices.length <= 1) continue;
    for (let k = 0; k < indices.length - 1; k++) {
      const idx = indices[k];
      if (!inventory.protected.has(idx) && idx !== inventory.currentTaskIndex) {
        remove.add(idx);
      }
    }
  }
  if (mode === MODES.SMART) {
    messages.forEach((m, i) => {
      if (inventory.protected.has(i)) return;
      if (i === inventory.currentTaskIndex) return;
      if (inventory.structured.has(i) || inventory.code.has(i)) return;
      if (m.role === 'tool' || m.role === 'function') return;
      const text = typeof m.content === 'string' ? m.content : '';
      const lower = text.toLowerCase();
      const transient =
        /^(ok|okay|done|got it|noted|working on it|on it|will do|thanks|thank you)[.!]?$/i.test(
          text.trim()
        ) || /\b(status update|quick note|just checking in)\b/.test(lower);
      if (transient) remove.add(i);
    });
  }
  const kept = [];
  const keptIndices = [];
  messages.forEach((m, i) => {
    if (!remove.has(i)) { kept.push(m); keptIndices.push(i); }
  });
  return { messages: kept, keptIndices, removed: [...remove].sort((a, b) => a - b) };
}

function semanticCompress(messages, inventory, settings) {
  if (!settings.semanticSummarization) return { messages, summarized: [] };
  const result = [];
  const summarized = [];
  const keepRecent = Math.max(4, Math.floor(settings.maxRetainedHistory / 4));
  const cutoff = messages.length - keepRecent;
  messages.forEach((m, i) => {
    if (i >= cutoff || inventory.protected.has(i) || i === inventory.currentTaskIndex ||
        m.role === 'system' || m.role === 'developer' || m.role === 'user') {
      result.push(m); return;
    }
    const text = typeof m.content === 'string' ? m.content : '';
    if (text.length > 600) {
      const files = [...text.matchAll(/([\w./-]+\.(?:js|ts|py|json|md|yaml|yml|sql|tsx|jsx))/g)].map((x) => x[1]);
      const errors = [...text.matchAll(/(error[:\s][^\n]{0,80})/gi)].map((x) => x[1].trim());
      const summary =
        '[compressed prior assistant turn: ' + text.slice(0, 160).replace(/\s+/g, ' ') + '...' +
        (files.length ? ' files: ' + [...new Set(files)].slice(0, 8).join(', ') : '') +
        (errors.length ? ' errors: ' + [...new Set(errors)].slice(0, 4).join(' | ') : '') + ']';
      result.push({ role: m.role, content: summary });
      summarized.push(i);
    } else {
      result.push(m);
    }
  });
  return { messages: result, summarized };
}

// Stage F: validation and fallback. Structural only; never claims semantics.
function validateStructure(original, processed) {
  const errors = [];
  if (!Array.isArray(processed)) return ['processed is not an array'];
  if (processed.length === 0 && original.length > 0) errors.push('processing removed all messages');
  const openCalls = new Set();
  for (const m of processed) {
    if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
      for (const tc of m.tool_calls) openCalls.add(tc.id);
    }
    if (m.role === 'tool') {
      const tid = m.tool_call_id;
      if (tid && !openCalls.has(tid)) errors.push('orphan tool result: ' + tid);
    }
  }
  const origHasSystem = original.some((m) => m.role === 'system' || m.role === 'developer');
  const procHasSystem = processed.some((m) => m.role === 'system' || m.role === 'developer');
  if (origHasSystem && !procHasSystem) errors.push('system/developer instructions were removed');
  return errors;
}

export function processContext(messages, settings = {}) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings };
  const original = clone(messages);
  const before = estimateTokensForMessages(original);

  if (!cfg.enabled || cfg.mode === MODES.OFF) {
    return {
      messages: original,
      metrics: {
        originalEstimatedTokens: before,
        processedEstimatedTokens: before,
        tokenMeasurementMethod: 'estimate',
        savingsRatio: 0,
      },
      usedTransformed: false,
      validation: { ok: true, semanticEquivalenceProven: false, errors: [] },
      fallbackReason: null,
    };
  }

  const inventory = analyze(original);
  const filtered = relevanceFilter(clone(original), inventory, cfg.mode);

  let working = filtered.messages;
  if (cfg.maxRetainedHistory && working.length > cfg.maxRetainedHistory) {
    const taskMsg = filtered.messages[inventory.currentTaskIndex];
    const head = working.slice(0, 1);
    const tail = working.slice(-cfg.maxRetainedHistory);
    working = dedupeById(head.concat(tail));
    if (inventory.currentTaskIndex >= 0 && taskMsg && !working.includes(taskMsg)) {
      working.push(taskMsg);
    }
  }

  const compressed = semanticCompress(working, inventory, cfg);
  let processed = compressed.messages;
  const errors = validateStructure(original, processed);
  let usedTransformed = true;
  let fallbackReason = null;

  if (errors.length) {
    usedTransformed = false;
    fallbackReason = 'validation_failed';
    processed = original;
  }

  const processedTokens = estimateTokensForMessages(processed);
  const savingsRatio = before > 0 ? (before - processedTokens) / before : 0;
  if (usedTransformed && savingsRatio < cfg.minSavingsRatio) {
    usedTransformed = false;
    fallbackReason = 'insufficient_savings';
    processed = original;
  }

  const finalTokens = estimateTokensForMessages(processed);
  return {
    messages: processed,
    metrics: {
      originalEstimatedTokens: before,
      processedEstimatedTokens: finalTokens,
      tokenMeasurementMethod: 'estimate',
      savingsRatio: before > 0 ? Math.max(0, (before - finalTokens) / before) : 0,
      removedCount: filtered.removed.length,
      summarizedCount: compressed.summarized.length,
    },
    usedTransformed,
    validation: { ok: errors.length === 0, semanticEquivalenceProven: false, errors },
    fallbackReason,
  };
}

function dedupeById(list) {
  const seen = new Set();
  const out = [];
  for (const m of list) {
    const key = stableStringify(m);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
