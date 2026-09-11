// Zwift's public game assets. No authentication, no account needed — these are
// the same files the game downloads at startup.
import { DEFAULT_CDN_BASE, request } from './http.js';

const ENTITIES = { amp: '&', apos: "'", quot: '"', lt: '<', gt: '>' };
const decodeEntities = (s) =>
  s.replace(/&(amp|apos|quot|lt|gt);/g, (_, e) => ENTITIES[e])
   .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
   .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

function attrs(tag, xml) {
  return [...xml.matchAll(new RegExp(`<${tag} ([^>]*?)/>`, 'g'))].map((m) => {
    const o = {};
    for (const a of m[1].matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) o[a[1]] = decodeEntities(a[2]);
    return o;
  });
}

/** Zwift writes UTC offsets without minutes ("-04"); `new Date` rejects those. */
export function parseZwiftDate(s) {
  return new Date(String(s).replace(/([+-]\d{2})$/, '$1:00'));
}

const WORLDS = {
  WATOPIA: 'watopia', NEWYORK: 'new-york', LONDON: 'london', RICHMOND: 'richmond',
  INNSBRUCK: 'innsbruck', YORKSHIRE: 'yorkshire', FRANCE: 'france', PARIS: 'paris',
  SCOTLAND: 'scotland', MAKURIISLANDS: 'makuri-islands', CRITCITY: 'crit-city',
  BOLOGNATT: 'bologna', 'GRAVEL MOUNTAIN': 'gravel-mountain',
};

/**
 * GameDictionary.xml — the game's own catalogue of routes and achievements.
 *
 * Two traps, both handled here:
 *  - Climb Portal roads (those with no `map`) store CENTIMETRES in the
 *    attributes named `distanceInMeters` / `ascentInMeters`. Ordinary routes
 *    really are metres. Verified against PortalRoadSchedule's centimetre fields.
 *  - `sports` is a bitfield (bit 0 cycling, bit 1 running), and is authoritative.
 */
export function parseGameDictionary(xml) {
  const routes = attrs('ROUTE', xml).map((r) => {
    const isPortal = !r.map;
    const div = isPortal ? 100 : 1;
    const sports = Number(r.sports);
    return {
      id: Number(r.signature),
      name: r.name,
      world: WORLDS[r.map] ?? null,
      distanceKm: Number(r.distanceInMeters) / div / 1000,
      elevationM: Number(r.ascentInMeters) / div,
      leadInKm: Number(r.leadinDistanceInMeters ?? 0) / div / 1000,
      leadInElevationM: Number(r.leadinAscentInMeters ?? 0) / div,
      eventOnly: r.eventOnly === '1',
      levelLocked: r.levelLocked === '1',
      supportsTimeTrial: r.supportsTimeTrialMode === '1',
      sports,
      cycling: (sports & 1) !== 0,
      running: (sports & 2) !== 0,
      isPortal,
    };
  }).filter((r) => Number.isFinite(r.id) && r.name);

  const achievements = attrs('ACHIEVEMENT', xml).map((a) => ({
    id: Number(a.signature),
    name: a.name,
    imageName: a.imageName,
    sport: Number(a.sport),               // 0 cycling, 1 running, -1 n/a
    isRouteCompletion: a.imageName === 'RouteComplete',
  })).filter((a) => Number.isFinite(a.id));

  const challenges = attrs('CHALLENGE', xml).map((c) => ({
    id: Number(c.signature), name: c.name, imageName: c.imageName,
  })).filter((c) => Number.isFinite(c.id));

  return { routes, achievements, challenges };
}

/** PortalRoadSchedule_v1.xml — Climb Portal roads plus the rotation calendar. */
export function parsePortalRoads(xml) {
  const roads = attrs('PortalRoadMetadata', xml).map((r) => ({
    id: Number(r.id),
    name: r.name,
    distanceKm: Number(r.distanceCentimeters) / 100000,
    elevationM: Number(r.elevCentimeters) / 100,
  })).filter((r) => Number.isFinite(r.id));

  const schedule = attrs('appointment', xml).map((a) => ({
    roadId: Number(a.road),
    worldId: Number(a.world),
    portal: Number(a.portal ?? 0),
    portalOfMonth: a.portal_of_month === 'true',
    start: parseZwiftDate(a.start),
  })).filter((a) => Number.isFinite(a.roadId) && !Number.isNaN(a.start.getTime()))
    .sort((a, b) => a.start - b.start);

  return { roads, schedule };
}

/** MapSchedule_v2.xml — the guest-world rotation. */
export function parseMapSchedule(xml) {
  return attrs('appointment', xml)
    .map((a) => ({ map: a.map, start: parseZwiftDate(a.start) }))
    .filter((a) => a.map && !Number.isNaN(a.start.getTime()))
    .sort((a, b) => a.start - b.start);
}

/** Which portal road is open per slot at `when`. */
export function activePortalRoads({ roads, schedule }, when = new Date()) {
  const byId = new Map(roads.map((r) => [r.id, r]));
  const current = new Map();
  for (const a of schedule) {
    if (a.start > when) break;
    current.set(a.portal, a);
  }
  return [...current.values()]
    .map((a) => ({ ...byId.get(a.roadId), roadId: a.roadId, portal: a.portal, worldId: a.worldId, portalOfMonth: a.portalOfMonth, since: a.start }))
    .filter((r) => r.name);
}

export function nextPortalChange({ schedule }, when = new Date()) {
  return schedule.find((a) => a.start > when) ?? null;
}

async function text(url, opts) {
  const { buf } = await request(url, opts);
  return buf.toString('utf8');
}

export async function fetchGameDictionary({ cdnBase = DEFAULT_CDN_BASE, ...opts } = {}) {
  return parseGameDictionary(await text(`${cdnBase}/gameassets/GameDictionary.xml`, opts));
}
export async function fetchPortalRoads({ cdnBase = DEFAULT_CDN_BASE, ...opts } = {}) {
  return parsePortalRoads(await text(`${cdnBase}/gameassets/PortalRoadSchedule_v1.xml`, opts));
}
export async function fetchMapSchedule({ cdnBase = DEFAULT_CDN_BASE, ...opts } = {}) {
  return parseMapSchedule(await text(`${cdnBase}/gameassets/MapSchedule_v2.xml`, opts));
}
