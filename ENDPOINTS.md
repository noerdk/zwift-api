# Zwift API — verified endpoint map

Every entry here was confirmed against the live API. Unofficial and unstable.
`P` = `application/x-protobuf-lite`, `J` = `application/json`. Base host
`https://us-or-rly101.zwift.com` unless noted. See README for the auth flow.

## Authenticated — modelled by `ZwiftClient`

| Method | Endpoint | Fmt | Notes |
|---|---|---|---|
| `profile()` | `/api/profiles/me` | J | **must** send `Accept: json` or you get protobuf. Units normalised (grams→kg, mm→cm, level×100). |
| `earnedAchievementIds()` | `/api/achievement/loadPlayerAchievements` | P | earned achievement ids only (repeated field 1 → field 1 varint). |
| `achievementCatalogue()` | `/api/game_info` | J | all achievements; `imageName` recovered from `imageUrl`; `isRouteCompletion` flag. |
| `routeCompletionAchievements()` | `/api/achievement/route-completion-achievements` | P | the newer UUID-keyed route-completion system; disjoint from the integer ids. Rejects JSON (406). |
| `challenges()` | `/api/game_info` | J | the four epic-challenge definitions (no progress — see below). |
| `upcomingEvents()` | `/api/public/events/upcoming` | J | ~200 events with `routeId`, `eventSeries`. |
| `quests()` / `quests({onlyMine})` | `/api/quest/quests/all-quests` · `my-quests` | J | **`all-quests` is already personalised** (per-task progress). |
| `quest(id)` | `/api/quest/quests/{id}` | J | one quest; byte-identical to its `all-quests` entry. |
| `activities({profileId,limit,start})` | `/api/profiles/{id}/activities` | J | activity history with `distanceInMeters`, `totalElevation`. |
| `fitnessMetricsAndGoals()` | `/api/fitness/metrics-and-goals` | P | weekly training load (fresh/fatigue, ISO week) + weekly goal. **Not** epic challenges. *Experimental shape.* |
| `streaks()` | `/api/fitness/streaks` | P | ride-streak / weekly counters. *Experimental shape.* |
| `personalRecords()` | `/api/personal-records/my-records` | P | empty on fresh accounts; shape not yet mapped. |
| `zfiles()` | `/api/zfiles/list` | J | stored files (custom workouts, gearing, uploaded logs). |
| `powerCurve({range,days})` | `/api/power-curve/best/{all-time\|last}` | J | best-power curve, normalised to sorted watt / w-per-kg arrays. |
| `racingScore()` | `/api/scoring/current` | J | the athlete's public racing score. |
| `clubs()` | `/api/clubs/club/list/my-clubs` | J | clubs the athlete belongs to. |
| `homeRecommendations()` | `/api/head-unit-bff/game-home` | J | home-screen next-up / carousels (raw). |

## Unauthenticated CDN — modelled by `cdn`

| Function | File | Notes |
|---|---|---|
| `fetchGameDictionary()` | `GameDictionary.xml` | 400+ routes (geometry, sport bitfield, `isRouteCompletion` achievements). **Climb Portal roads are in centimetres.** |
| `fetchPortalRoads()` | `PortalRoadSchedule_v1.xml` | Climb Portal roads + daily rotation. |
| `fetchMapSchedule()` | `MapSchedule_v2.xml` | guest-world rotation. |

## Confirmed present but NOT modelled (writes — deliberately omitted)

- `POST /api/achievement/route-completion-achievement-unlocks` — **awards** an
  achievement (`RouteCompletionAchievementUnlockRequest`).
- `POST /api/achievement/unlock` — same class.

Implementing these would falsify the data the library reads. Left out on purpose.

## Not in the REST API (verified dead ends)

Negative results, so nobody re-runs them. Each was checked against the live API.

### Epic-challenge progress — it's on the realtime UDP channel, not HTTP

