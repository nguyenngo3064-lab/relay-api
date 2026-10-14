// src/security/ssrf.js
// Server-Side Request Forgery protection for user-supplied provider base URLs.
//
// A provider URL must never be able to reach loopback, private, link-local,
// cloud-metadata, or the HUAN RELAY admin interface. HTTPS is required for
// remote production endpoints unless the provider is explicitly configured to
// allow a private-network/self-hosted destination.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
]);

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc * 256 + Number(octet)) >>> 0, 0) >>> 0;
}

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const n = ipv4ToInt(ip);
  const inRange = (start, end) => n >= ipv4ToInt(start) && n <= ipv4ToInt(end);
  return (
    inRange('0.0.0.0', '0.255.255.255') || // "this" network
    inRange('10.0.0.0', '10.255.255.255') || // private
    inRange('100.64.0.0', '100.127.255.255') || // CGNAT
    inRange('127.0.0.0', '127.255.255.255') || // loopback
    inRange('169.254.0.0', '169.254.255.255') || // link-local / metadata
    inRange('172.16.0.0', '172.31.255.255') || // private
    inRange('192.0.0.0', '192.0.0.255') || // IETF protocol
    inRange('192.0.2.0', '192.0.2.255') || // TEST-NET-1
    inRange('192.168.0.0', '192.168.255.255') || // private
    inRange('198.18.0.0', '198.19.255.255') || // benchmarking
    inRange('198.51.100.0', '198.51.100.255') || // TEST-NET-2
    inRange('203.0.113.0', '203.0.113.255') || // TEST-NET-3
    inRange('224.0.0.0', '255.255.255.255') // multicast/reserved/broadcast
  );
}

function normalizeIPv6(host) {
  let h = host.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  const zone = h.indexOf('%');
  if (zone !== -1) h = h.slice(0, zone);
  return h;
}

function ipv6ToParts(ip) {
  let h = normalizeIPv6(ip);
  if (h.includes('.')) {
    const lastColon = h.lastIndexOf(':');
    const v4 = h.slice(lastColon + 1);
    if (isPrivateIPv4(v4)) return { mappedV4Blocked: true };
    h = h.slice(0, lastColon) + ':0:0';
  }
  if (h.includes('::')) {
    const [head, tail] = h.split('::');
    const hg = head ? head.split(':').filter(Boolean) : [];
    const tg = tail ? tail.split(':').filter(Boolean) : [];
    const missing = 8 - (hg.length + tg.length);
    if (missing < 0) return null;
    h = [...hg, ...Array(missing).fill('0'), ...tg].join(':');
  }
  const parts = h.split(':');
  if (parts.length !== 8) return null;
  const nums = [];
  for (const g of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    nums.push(parseInt(g, 16));
  }
  return { groups: nums };
}

function isPrivateIPv6(ip) {
  const raw = normalizeIPv6(ip);
  if (raw === '::' || raw === '::1') return true;
  const parsed = ipv6ToParts(raw);
  if (parsed && parsed.mappedV4Blocked) return true;
  if (!parsed) return true;
  const g = parsed.groups;
  const first = g[0];
  if ((first & 0xffc0) === 0xfe80) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xff00) === 0xff00) return true;
  if (g[0] === 0x2002) {
    const v4 = ((g[1] >> 8) & 255) + '.' + (g[1] & 255) + '.' + ((g[2] >> 8) & 255) + '.' + (g[2] & 255);
    if (isPrivateIPv4(v4)) return true;
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) return true;
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    const v4 = ((g[6] >> 8) & 255) + '.' + (g[6] & 255) + '.' + ((g[7] >> 8) & 255) + '.' + (g[7] & 255);
    if (isPrivateIPv4(v4)) return true;
  }
  if (raw.startsWith('::ffff:')) {
    const v4 = raw.replace('::ffff:', '');
    if (v4.includes('.')) return isPrivateIPv4(v4);
    return true;
  }
  return false;
}

export function isBlockedIP(ip) {
  if (isIP(ip) === 4) return isPrivateIPv4(ip);
  if (isIP(ip) === 6) return isPrivateIPv6(ip);
  return true; // not a valid IP -> block
}

export class SSRFError extends Error {
  constructor(message, code = 'SSRF_BLOCKED') {
    super(message);
    this.name = 'SSRFError';
    this.code = code;
  }
}

/**
 * Validate and normalize a provider base URL.
 * Returns { url } on success; throws SSRFError on rejection.
 *
 * @param {string} rawUrl
 * @param {object} opts { allowPrivateNetwork: boolean, nodeEnv: string }
 */
export async function validateProviderUrl(rawUrl, opts = {}) {
  const { allowPrivateNetwork = false } = opts;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SSRFError('Provider base URL is not a valid absolute URL.', 'INVALID_URL');
  }

  const proto = parsed.protocol;
  const isDev = (opts.nodeEnv || 'production') !== 'production';

  if (proto === 'http:') {
    if (!allowPrivateNetwork && !isDev) {
      throw new SSRFError(
        'HTTP is not permitted for remote providers. Use HTTPS, or explicitly enable a self-hosted private-network policy.',
        'INSECURE_PROTOCOL'
      );
    }
  } else if (proto !== 'https:') {
    throw new SSRFError('Only http/https provider URLs are supported.', 'INVALID_PROTOCOL');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new SSRFError('Provider host resolves to a prohibited destination.', 'BLOCKED_HOST');
  }

  let hostForDns = hostname;
  if (hostname.startsWith('[') && hostname.endsWith(']')) hostForDns = hostname.slice(1, -1);
  const pct = hostForDns.indexOf('%');
  if (pct !== -1) hostForDns = hostForDns.slice(0, pct);
  if (isIP(hostForDns)) {
    if (!allowPrivateNetwork && isBlockedIP(hostForDns)) {
      throw new SSRFError('Provider IP address is in a prohibited range.', 'BLOCKED_IP');
    }
    return { url: parsed.toString(), resolvedIps: [hostForDns] };
  }
  if (/^[0-9a-f:]+(%.+)?$/i.test(hostForDns) && hostForDns.includes(':')) {
    if (!allowPrivateNetwork) {
      throw new SSRFError('Provider IP address is in a prohibited range.', 'BLOCKED_IP');
    }
    return { url: parsed.toString(), resolvedIps: [hostForDns] };
  }

  let addresses;
  try {
    const res = await lookup(hostname, { all: true });
    addresses = res.map((r) => r.address);
  } catch {
    throw new SSRFError('Provider hostname could not be resolved (DNS failure).', 'DNS_FAILURE');
  }
  if (addresses.length === 0) {
    throw new SSRFError('Provider hostname has no DNS records.', 'DNS_FAILURE');
  }
  if (!allowPrivateNetwork) {
    for (const addr of addresses) {
      if (isBlockedIP(addr)) {
        throw new SSRFError(
          'Provider hostname resolves to a prohibited (private/internal) address.',
          'BLOCKED_RESOLVED_IP'
        );
      }
    }
  }
  return { url: parsed.toString(), resolvedIps: addresses };
}
