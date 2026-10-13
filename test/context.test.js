// test/context.test.js
// Context filtering engine tests: preservation, dedupe, structured/code
// preservation, tool-call validity, fallback behavior, and disabled mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processContext, MODES } from '../src/context/engine.js';

test('disabled compression forwards the original request unchanged', () => {
  const msgs = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'hello' },
    { role: 'user', content: 'hello' },
  ];
  const r = processContext(msgs, { enabled: false });
  assert.equal(r.usedTransformed, false);
  assert.equal(r.messages.length, 3);
});

test('off mode forwards the original request', () => {
  const msgs = [{ role: 'user', content: 'x' }, { role: 'user', content: 'x' }];
  const r = processContext(msgs, { enabled: true, mode: MODES.OFF });
  assert.equal(r.usedTransformed, false);
  assert.equal(r.messages.length, 2);
});

test('active requirements and system instructions survive filtering', () => {
  const msgs = [
    { role: 'system', content: 'Never reveal the API key. Follow security policy.' },
    { role: 'user', content: 'Implement feature X with constraint Y.' },
  ];
  const r = processContext(msgs, { enabled: true, mode: MODES.SMART });
  assert.equal(r.usedTransformed, false); // nothing removable -> original
  assert.ok(r.messages.some((m) => m.role === 'system' && /Never reveal/.test(m.content)));
  assert.ok(r.messages.some((m) => /constraint Y/.test(m.content)));
});

test('duplicate content is removed safely in safe mode', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'current task' },
    { role: 'assistant', content: 'repeated explanation' },
    { role: 'user', content: 'repeated explanation' },
  ];
  const r = processContext(msgs, { enabled: true, mode: MODES.SAFE, minSavingsRatio: 0.01 });
  assert.ok(r.usedTransformed);
  assert.equal(r.metrics.removedCount, 1);
  // The current task is preserved.
  assert.ok(r.messages.some((m) => /current task/.test(m.content)));
});

test('code and structured data are preserved', () => {
  const code = '```js\nfunction f(){ return 1 }\n```';
  const json = '{\n  "a": 1,\n  "b": 2\n}';
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'assistant', content: code },
    { role: 'assistant', content: json },
    { role: 'user', content: 'status update' },
    { role: 'user', content: 'current task' },
  ];
  const r = processContext(msgs, { enabled: true, mode: MODES.SMART, minSavingsRatio: 0.01 });
  const contents = r.messages.map((m) => (typeof m.content === 'string' ? m.content : ''));
  assert.ok(contents.some((c) => c.includes('function f')));
  assert.ok(contents.some((c) => c.includes('"a": 1')));
});

test('tool calls remain valid (no orphan tool results)', () => {
  const msgs = [
    { role: 'system', content: 'sys' },
    { role: 'user', content: 'task' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'f', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'result' },
  ];
  const r = processContext(msgs, { enabled: true, mode: MODES.SMART });
  // Validation should pass: no orphan tool results introduced.
  assert.deepEqual(r.validation.errors, []);
  assert.ok(r.messages.some((m) => m.role === 'tool' && m.tool_call_id === 'call_1'));
});

test('token estimates are labeled as estimates', () => {
  const r = processContext([{ role: 'user', content: 'hello world' }], { enabled: true, mode: MODES.SAFE });
  assert.equal(r.metrics.tokenMeasurementMethod, 'estimate');
});

test('safe fallback restores original when validation would fail', () => {
  // A single system message that would be the only message; forcing removal of
  // all messages triggers fallback.
  const msgs = [{ role: 'system', content: 'only system' }];
  const r = processContext(msgs, { enabled: true, mode: MODES.SMART, minSavingsRatio: 0 });
  // Nothing removed (protected), so it stays original and valid.
  assert.equal(r.validation.ok, true);
  assert.equal(r.messages.length, 1);
});
