import https from 'node:https';
import zlib from 'node:zlib';

export interface HttpPostResult {
  status: number;
  body: Buffer;
}

/**
 * Send a form-encoded POST over plain HTTP/1.1.
 *
 * Facebook's GraphQL API rejects HTTP/2 clients (undici `fetch`) with an
 * empty 200 response, and rejects browser User-Agents with HTTP 400.
 * HTTP/1.1 + a plain client UA (like the original Python `requests`) works.
 */
export function postForm(
  url: string,
  form: string,
  userAgent = 'python-requests/2.31.0',
  timeoutMs = 60_000,
): Promise<HttpPostResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request(
      {
        host: target.hostname,
        port: target.port || 443,
        path: target.pathname + target.search,
        method: 'POST',
        timeout: timeoutMs,
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'content-length': Buffer.byteLength(form),
          'user-agent': userAgent,
          accept: '*/*',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          const encoding = String(res.headers['content-encoding'] ?? 'identity').toLowerCase();
          let body = raw;
          try {
            if (encoding.includes('gzip')) body = zlib.gunzipSync(raw);
            else if (encoding.includes('deflate')) body = zlib.inflateSync(raw);
            else if (encoding.includes('br')) body = zlib.brotliDecompressSync(raw);
          } catch {
            body = raw; // fall back to the raw bytes
          }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy(new Error(`GraphQL request timed out after ${timeoutMs}ms`));
    });
    req.on('error', reject);
    req.write(form);
    req.end();
  });
}