// Modelling the achievement catalogue.
//
// Zwift's non-route badges are not a flat list: many are TIERED LADDERS encoded
// in the `imageName`, where a trailing number is the rung. Earning a higher rung
// implies the lower ones. Examples verified against the live catalogue:
//   GiveRideOn1/2/3  RIDE ON → BIG FAN → FAN CLUB          (ride-ons given)
//   GetRideOn1/2/3   YOU'RE POPULAR → YOU'RE FAMOUS → …    (ride-ons received)
//   Watt1..8         SPRINTER APPRENTICE → … → 1.21 GIGAWATTS (peak power)
//   VolcanoLap1/2/3, DistanceRun100/500/1000
// The rest are standalone single badges.
//
// TERMINOLOGY: Zwift's data layer calls all of these ACHIEVEMENTS (the API path
// is /api/achievement/..., the GameDictionary tag is <ACHIEVEMENT>). Its UI layer
// calls them BADGES. Route-completion achievements (imageName === 'RouteComplete')
// are the ones the UI shows as "route badges"; they map to routes and are handled
// by the CDN GameDictionary parser (flagged there as `isRouteCompletion`).

/** Split an imageName into { family, tier }. */
export function splitImageName(imageName) {
  const m = /^(.*?)(\d+)$/.exec(imageName ?? '');
  return m ? { family: m[1], tier: Number(m[2]) } : { family: imageName ?? '', tier: null };
}

/**
 * Group non-route achievements into families, each a tier-sorted ladder, marked
 * against the earned set. `earnedIds` is a Set of achievement ids.
 *
 * Returns [{ family, tiered, rungs: [{...ach, tier, earned}], earnedTier,
 *            nextRung, complete }] — `earnedTier` is the highest rung held,
 * `nextRung` the lowest unearned one.
 */
export function achievementFamilies(catalogue, earnedIds = new Set()) {
  const byFamily = new Map();
  for (const a of catalogue) {
    if (a.isRouteCompletion) continue;
    const { family, tier } = splitImageName(a.imageName);
    if (!byFamily.has(family)) byFamily.set(family, []);
    byFamily.get(family).push({ ...a, tier, earned: earnedIds.has(a.id) });
  }
  const families = [];
  for (const [family, rungs] of byFamily) {
    rungs.sort((x, y) => (x.tier ?? 0) - (y.tier ?? 0));
    const tiered = rungs.length > 1 && rungs.some((r) => r.tier != null);
    const earnedRungs = rungs.filter((r) => r.earned);
    families.push({
      family,
      tiered,
      rungs,
      earnedTier: earnedRungs.length ? earnedRungs[earnedRungs.length - 1].tier : null,
      earnedCount: earnedRungs.length,
      nextRung: rungs.find((r) => !r.earned) ?? null,
      complete: rungs.every((r) => r.earned),
    });
  }
  return families;
}

/** Just the non-route achievements, flat, marked earned. */
export function nonRouteAchievements(catalogue, earnedIds = new Set()) {
  return catalogue.filter((a) => !a.isRouteCompletion).map((a) => ({ ...a, earned: earnedIds.has(a.id) }));
}

/**
 * Derive what an achievement is and how it is earned FROM its imageName token.
 *
 * IMPORTANT: Zwift's API does not serve achievement descriptions or rewards —
 * game_info returns only {id, name, imageUrl}, and there is no per-achievement
 * Drops or XP field anywhere. This function decodes the imageName (Zwift's own
 * token, e.g. "Watt5", "40mphBike", "Ride7Days") into a mechanic. It invents
 * nothing: where the token carries a number and unit that is reported; exact
 * hidden thresholds (the watts behind Watt5, say) are NOT guessed. Event badges
 * (imageName ending "_badge") were one-off event completions and are labelled
 * as such.
 *
 * Returns { category, howTo, tier } — `tier` for ladder rungs, or null.
 */
export function describeAchievement(imageName, name = '') {
  const img = imageName ?? '';
  const m = (re) => re.exec(img);
  let g;

  if ((g = m(/^Watt(\d+)$/)))
    return { category: 'power', tier: +g[1], howTo: `Hit peak-power milestone ${g[1]} of 8 (a sustained-wattage threshold).` };
  if ((g = m(/^(\d+)w(\d+)sec$/)))
    return { category: 'power', tier: null, howTo: `Hold ${g[1]} W for ${g[2]} seconds.` };
  if ((g = m(/^(\d+)mph/)))
    return { category: 'speed', tier: null, howTo: `Reach ${g[1]} mph.` };
  if (m(/^100kph$/)) return { category: 'speed', tier: null, howTo: 'Reach 100 km/h.' };
  if ((g = m(/^Distance(?:Run)?(\d+)(km|mi)?$/)))
    return { category: 'distance', tier: null, howTo: `Accumulate ${g[1]}${g[2] ?? ' km'} total ${/Run/.test(img) ? 'run' : 'ride'} distance.` };
  if ((g = m(/^Ride(\d+)days?$/i)))
    return { category: 'streak', tier: null, howTo: `Ride on ${g[1]} separate days${+g[1] > 2 ? ' in a streak' : ''}.` };
  if ((g = m(/^(Give|Get)RideOn(\d+)$/)))
    return { category: 'social', tier: +g[2], howTo: `${g[1] === 'Give' ? 'Give' : 'Receive'} Ride Ons — tier ${g[2]}.` };
  if (m(/^Drafting$/)) return { category: 'skill', tier: null, howTo: 'Ride in another rider’s draft.' };
  if (m(/^Fanview$/)) return { category: 'social', tier: null, howTo: 'Get watched via Fan View.' };
  if (m(/^Uturn$/)) return { category: 'skill', tier: null, howTo: 'Make a U-turn.' };
  if (m(/^ConnectToStrava$/)) return { category: 'setup', tier: null, howTo: 'Connect your Strava account.' };
  if (m(/^PairZwift$/)) return { category: 'setup', tier: null, howTo: 'Pair the Companion app / a device.' };
  if (m(/^CompleteWorkout$/)) return { category: 'training', tier: null, howTo: 'Complete a structured workout.' };
  if ((g = m(/^VolcanoLap0?(\d+)$/)))
    return { category: 'segment', tier: +g[1], howTo: `Complete ${g[1]} lap${+g[1] > 1 ? 's' : ''} of the Volcano.` };
  if ((g = m(/^SessionRun(\d+)(mi|k)$/)))
    return { category: 'run', tier: null, howTo: `Run ${g[1]}${g[2] === 'k' ? ' km' : ' miles'} in a single session.` };
  if ((g = m(/^MileRun(\d+)min$/)))
    return { category: 'run', tier: null, howTo: `Run a mile in under ${g[1]} minutes.` };
  if (m(/^EverestChallenge$/)) return { category: 'climb', tier: null, howTo: 'Complete the Climb Mt. Everest challenge (8,848 m).' };
  if ((g = m(/^ClimbAlpe(\d+)(x|hour)$/)))
    return { category: 'climb', tier: null, howTo: g[2] === 'hour' ? 'Climb Alpe du Zwift in under an hour.' : `Climb Alpe du Zwift ${g[1]} times.` };
  if ((g = m(/^ClimbPortal(\d+)x$/)))
    return { category: 'climb', tier: null, howTo: `Complete ${g[1]} Climb Portal ascent${+g[1] > 1 ? 's' : ''}.` };
  if (/_badge$/i.test(img))
    return { category: 'event', tier: null, howTo: 'Earned by taking part in a specific, usually time-limited Zwift event.' };
  return { category: 'other', tier: null, howTo: null };
}
