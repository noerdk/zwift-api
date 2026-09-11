// One function per Zwift resource. Each takes a bound `ctx` ({apiBase, headers,
// fetchImpl}) so they compose into the client without depending on it.
import { ZwiftSchemaError } from './errors.js';
import { getJson, getProto } from './http.js';
import { scan, varints, messages, num, str, decode } from './wire.js';

/** GET /api/profiles/me — note the explicit JSON Accept; the default is protobuf. */
export async function profile(ctx) {
  const p = await getJson(`${ctx.apiBase}/api/profiles/me`, ctx.opts());
  return {
    id: p.id,
    publicId: p.publicId,
    firstName: p.firstName,
    lastName: p.lastName,
    ftp: p.ftp ?? null,
    weightKg: typeof p.weight === 'number' ? p.weight / 1000 : null,   // grams
    heightCm: typeof p.height === 'number' ? p.height / 10 : null,     // millimetres
    level: typeof p.achievementLevel === 'number' ? Math.floor(p.achievementLevel / 100) : null,
    runLevel: typeof p.runAchievementLevel === 'number' ? Math.floor(p.runAchievementLevel / 100) : null,
    totalXp: p.totalExperiencePoints ?? null,
    totalDrops: p.totalGold ?? null,
    totalDistanceKm: typeof p.totalDistance === 'number' ? p.totalDistance / 1000 : null,
    totalClimbedM: p.totalDistanceClimbed ?? null,
    totalTimeMinutes: p.totalTimeInMinutes ?? null,
    useMetric: p.useMetric ?? true,
    raw: p,
  };
}

/**
 * GET /api/achievement/loadPlayerAchievements — protobuf.
 * Shape: repeated field 1, each a message whose field 1 is the achievement id.
 */
export async function earnedAchievementIds(ctx) {
  const buf = await getProto(`${ctx.apiBase}/api/achievement/loadPlayerAchievements`, ctx.opts());
  if (buf.length === 0) return new Set();
  let fields;
  try { fields = scan(buf); } catch (err) {
    throw new ZwiftSchemaError('loadPlayerAchievements was not valid protobuf', { cause: err, body: buf.subarray(0, 40).toString('hex') });
  }
  const ids = messages(fields, 1)
    .map((m) => num(scan(m), 1))
    .filter((id) => Number.isInteger(id) && id > 0);
  // A non-empty body that yields nothing means the shape moved.
  if (!ids.length && fields.length) {
    throw new ZwiftSchemaError(`loadPlayerAchievements returned ${fields.length} fields but no achievement ids — schema drift`);
  }
  return new Set(ids);
}

/**
 * GET /api/achievement/route-completion-achievements — protobuf.
 * A newer, UUID-keyed route-badge system, disjoint from the integer achievement
 * ids above. Small: at time of writing it covers unreleased and Climb Portal
 * routes only. Rejects application/json with 406.
 */
export async function routeCompletionAchievements(ctx) {
  const buf = await getProto(`${ctx.apiBase}/api/achievement/route-completion-achievements`, ctx.opts());
  if (!buf.length) return [];
  return messages(scan(buf), 1).map((m) => {
    const f = scan(m);
    return { uuid: str(f, 1), routeId: num(f, 2), sport: num(f, 3), xp: num(f, 4) ?? 0, name: str(f, 5), slug: str(f, 6) };
  });
}

/** GET /api/game_info — achievements catalogue, challenge definitions, schedules. */
export async function gameInfo(ctx) {
  return getJson(`${ctx.apiBase}/api/game_info`, ctx.opts());
}

/** Achievement catalogue. `imageUrl`'s filename is the same token GameDictionary calls `imageName`. */
export async function achievementCatalogue(ctx) {
  const info = await gameInfo(ctx);
  return (info.achievements ?? []).map((a) => {
    const file = decodeURIComponent((a.imageUrl ?? '').split('/').pop() ?? '');
    const imageName = file.replace(/\.png$/i, '');
    return { id: a.id, name: a.name, imageUrl: a.imageUrl, imageName, isRouteCompletion: imageName === 'RouteComplete' };
  });
}

/**
 * The four open-ended "epic" challenges (Everest, Ride California, Tour Italy,
 * Factory Tour). Definitions only — Zwift serves no per-player progress for
 * these anywhere. See the README.
 */
export async function challenges(ctx) {
  const info = await gameInfo(ctx);
  return (info.challenges ?? []).map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl }));
}

/** GET /api/public/events/upcoming */
export async function upcomingEvents(ctx) {
  const list = await getJson(`${ctx.apiBase}/api/public/events/upcoming`, ctx.opts());
  if (!Array.isArray(list)) throw new ZwiftSchemaError('events/upcoming did not return an array');
  return list;
}

/**
 * Quests — what Zwift calls its time-boxed challenges internally.
 * `all-quests` is already personalised: it carries your per-task progress.
 * `my-quests` is the subset you are registered in, not richer data.
 */
export async function quests(ctx, { onlyMine = false } = {}) {
  const path = onlyMine ? 'my-quests' : 'all-quests';
  const list = await getJson(`${ctx.apiBase}/api/quest/quests/${path}`, ctx.opts());
  if (!Array.isArray(list)) throw new ZwiftSchemaError(`quest/${path} did not return an array`);
  return list;
}

