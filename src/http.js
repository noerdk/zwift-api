import { ZwiftError } from './errors.js';

export const DEFAULT_API_BASE = 'https://us-or-rly101.zwift.com';
export const DEFAULT_AUTH_BASE = 'https://secure.zwift.com';
export const DEFAULT_CDN_BASE = 'https://cdn.zwift.com';

/**
 * One place that performs requests, so every caller gets the same error type,
 * timeout behaviour and redaction. Never logs.
 */
export async function request(url, {
  method = 'GET', headers = {}, body, accept, timeoutMs = 30_000, fetchImpl = fetch, signal,
} = {}) {
  const controller = new AbortController();
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: accept ? { ...headers, Accept: accept } : headers,
      body,
      signal: controller.signal,
    });
  } catch (err) {
    throw new ZwiftError(
      controller.signal.aborted ? `request to ${path(url)} timed out after ${timeoutMs}ms` : `request to ${path(url)} failed: ${err.message}`,
      { path: path(url), cause: err },
    );
  } finally {
    if (timer) clearTimeout(timer);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) {
    throw new ZwiftError(`${method} ${path(url)} failed (HTTP ${res.status})`, {
      status: res.status,
      path: path(url),
      body: buf.subarray(0, 500).toString('utf8'),
    });
  }
  return { buf, res, contentType: res.headers.get('content-type') ?? '' };
}

export async function getJson(url, opts = {}) {
  // Several Zwift endpoints content-negotiate and return protobuf unless the
  // JSON Accept header is explicit, so it is never left to the default.
  const { buf, contentType } = await request(url, { ...opts, accept: 'application/json' });
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    throw new ZwiftError(`${path(url)} returned ${contentType || 'no content-type'}, not JSON`, {
      path: path(url), body: buf.subarray(0, 200).toString('utf8'), cause: err,
    });
  }
}

export async function getProto(url, opts = {}) {
  const { buf } = await request(url, { ...opts, accept: 'application/x-protobuf-lite' });
  return buf;
}

function path(url) {
  try { return new URL(url).pathname; } catch { return String(url); }
}
