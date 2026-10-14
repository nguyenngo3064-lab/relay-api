// test/helpers.js
// Shared test utilities: in-memory DB, config, mock upstream server, and a
// helper to build the app and log in. Used by the automated test suite.

import { createServer } from 'node:http';
import { createDatabase } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { createLogger } from '../src/observability/logger.js';

export function testConfig(overrides = {}) {
  const enc = 'a'.repeat(64); // valid 32-byte hex for tests
  return {
    nodeEnv: 'test',
    isProd: false,
    host: '127.0.0.1',
    port: 0,
    databasePath: ':memory:',
    sessionSecret: 'test-session-secret-0123456789-abcdef',
    encryptionKey: enc,
    keyPepper: 'test-pepper-value',
    trustedProxy: false,
    adminPasswordHash: null,
    bootstrapPassword: null,
    limits: {
      maxRequestBodyBytes: 1048576,
      maxResponseBytes: 4194304,
      providerRequestTimeoutMs: 5000,
      providerConnectTimeoutMs: 3000,
      maxConcurrentRequests: 8,
      loginRatePerMinute: 1000,
      testRatePerMinute: 1000,
      contextProcessingTimeoutMs: 5000,
      maxContextTokens: 120000,
      relayBodyBytes: 8388608,
      retentionDays: 30,
      rememberTtlDays: 30,
    },
    problems: [],
    warnings: [],
    ...overrides,
  };
}

/**
 * Start a controllable mock OpenAI-compatible upstream. Returns a handle with
 * url, setBehavior(), close(), and counters. Labeled as a simulated upstream.
 */
export async function startMockUpstream(initial = {}) {
  const state = {
    status: 200,
    body: null,
    authRequired: true,
    validPrefix: 'testkey-',
    stream: false,
    delayMs: 0,
    requests: [],
    ...initial,
  };

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      state.requests.push({ url: req.url, auth: req.headers.authorization || null, body });
      const authOk = !state.authRequired || (req.headers.authorization || '').startsWith('Bearer ' + state.validPrefix);
      if (!authOk) {
        res.writeHead(401, { 'content-type': 'application/json', 'x-request-id': 'req_mock' });
        res.end(JSON.stringify({ error: { message: 'invalid key', code: 'invalid_api_key' } }));
        return;
      }
      if (state.delayMs) {
        setTimeout(() => respond(), state.delayMs);
      } else {
        respond();
      }
      function respond() {
        if (state.stream) {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          res.write('data: ' + JSON.stringify({ id: 'chatcmpl-s', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' } }] }) + '\n\n');
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.writeHead(state.status, { 'content-type': 'application/json', 'x-request-id': 'req_mock_1' });
        res.end(JSON.stringify(state.body ?? defaultBody()));
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    state,
    url: `http://127.0.0.1:${port}/v1`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function defaultBody() {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'nvidia/nemotron-3-ultra',
    choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
  };
}

/** Build an app backed by an in-memory DB (no listening). */
export async function buildTestApp(configOverrides = {}) {
  const config = testConfig(configOverrides);
  const db = createDatabase(':memory:');
  const logger = createLogger({ level: 'error', sink: { log() {}, error() {} } });
  const app = await buildApp({ config, db, logger });
  return { app, db, config };
}

/** Set up admin + login; returns { csrf, cookie } for authenticated calls. */
export async function loginAdmin(app, password = 'correct horse battery') {
  // Bootstrap via setup endpoint (no bootstrap password configured).
  const setupRes = await app.inject({
    method: 'POST',
    url: '/api/auth/setup',
    payload: { password },
  });
  const csrf = setupRes.json().csrfToken;
  const cookie = setupRes.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  return { csrf, cookie };
}

export function authed(method, url, { cookie, csrf, payload } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  return { method, url, headers, payload };
}