The four epic challenges (Climb Mt. Everest, Ride California, Tour Italy, Factory
Tour) show a live progress figure in game (e.g. 7168 / 8848 m). **That figure is
delivered over Zwift's realtime UDP protocol (`ZNet` / `RRPC`, via the relay
server) — not the REST API.** Proven by a full proxy capture of the running
macOS client (mitmproxy CA in the game's `cacert.pem`, `HTTPS_PROXY`; the game
authenticates over libcurl so its entire HTTPS surface was captured decrypted,
including opening the Everest screen in game):

- Every response body was byte-searched for both challenges' numbers (7168/8848
  and 503/1283) in metres, centimetres and millimetres, as protobuf varint,
  int32 and text. **The targets 8848 and 1283 appear in no HTTP response.**
- `GET /api/profiles/{id}/goals` returns **200 with 0 bytes**, called once at
  login and never again when the challenge screen opens.
- Opening the challenge screen fires **no** challenge-specific HTTP request
  (`challenges.wad` is a local UI asset); no local save file holds the values.
- The game log shows `Connecting to UDP server with relay id …` then
  `GoalsManager: received fitness metrics` over `[NETWORK]`.

An HTTP client therefore cannot read epic-challenge progress. Reading it would
mean reverse-engineering the encrypted realtime UDP protocol (the `zoffline`
problem) — out of scope here. A REST-side workaround is to anchor one in-game
reading against `profile.totalClimbedM` / `totalDistanceKm` and derive from
there (Everest = lifetime climbing − enrollment baseline).

### Achievement descriptions and rewards — not served

`game_info` returns only `{id, name, imageUrl}` per achievement; there is **no
description text and no per-achievement reward field** anywhere. Achievements do
not award Drops (only quests do; route badges award XP). `describeAchievement()`
derives the mechanic from the `imageName` token instead.

### Per-route level requirement — not published

Routes expose only a `levelLocked` boolean, never the level at which they
unlock — not in `GameDictionary.xml`, not in any endpoint found.

### `user-game-storage` — real, but not challenges

`/api/player-profile/user-game-storage/attributes` is `403 RBAC: access denied`
to a normal (`Zwift_Mobile_Link`) token — it needs the game's `Game_Launcher`
client role. Even with it, the store holds **settings, bike progress and
consent** (per zoffline's `user_storage.proto` and confirmed in the capture),
**not** challenge data.

### The unlock endpoints are writes — not implemented

`POST /api/achievement/unlock` and
`/api/achievement/route-completion-achievement-unlocks` **award** achievements
(`RouteCompletionAchievementUnlockRequest`). This library never calls them;
doing so would falsify the data it reads.

## Drops (currency)

Zwift's in-game currency is **Drops** (internally `totalGold`). Exposed as
`profile().totalDrops` (the balance) and, on quests, `dropsTotal` /
`dropsRemaining` per quest plus `accumulatorProgress().nextMilestoneDrops`.

## Achievement families (`achievements` helpers)

Non-route achievements include **tiered ladders** encoded in `imageName`
(trailing digit = rung): `GiveRideOn1/2/3`, `GetRideOn1..`, `Watt1..8`,
`VolcanoLap1/2/3`, `DistanceRun100/500/1000`. `achievementFamilies(catalogue,
earnedIds)` groups them and reports the earned rung and the next one.

`describeAchievement(imageName)` derives what an achievement is and how it is
earned **from its imageName token** (`Watt5` → peak-power tier 5, `Ride7Days` →
ride 7 days). Zwift's API serves **no** description text and **no per-achievement
reward** — there is no Drops or XP field on an achievement anywhere. Only quests
pay Drops, and route badges pay XP. 56 non-route achievements decode to a
mechanic; the rest are one-off event badges, labelled as such.

**Terminology:** Zwift's *data* layer calls all of these **achievements**; its
*UI* calls them **badges**. Route-completion achievements
(`imageName === 'RouteComplete'`) are what the UI shows as "route badges".
