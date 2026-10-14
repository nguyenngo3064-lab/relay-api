export const SSE_MAX_BUFFER = 1024 * 1024;
export function createSSEParser({ maxBuffer = SSE_MAX_BUFFER } = {}) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      if (buf.length > maxBuffer) { const e = new Error('SSE buffer exceeded size limit.'); e.code = 'RESPONSE_TOO_LARGE'; throw e; }
      const events = [];
      buf = buf.replace(/\r\n/g, '\n');
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const datas = [];
        for (const line of raw.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('data:')) datas.push(line.slice(5).replace(/^ /, ''));
        }
        if (!datas.length) continue;
        const data = datas.join('\n');
        if (data === '[DONE]') events.push({ done: true });
        else events.push({ data });
      }
      if (buf.length > maxBuffer) { const e = new Error('SSE buffer exceeded size limit.'); e.code = 'RESPONSE_TOO_LARGE'; throw e; }
      return events;
    }
  };
}
