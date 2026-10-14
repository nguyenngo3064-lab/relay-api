import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { validateProviderUrl, isBlockedIP, SSRFError } from '../security/ssrf.js';
import { UpstreamError } from './upstream.js';

export function parseRetryAfterMs(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (/^\d+$/.test(s)) { const n = Number(s); if (n >= 0 && n < 3600) return n * 1000; }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) { const d = t - Date.now(); return d > 0 ? Math.min(d, 60000) : 0; }
  return null;
}

export async function resolvePinnedIps(hostname, { allowPrivateNetwork }) {
  const res = await lookup(hostname, { all: true }).catch(() => null);
  if (!res || !res.length) throw new SSRFError('Provider hostname could not be resolved (DNS failure).', 'DNS_FAILURE');
  const ips = res.map((r) => r.address);
  if (!allowPrivateNetwork) for (const ip of ips) if (isBlockedIP(ip)) throw new SSRFError('Provider hostname resolves to a prohibited address.', 'BLOCKED_RESOLVED_IP');
  return ips;
}

export async function openUpstreamStream({ url, method, headers, bodyText, timeoutMs, connectTimeoutMs, allowPrivateNetwork, nodeEnv, signal }) {
  const { url: safeUrl, resolvedIps } = await validateProviderUrl(url, { allowPrivateNetwork, nodeEnv });
  const u = new URL(safeUrl);
  let h = u.hostname;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const pct = h.indexOf('%');
  if (pct !== -1) h = h.slice(0, pct);
  const { isIP } = await import('node:net');
  let ips = resolvedIps;
  if (!isIP(h)) ips = await resolvePinnedIps(h, { allowPrivateNetwork });
  for (const ip of ips) {
    if (!allowPrivateNetwork && isBlockedIP(ip)) throw new SSRFError('Resolved IP is prohibited.', 'BLOCKED_RESOLVED_IP');
  }
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort(signal ? signal.reason : undefined);
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason);
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const connectTo = setTimeout(() => ctrl.abort(new Error('connect_timeout')), connectTimeoutMs || 10000);
  const overall = setTimeout(() => ctrl.abort(new Error('timeout')), timeoutMs || 60000);
  try {
    const res = await fetch(safeUrl, { method: method || 'POST', headers, body: bodyText, redirect: 'manual', signal: ctrl.signal });
    return res;
  } finally {
    clearTimeout(connectTo);
    clearTimeout(overall);
    if (signal) signal.removeEventListener && signal.removeEventListener('abort', onAbort);
  }
}
