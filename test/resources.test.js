import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ZwiftClient, memoryTokenStore, wire } from '../src/index.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pb = (name) => readFileSync(join(FIX, `${name}.pb`));
const TOKEN = '/auth/realms/zwift/protocol/openid-connect/token';

function client(routes) {
  const impl = async (url, init = {}) => {
    const u = new URL(url);
    const h = routes[u.pathname];
    return h ? h(init) : new Response('not found', { status: 404 });
  };
  return new ZwiftClient({ fetchImpl: impl, tokenStore: memoryTokenStore('RT') });
}
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const tokenOk = () => new Response(JSON.stringify({ access_token: 'AT', expires_in: 60 }), { headers: { 'content-type': 'application/json' } });

test('wire.decode is faithful: field numbers, strings, nesting, repeats', () => {
  // { 1: 7, 2: "hi", 3: {1:1}, 3: {1:2} }
  const buf = Buffer.from([0x08, 0x07, 0x12, 0x02, 0x68, 0x69, 0x1a, 0x02, 0x08, 0x01, 0x1a, 0x02, 0x08, 0x02]);
  const d = wire.decode(buf);
  assert.equal(d['1'], 7);
  assert.equal(d['2'], 'hi');
  assert.deepEqual(d['3'], [{ '1': 1 }, { '1': 2 }]);
});

test('route-completion achievements decode from the captured response', async () => {
  const c = client({ [TOKEN]: tokenOk, '/api/achievement/route-completion-achievements': () => new Response(pb('route-completion')) });
  const rows = await c.routeCompletionAchievements();
  assert.ok(rows.length >= 2);
  for (const r of rows) {
    assert.match(r.uuid, /^[0-9a-f-]{36}$/);
    assert.ok(Number.isInteger(r.routeId) && r.routeId > 0);
    assert.ok(typeof r.name === 'string' && r.name.length);
  }
});

test('fitnessMetricsAndGoals surfaces week blocks and keeps the raw tree', async () => {
  const c = client({ [TOKEN]: tokenOk, '/api/fitness/metrics-and-goals': () => new Response(pb('metrics-and-goals')) });
  const m = await c.fitnessMetricsAndGoals();
  assert.match(m.currentWeek.weekStart, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof m.currentWeek.state, 'string');
  assert.ok(m.raw && typeof m.raw === 'object', 'raw decoded tree is preserved');
});

test('streaks decode to a field-numbered object with timestamps', async () => {
  const c = client({ [TOKEN]: tokenOk, '/api/fitness/streaks': () => new Response(pb('streaks')) });
  const s = await c.streaks();
  assert.equal(typeof s['1'], 'number');
  assert.ok(s['9'] > 1e12, 'field 9 is an epoch-ms timestamp');
});

test('personalRecords returns {} when empty', async () => {
  const c = client({ [TOKEN]: tokenOk, '/api/personal-records/my-records': () => new Response(Buffer.alloc(0)) });
  assert.deepEqual(await c.personalRecords(), {});
});

test('zfiles lists stored files without content', async () => {
  const c = client({ [TOKEN]: tokenOk, '/api/zfiles/list': () => new Response(readFileSync(join(FIX, 'zfiles.json')), { headers: { 'content-type': 'application/json' } }) });
  const files = await c.zfiles();
  assert.ok(Array.isArray(files));
  for (const f of files) assert.ok(f.id && f.folder && f.name);
});

import { achievementFamilies, splitImageName, nonRouteAchievements } from '../src/achievements.js';

test('splitImageName separates a tiered family from its rung', () => {
  assert.deepEqual(splitImageName('GiveRideOn3'), { family: 'GiveRideOn', tier: 3 });
  assert.deepEqual(splitImageName('Watt8'), { family: 'Watt', tier: 8 });
  assert.deepEqual(splitImageName('Drafting'), { family: 'Drafting', tier: null });
  assert.deepEqual(splitImageName('RouteComplete'), { family: 'RouteComplete', tier: null });
});

