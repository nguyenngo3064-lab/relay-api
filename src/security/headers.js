// src/security/headers.js
// Security headers and a restrictive Content Security Policy.
// Applied as a Fastify hook so it covers every response, including errors.

const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-permitted-cross-domain-policies': 'none',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-dns-prefetch-control': 'off',
};

// Restrictive CSP. The dashboard is served from the same origin and uses no
// third-party scripts, no inline event handlers, and no remote fonts (system
// fonts only). We allow 'self' scripts/styles and inline styles only for the
// small amount of dynamic styling the dashboard uses.
function buildCsp(isHttps) {
  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "manifest-src 'self'",
  ];
  if (isHttps) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function registerSecurityHeaders(fastify, { isHttps = false } = {}) {
  fastify.addHook('onSend', async (request, reply, payload) => {
    for (const [k, v] of Object.entries(BASE_HEADERS)) {
      reply.header(k, v);
    }
    reply.header('content-security-policy', buildCsp(isHttps));
    if (isHttps) {
      reply.header('strict-transport-security', 'max-age=15552000; includeSubDomains');
    }
    return payload;
  });
}

export { buildCsp };
