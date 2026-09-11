import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZwiftClient, memoryTokenStore, redact, ZwiftAuthError, ZwiftSchemaError } from '../src/index.js';

/** A fetch double: routes by pathname, records calls. */
function stubFetch(routes) {
  const calls = [];
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body });
    const handler = routes[u.pathname];
    if (!handler) return new Response('not found', { status: 404 });
    return handler({ url: u, init, calls });
  };
  impl.calls = calls;
  return impl;
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const TOKEN = '/auth/realms/zwift/protocol/openid-connect/token';

test('login exchanges credentials and never exposes the password', async () => {
  const fetchImpl = stubFetch({ [TOKEN]: () => json({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600, token_type: 'Bearer' }) });
  const store = memoryTokenStore();
  const c = new ZwiftClient({ fetchImpl, tokenStore: store });
  const s = await c.login({ username: 'a@b.c', password: 'hunter2' });

  assert.equal(store.get(), 'RT', 'refresh token is persisted');
  assert.equal(s.tokenType, 'Bearer');
  assert.ok(!JSON.stringify(s).includes('AT'), 'session summary carries no token material');
  assert.ok(!JSON.stringify(s).includes('hunter2'));
});

test('connect prefers the stored refresh token', async () => {
  const fetchImpl = stubFetch({ [TOKEN]: ({ init }) => {
    assert.ok(init.body.includes('grant_type=refresh_token'));
    return json({ access_token: 'AT2', refresh_token: 'RT2', expires_in: 60 });
  } });
  const store = memoryTokenStore('RT1');
  const c = new ZwiftClient({ fetchImpl, tokenStore: store });
  assert.equal((await c.connect()).via, 'refresh');
  assert.equal(store.get(), 'RT2', 'a rotated refresh token replaces the old one');
});

test('connect falls back to the password grant when the refresh token is rejected', async () => {
  let n = 0;
  const fetchImpl = stubFetch({ [TOKEN]: ({ init }) => {
    n++;
    if (init.body.includes('refresh_token')) return json({ error: 'invalid_grant', error_description: 'expired' }, 400);
    return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 60 });
  } });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('stale'), credentials: { username: 'u', password: 'p' } });
  assert.equal((await c.connect()).via, 'password');
  assert.equal(n, 2);
});

test('a rejected refresh token with no credentials fails loudly', async () => {
  const fetchImpl = stubFetch({ [TOKEN]: () => json({ error: 'invalid_grant', error_description: 'expired' }, 400) });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('stale') });
  await assert.rejects(() => c.connect(), (e) => e instanceof ZwiftAuthError && /invalid_grant|expired/.test(e.message));
});

test('concurrent connect calls share one token request', async () => {
  let n = 0;
  const fetchImpl = stubFetch({ [TOKEN]: () => { n++; return json({ access_token: 'AT', refresh_token: 'RT', expires_in: 60 }); } });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('RT') });
  await Promise.all([c.connect(), c.connect(), c.connect()]);
  assert.equal(n, 1);
});

test('profile normalises Zwift units and asks for JSON explicitly', async () => {
  const fetchImpl = stubFetch({
    [TOKEN]: () => json({ access_token: 'AT', expires_in: 60 }),
    '/api/profiles/me': ({ init }) => {
      // Without this header Zwift returns protobuf.
      assert.equal(init.headers.Accept, 'application/json');
      return json({ id: 1, ftp: 225, weight: 72600, height: 1760, achievementLevel: 2022, totalDistance: 983050, totalDistanceClimbed: 14290 });
    },
  });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('RT') });
  const p = await c.profile();
  assert.equal(p.weightKg, 72.6, 'grams -> kg');
  assert.equal(p.heightCm, 176, 'millimetres -> cm');
  assert.equal(p.level, 20, 'achievementLevel is level x100');
  assert.equal(p.totalDistanceKm, 983.05);
  assert.equal(p.totalClimbedM, 14290);
});

test('earned achievements decode from protobuf', async () => {
  // PlayerAchievements{ achievements: [{id:60},{id:100},{id:303}] }
  const body = Buffer.from([0x0a, 0x02, 0x08, 0x3c, 0x0a, 0x02, 0x08, 0x64, 0x0a, 0x03, 0x08, 0xaf, 0x02]);
  const fetchImpl = stubFetch({
    [TOKEN]: () => json({ access_token: 'AT', expires_in: 60 }),
    '/api/achievement/loadPlayerAchievements': ({ init }) => {
      assert.equal(init.headers.Accept, 'application/x-protobuf-lite');
      return new Response(body, { status: 200 });
    },
  });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('RT') });
  assert.deepEqual([...(await c.earnedAchievementIds())].sort((a, b) => a - b), [60, 100, 303]);
});

test('an empty achievements body is an empty set, not a crash', async () => {
  const fetchImpl = stubFetch({
    [TOKEN]: () => json({ access_token: 'AT', expires_in: 60 }),
    '/api/achievement/loadPlayerAchievements': () => new Response(Buffer.alloc(0), { status: 200 }),
  });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('RT') });
  assert.equal((await c.earnedAchievementIds()).size, 0);
});

test('achievements that decode to no ids raise schema drift', async () => {
  // Valid protobuf, wrong shape: a varint where a message was expected.
  const fetchImpl = stubFetch({
    [TOKEN]: () => json({ access_token: 'AT', expires_in: 60 }),
    '/api/achievement/loadPlayerAchievements': () => new Response(Buffer.from([0x08, 0x2a]), { status: 200 }),
  });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('RT') });
  await assert.rejects(() => c.earnedAchievementIds(), ZwiftSchemaError);
});

test('HTTP failures carry status and path but not the token', async () => {
  const fetchImpl = stubFetch({
    [TOKEN]: () => json({ access_token: 'SECRET-TOKEN', expires_in: 60 }),
    '/api/game_info': () => new Response('nope', { status: 503 }),
  });
  const c = new ZwiftClient({ fetchImpl, tokenStore: memoryTokenStore('RT') });
  await assert.rejects(() => c.gameInfo(), (e) => {
    assert.equal(e.status, 503);
    assert.equal(e.path, '/api/game_info');
    assert.ok(!String(e.message + e.body).includes('SECRET-TOKEN'));
    return true;
  });
});

test('redact strips token material at any depth', () => {
  const r = redact({ accessToken: 'x', nested: { refresh_token: 'y', keep: 1 }, list: [{ password: 'z' }] });
  assert.equal(r.accessToken, '<redacted>');
  assert.equal(r.nested.refresh_token, '<redacted>');
  assert.equal(r.nested.keep, 1);
  assert.equal(r.list[0].password, '<redacted>');
});

test('the client exposes no write methods', () => {
  const names = Object.getOwnPropertyNames(ZwiftClient.prototype);
  const writes = names.filter((n) => /unlock|award|grant[A-Z]|create|update|delete|post/i.test(n));
  assert.deepEqual(writes, [], `read-only client must not expose ${writes.join(', ')}`);
});