test('achievementFamilies builds tiered ladders and marks the next rung', () => {
  const cat = [
    { id: 30, name: 'RIDE ON', imageName: 'GiveRideOn1', isRouteCompletion: false },
    { id: 31, name: 'BIG FAN', imageName: 'GiveRideOn2', isRouteCompletion: false },
    { id: 32, name: 'FAN CLUB', imageName: 'GiveRideOn3', isRouteCompletion: false },
    { id: 2, name: 'MASTER DRAFTSMAN', imageName: 'Drafting', isRouteCompletion: false },
    { id: 100, name: 'TEMPUS FUGIT', imageName: 'RouteComplete', isRouteCompletion: true },
  ];
  const fams = achievementFamilies(cat, new Set([30, 31]));
  const rideOn = fams.find((f) => f.family === 'GiveRideOn');
  assert.equal(rideOn.tiered, true);
  assert.equal(rideOn.earnedCount, 2);
  assert.equal(rideOn.earnedTier, 2);
  assert.equal(rideOn.nextRung.name, 'FAN CLUB');
  assert.equal(rideOn.complete, false);

  const draft = fams.find((f) => f.family === 'Drafting');
  assert.equal(draft.tiered, false);
  assert.equal(draft.nextRung.name, 'MASTER DRAFTSMAN');

  assert.ok(!fams.some((f) => f.family === 'RouteComplete'), 'route completions are excluded');
});

test('nonRouteAchievements excludes route completions and marks earned', () => {
  const cat = [
    { id: 1, name: 'JELLY', imageName: '500w10sec', isRouteCompletion: false },
    { id: 100, name: 'TEMPUS FUGIT', imageName: 'RouteComplete', isRouteCompletion: true },
  ];
  const list = nonRouteAchievements(cat, new Set([1]));
  assert.equal(list.length, 1);
  assert.equal(list[0].earned, true);
});

import { describeAchievement } from '../src/achievements.js';

test('describeAchievement decodes systematic tokens, invents nothing', () => {
  assert.equal(describeAchievement('Watt5').category, 'power');
  assert.equal(describeAchievement('Watt5').tier, 5);
  assert.match(describeAchievement('40mphBike').howTo, /40 mph/);
  assert.match(describeAchievement('Ride7Days').howTo, /7 separate days/);
  assert.equal(describeAchievement('GiveRideOn3').tier, 3);
  assert.match(describeAchievement('SessionRun5k').howTo, /5 km/);
  assert.match(describeAchievement('ClimbAlpe25x').howTo, /25 times/);
  // event badges are labelled, not guessed
  assert.equal(describeAchievement('tdz2021ride_badge').category, 'event');
  // genuinely opaque -> null, never fabricated
  assert.equal(describeAchievement('SomethingWeird123').howTo, null);
  assert.equal(describeAchievement('').category, 'other');
});

test('powerCurve normalises the duration-keyed map to sorted arrays', async () => {
  const body = { finalActivityCountInRange: 12, activityCountInRange: null,
    pointsWatts: { '5': { value: 900, date: null }, '1': { value: 1000, date: null }, '60': { value: 400, date: '2026-01-01' } },
    pointsWattsPerKg: { '1': { value: 13.7, date: null } } };
  const c = client({ [TOKEN]: tokenOk, '/api/power-curve/best/all-time': () => json(body) });
  const pc = await c.powerCurve();
  assert.equal(pc.activityCount, 12);
  assert.deepEqual(pc.watts.map((p) => p.seconds), [1, 5, 60], 'sorted by duration');
  assert.equal(pc.watts[0].value, 1000);
  assert.equal(pc.watts[2].date, '2026-01-01');
  assert.equal(pc.wattsPerKg[0].value, 13.7);
});

test('powerCurve last-N passes the days query', async () => {
  let seen = '';
  const c = client({ [TOKEN]: tokenOk, '/api/power-curve/best/last': ({ }) => json({ pointsWatts: {} }) });
  // capture the query via a custom stub
  const c2 = new ZwiftClient({ tokenStore: memoryTokenStore('RT'), fetchImpl: async (url) => {
    seen = new URL(url).search;
    return url.includes('/token') ? tokenOk() : json({ pointsWatts: {}, pointsWattsPerKg: {} });
  } });
  await c2.powerCurve({ range: 'last', days: 30 });
  assert.equal(seen, '?days=30');
});

test('racingScore surfaces the public score', async () => {
  const c = client({ [TOKEN]: tokenOk, '/api/scoring/current': () => json({ scores: { ZWIFT_PUBLIC_SCORE: { value: 303.48, sport: 'CYCLING', isSeedScore: true } } }) });
  const s = await c.racingScore();
  assert.equal(s.publicScore, 303.48);
  assert.equal(s.sport, 'CYCLING');
});

test('clubs maps results to id/name', async () => {
  const c = client({ [TOKEN]: tokenOk, '/api/clubs/club/list/my-clubs': () => json({ total: 1, results: [{ id: 'abc', name: 'Team X', images: [] }] }) });
  const cl = await c.clubs();
  assert.equal(cl.length, 1);
  assert.equal(cl[0].id, 'abc');
  assert.equal(cl[0].name, 'Team X');
});
