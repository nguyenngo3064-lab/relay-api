import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'src', 'dashboard', 'static', 'app.js'), 'utf8');

/** Extract a named function body from the IIFE source and expose it. */
function loadView(name) {
  const start = SRC.indexOf('function ' + name + '(');
  assert.ok(start >= 0, 'view not found: ' + name);
  const end = SRC.indexOf('\n  }\n', start) + 4;
  const body = SRC.slice(start, end);
  const t = (k) => k;
  const esc = (s) => String(s == null ? '' : s);
  const boolPill = () => 'PILL';
  const fmtNum = (n) => String(n);
  const pill = () => 'PILL';
  const fmtTime = () => 'TIME';
  const msg = (k, x) => x;
  const card = (k, v, s) => '<div class="card"><div class="k">' + k + '</div><div class="v">' + v + '</div></div>';
  const fmtUptime = () => '1h';
  const fmtBytes = () => '1 MB';
  const niceMax = (v) => (v <= 5 ? 5 : 10 ** Math.ceil(Math.log10(v)));
  const pieChart = (parts) => 'PIE:' + JSON.stringify(parts || []);
  const realBarChart = name === 'barChart';
  const barChart = (ts, title) => '<svg>' + title + '</svg>';
  if (!realBarChart) {
    return new Function('t', 'esc', 'boolPill', 'fmtNum', 'pill', 'fmtTime', 'msg', 'card', 'fmtUptime', 'fmtBytes', 'niceMax', 'pieChart', 'barChart', body + '\nreturn ' + name + ';')(
      t, esc, boolPill, fmtNum, pill, fmtTime, msg, card, fmtUptime, fmtBytes, niceMax, pieChart, barChart
    );
  }
  return new Function('t', 'esc', 'boolPill', 'fmtNum', 'pill', 'fmtTime', 'msg', 'card', 'fmtUptime', 'fmtBytes', 'niceMax', body + '\nreturn ' + name + ';')(
    t, esc, boolPill, fmtNum, pill, fmtTime, msg, card, fmtUptime, fmtBytes, niceMax
  );
}

test('viewProviders renders existing providers from the real API shape', () => {
  const viewProviders = loadView('viewProviders');
  const d = {
    providers: [
      { id: 'p1', name: 'Old Provider A', baseUrl: 'https://api.a.test/v1', models: ['m1', 'm2'], enabled: true, credentials: [{ id: 'c1', label: 'primary', keyHint: 'sk-…abcd', enabled: true, isFallback: false }], attachedPrompt: 'Be brief.' },
      { id: 'p2', name: 'Old Provider B', baseUrl: 'https://api.b.test/v1', models: ['m3'], enabled: false, credentials: [], attachedPrompt: null },
    ],
  };
  const html = viewProviders(d);
  assert.ok(html.includes('Old Provider A'), 'first existing provider must be visible');
  assert.ok(html.includes('Old Provider B'), 'second existing provider must be visible');
  assert.ok(!html.includes('pv.empty'), 'must NOT fall back to the empty state while providers exist');
});

test('viewProviders still shows the empty state when there are no providers', () => {
  const viewProviders = loadView('viewProviders');
  assert.ok(viewProviders({ providers: [] }).includes('pv.empty'));
});

test('viewScoreboard renders rows from the real API shape', () => {
  const viewScoreboard = loadView('viewScoreboard');
  const html = viewScoreboard({
    scoreboard: [{ credentialId: 'c1', providerId: 'p1', providerName: 'P', label: 'primary', keyHint: 'sk-…', requests: 5, success: 4, error: 1, rateLimited: 0, totalTokens: 100, avgLatencyMs: 42, lastUsedAt: '2026-01-01T00:00:00Z', score: 80 }],
  });
  assert.ok(html.includes('primary'));
  assert.ok(!html.includes('sb.empty'));
});

test('viewUsage renders events and diagnostics from the real API shape', () => {
  const viewUsage = loadView('viewUsage');
  const html = viewUsage({
    usage: { summary: { total: 3, success: 2, error: 1, total_tokens: 90 }, events: [{ created_at: '2026-01-01T00:00:00Z', kind: 'relay', model: 'm1', status: 'success', http_status: 200, latency_ms: 12, error_code: null }] },
    diagnostics: [{ id: 1, kind: 'relay_error', detail: { code: 'TIMEOUT' }, createdAt: '2026-01-01T00:00:00Z' }],
  });
  assert.ok(!html.includes('us.empty'));
  assert.ok(!html.includes('us.diag.empty'));
});

test('viewOverview renders the request chart from the real API shape', () => {
  const viewOverview = loadView('viewOverview');
  const html = viewOverview({
    live: { uptimeMs: 60000, requestsPerMinute: 1, total: 2, success: 2, error: 0, rateLimited: 0, totalTokens: 10, avgLatencyMs: 5, p95LatencyMs: 9 },
    persistent: { total: 4, success: 3, error: 1, total_tokens: 40 },
    timeseries: [{ start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', total: 4, ok: 3, err: 1, limited: 0, tokens: 40 }],
    server: { nodeVersion: 'v24.0.0', env: 'production', memory: { rssBytes: 1024 } },
    caches: { response: { entries: 0 } },
  });
  assert.ok(html.includes('<svg'), 'overview must include the bar chart');
  assert.ok(html.includes('ov.chart.title'));
});

test('viewCharts renders from the real API shape', () => {
  const viewCharts = loadView('viewCharts');
  const html = viewCharts({
    live: { total: 2, requestsPerMinute: 0, totalTokens: 5, avgLatencyMs: 1 },
    timeseries: [{ start: '2026-01-01T00:00:00Z', end: '2026-01-01T01:00:00Z', total: 2, ok: 2, err: 0, limited: 0, tokens: 5 }],
    breakdown: [{ status: 'success', count: 2, tokens: 5 }],
    scoreboard: [],
  });
  assert.ok(html.includes('<svg'));
});

test('barChart labels each bar with its request count', () => {
  const barChart = loadView('barChart');
  const html = barChart(
    [{ start: '2026-01-01T09:00:00Z', end: '2026-01-01T10:00:00Z', total: 7, ok: 7, err: 0, limited: 0, tokens: 0 }],
    'Requests per hour'
  );
  assert.ok(html.includes('>7<'), 'the value label 7 must appear above the bar');
  assert.ok(html.includes('09:00'), 'the time label must appear on the x-axis');
});