export async function quest(ctx, questId) {
  return getJson(`${ctx.apiBase}/api/quest/quests/${encodeURIComponent(questId)}`, ctx.opts());
}

/** GET /api/profiles/{id}/activities */
export async function activities(ctx, { profileId, limit = 20, start = 0 } = {}) {
  const id = profileId ?? 'me';
  return getJson(`${ctx.apiBase}/api/profiles/${encodeURIComponent(id)}/activities?start=${start}&limit=${limit}`, ctx.opts());
}

/**
 * GET /api/fitness/metrics-and-goals — protobuf.
 * Zwift's training-load view (fresh/fatigue by ISO week) plus the weekly
 * training goal — NOT the epic challenges. Field semantics are only partly
 * known, so this returns the faithfully-decoded protobuf (keyed by field
 * number) with the labels we are confident about surfaced alongside.
 * EXPERIMENTAL: the decoded shape may change as more fields are identified.
 */
export async function fitnessMetricsAndGoals(ctx) {
  const buf = await getProto(`${ctx.apiBase}/api/fitness/metrics-and-goals`, ctx.opts());
  const raw = decode(buf);
  // What we are confident of: field 2/3 are week blocks whose field 1 is an ISO
  // date and field 10 a fitness state string ("FRESH"/…).
  const week = (w) => (w ? { weekStart: w['1'] ?? null, state: w['10'] ?? null, fields: w } : null);
  return { currentWeek: week(raw['2']), previousWeek: week(raw['3']), raw };
}

/**
 * GET /api/fitness/streaks — protobuf. Ride-streak and weekly counters.
 * EXPERIMENTAL: returned keyed by field number; only the timestamps (fields
 * 9/10, epoch ms) are firmly identified.
 */
export async function streaks(ctx) {
  const buf = await getProto(`${ctx.apiBase}/api/fitness/streaks`, ctx.opts());
  return decode(buf);
}

/**
 * GET /api/personal-records/my-records — protobuf.
 * Empty on accounts without records; the populated shape is not yet mapped, so
 * this returns the decoded protobuf as-is. EXPERIMENTAL.
 */
export async function personalRecords(ctx) {
  const buf = await getProto(`${ctx.apiBase}/api/personal-records/my-records`, ctx.opts());
  return buf.length ? decode(buf) : {};
}

/**
 * GET /api/zfiles/list — the player's stored files (custom workouts, gearing,
 * uploaded logs). JSON. `content` is null in the listing; a file is downloaded
 * separately by id.
 */
export async function zfiles(ctx) {
  const list = await getJson(`${ctx.apiBase}/api/zfiles/list`, ctx.opts());
  if (!Array.isArray(list)) throw new ZwiftSchemaError('zfiles/list did not return an array');
  return list.map((f) => ({ id: f.id, folder: f.folder, name: f.name, lastModified: f.lastModified ?? null }));
}

/**
 * GET /api/power-curve/best/{range} — the athlete's best-power curve.
 * `range` is 'all-time' (default) or 'last' (with `days`). Zwift returns a
 * duration-keyed map ({ "1": {value, date}, "2": … } in seconds); this
 * normalises it to sorted arrays.
 */
export async function powerCurve(ctx, { range = 'all-time', days } = {}) {
  const q = range === 'last' && days ? `?days=${days}` : '';
  const raw = await getJson(`${ctx.apiBase}/api/power-curve/best/${range}${q}`, ctx.opts());
  const toArr = (m) => Object.entries(m ?? {})
    .map(([sec, p]) => ({ seconds: Number(sec), value: p.value, date: p.date ?? null }))
    .sort((a, b) => a.seconds - b.seconds);
  return {
    range,
    activityCount: raw.finalActivityCountInRange ?? raw.activityCountInRange ?? null,
    watts: toArr(raw.pointsWatts),
    wattsPerKg: toArr(raw.pointsWattsPerKg),
    raw,
  };
}

/**
 * GET /api/scoring/current — the athlete's current racing score(s).
 * Returns the public racing score value plus the full per-sport map.
 */
export async function racingScore(ctx) {
  const raw = await getJson(`${ctx.apiBase}/api/scoring/current`, ctx.opts());
  const pub = raw.scores?.ZWIFT_PUBLIC_SCORE ?? null;
  return {
    publicScore: pub?.value ?? null,
    sport: pub?.sport ?? null,
    isSeedScore: pub?.isSeedScore ?? null,
    scores: raw.scores ?? {},
  };
}

/** GET /api/clubs/club/list/my-clubs — the clubs the athlete belongs to. */
export async function clubs(ctx) {
  const raw = await getJson(`${ctx.apiBase}/api/clubs/club/list/my-clubs`, ctx.opts());
  return (raw.results ?? []).map((c) => ({ id: c.id, name: c.name ?? null, images: c.images ?? [], raw: c }));
}

/**
 * GET /api/head-unit-bff/game-home — the game home-screen recommendation blob
 * (next-up workout/route, "for you" carousels). Returned as-is; the shape is
 * large and presentation-oriented.
 */
export async function homeRecommendations(ctx) {
  return getJson(`${ctx.apiBase}/api/head-unit-bff/game-home`, ctx.opts());
}
