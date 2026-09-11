import { ZwiftAuthError } from './errors.js';
import { DEFAULT_AUTH_BASE, request } from './http.js';

const TOKEN_PATH = '/auth/realms/zwift/protocol/openid-connect/token';
const CLIENT_ID = 'Zwift_Mobile_Link';

/**
 * A place to persist the refresh token. The default keeps it in memory only —
 * a consumer that wants it to survive a restart supplies its own, and is
 * responsible for storing it securely (the refresh grant returns an access
 * token valid for roughly 1000 days, so treat it as a long-lived credential).
 */
export function memoryTokenStore(initial = null) {
  let token = initial;
  return {
    get: () => token,
    set: (t) => { token = t; },
    clear: () => { token = null; },
  };
}

function shape(grant) {
  if (!grant?.access_token) throw new ZwiftAuthError('token response contained no access_token');
  return {
    accessToken: grant.access_token,
    refreshToken: grant.refresh_token ?? null,
    expiresIn: grant.expires_in ?? null,
    expiresAt: new Date(Date.now() + (grant.expires_in ?? 0) * 1000),
    tokenType: grant.token_type ?? null,
    scope: grant.scope ?? null,
  };
}

async function grant(form, { authBase, label, fetchImpl }) {
  let parsed;
  try {
    const { buf } = await request(authBase + TOKEN_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      fetchImpl,
    });
    parsed = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    // Surface Keycloak's own reason where it gave one, never the credentials.
    let detail = err.body ?? err.message;
    try { const j = JSON.parse(err.body); detail = `${j.error}: ${j.error_description ?? ''}`.trim(); } catch { /* keep raw */ }
    throw new ZwiftAuthError(`${label} failed — ${detail}`, { status: err.status, cause: err });
  }
  return shape(parsed);
}

export function passwordGrant({ username, password, authBase = DEFAULT_AUTH_BASE, fetchImpl } = {}) {
  if (!username || !password) throw new ZwiftAuthError('username and password are required');
  return grant({ client_id: CLIENT_ID, grant_type: 'password', username, password }, { authBase, label: 'password grant', fetchImpl });
}

export function refreshGrant(refreshToken, { authBase = DEFAULT_AUTH_BASE, fetchImpl } = {}) {
  if (!refreshToken) throw new ZwiftAuthError('a refresh token is required');
  return grant({ client_id: CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }, { authBase, label: 'refresh grant', fetchImpl });
}

/** Keys whose values must never reach a log or an error message. */
export const SECRET_KEYS = ['access_token', 'refresh_token', 'id_token', 'password', 'accessToken', 'refreshToken'];

export function redact(value) {
  if (!value || typeof value !== 'object') return value;
  const out = Array.isArray(value) ? [] : {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.includes(k) ? '<redacted>' : redact(v);
  return out;
}
