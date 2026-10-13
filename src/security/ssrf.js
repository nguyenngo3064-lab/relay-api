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

function isPrivateIPv6(ip) {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified / loopback
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6
    const v4 = lower.replace('::ffff:', '');
    if (v4.includes('.')) return isPrivateIPv4(v4);
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

  // Protocol policy
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

  // If hostname is an IP literal, check directly.
  if (isIP(hostname)) {
    if (!allowPrivateNetwork && isBlockedIP(hostname)) {
      throw new SSRFError('Provider IP address is in a prohibited range.', 'BLOCKED_IP');
    }
    return { url: parsed.toString(), resolvedIps: [hostname] };
  }

  // Resolve DNS and check every returned address to prevent DNS rebinding to
  // internal ranges. The caller must also pin the resolved address on connect.
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
