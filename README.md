# zwift-api

An unofficial, **read-only** Node client for Zwift's undocumented API: sign-in,
profile, earned achievements, upcoming events, quests, and the public game
catalogue.

Zero runtime dependencies. ESM. Node 18+.

## What is Zwift?

[Zwift](https://www.zwift.com) is an online indoor-cycling and running platform
by **Zwift, Inc.** — you ride a smart trainer and control an avatar in shared
virtual worlds, earning XP, route badges, achievements and Drops as you go. The
app talks to a set of backend services over HTTP. Those services are private and
undocumented; this library is a community-built, read-only client for the ones
that expose an athlete's own data (profile, achievements, events, quests, power
curve, and the public game catalogue on Zwift's CDN).

## Unofficial — and Zwift owns everything about Zwift

> **This is an unofficial, unaffiliated, community project. It is not made,
> endorsed, sponsored, or supported by Zwift, Inc.**
>
> **Zwift, Inc. owns all rights to the Zwift game, service, applications,
> backend APIs, data, artwork, and other assets, and to the "Zwift" name, logo,
> and related trademarks.** All such marks are the property of Zwift, Inc. This
> project uses the name "Zwift" only nominatively — to describe what it
> interoperates with — and claims no ownership of or association with it.
>
> This repository ships **no Zwift code, artwork, or proprietary data**. It is
> plain source that makes HTTP requests; each user accesses **their own account
> data with their own credentials**, at their own risk. The endpoints are
> undocumented and **may change or break at any time**.
>
> You are responsible for using this in accordance with
> [Zwift's Terms of Service](https://www.zwift.com/terms). It is intended for
> personal use with your own account. It is **read-only by design** and does not
> modify your account, ride data, or achievements.

## Install

```bash
npm install zwift-api
```

## Use

```js
import { ZwiftClient, quests as Q, cdn } from 'zwift-api';

const client = new ZwiftClient({ credentials: { username, password } });
await client.connect();

const me      = await client.profile();              // units already normalised
const earned  = await client.earnedAchievementIds(); // Set<number>, from protobuf
const events  = await client.upcomingEvents();
const myQuest = await client.quests();               // already carries your progress
```

The catalogue needs no account at all:

```js
const { routes, achievements } = await cdn.fetchGameDictionary();
const portals = await cdn.fetchPortalRoads();
cdn.activePortalRoads(portals);   // which Climb Portal road is open now
```

## It is read-only on purpose

Zwift exposes endpoints that **award** achievements
(`/api/achievement/unlock`, `/api/achievement/route-completion-achievement-unlocks`
— the game names the message `RouteCompletionAchievementUnlockRequest`). This
library does not implement them, and a test asserts no write-shaped method
exists. Calling them would falsify the data the library exists to read.

The cost is that **Climb Portal completion state is unreadable**: Zwift only
exposes which portal badges you hold through that write path.

## Tokens

Only the refresh token is ever persisted, and only by a store you supply. The
default keeps it in memory.

```js
const client = new ZwiftClient({
  tokenStore: { get: () => read(), set: (t) => write(t), clear: () => rm() },
});
```

Treat that token as a long-lived credential: **the refresh grant returns an
access token valid for roughly 1000 days**, where the password grant gives six
hours. Store it at `0600` or better. The library never logs, and
`describeSession()` and `redact()` exist so you do not have to think about it.

## Things that will bite you

These are all handled inside the library; they are documented because they are
surprising, and because they explain the shape of the API.

| | |
|---|---|
| **`/api/profiles/me` content-negotiates** | Without an explicit `Accept: application/json` it returns protobuf. |
| **Protobuf without schemas** | Several endpoints are `application/x-protobuf-lite`. Rather than guess a `.proto`, this reads the raw wire format, so drift surfaces as a `ZwiftSchemaError` instead of silent zeros. `wire.describe(buf)` prints the structure. |
| **Climb Portal roads are in CENTIMETRES** | In `GameDictionary.xml`, portal roads store centimetres in attributes named `distanceInMeters` / `ascentInMeters`. Ordinary routes really are metres. Untreated, a 4.6 km climb reads as 459 km. |
| **Schedule offsets lack minutes** | `2026-09-10T00:01-04` is legal ISO 8601 but `new Date()` returns `Invalid Date`. Use `cdn.parseZwiftDate`. |
| **`sports` is a bitfield** | Bit 0 cycling, bit 1 running — and it is authoritative; it disagrees with third-party route data on ~85 routes. |
| **`profile.weight` is grams**, `height` millimetres, `achievementLevel` is level × 100 | Normalised by `client.profile()`; `raw` keeps the original. |
| **`all-quests` is already personalised** | It carries your per-task progress. `my-quests` is just the subset you are registered in, not richer data. |

## Quest progress

```js
const active = (await client.quests()).filter(Q.isActive);

Q.goalXp(quest);              // { completedGoals, xpNow, xpRemaining }
Q.accumulatorProgress(quest); // distance quests: current, next milestone
Q.routeXpIndex(active);       // routeId        -> quest XP for riding it
Q.eventSeriesXpIndex(active); // eventSeriesId  -> quest XP for entering it
Q.portalRoadXpIndex(active);  // portalRoadId   -> Climb of the Week
```

Milestones pay at a threshold (`goalsCount` goals, or `distance` metres), so
`xpNow` is the XP finishing one more goal actually unlocks — computed, not
apportioned.

## Known gap: the four epic challenges

Everest, Ride California, Tour Italy and Factory Tour expose **no per-player
progress anywhere**. This is a live feature, not a deprecated one, and it is
distinct from quests. Ruled out so far: ~20 endpoint shapes; `GameDictionary`'s
`<CHALLENGE>` elements; the profile's `privateAttributes` map (CRC32-keyed —
searched exhaustively against a known in-game reading, in progress, target,
offset, remainder and percentage form); and the protobuf profile's 180 fields.

`/api/player-profile/user-game-storage/attributes` returns **403** to a normal
bearer token and remains the most likely home. See `OPEN-PROBLEMS.md`.

## Errors

`ZwiftError` (with `status`, `path`, `body`), `ZwiftAuthError`,
`ZwiftSchemaError`. No error message ever contains token material.

## Test

```bash
npm test
```

24 tests, none of which touch the network — the client takes a `fetchImpl`, so
everything is exercised against a stub.

## Full endpoint map

See [`ENDPOINTS.md`](ENDPOINTS.md) for every verified endpoint and what it
returns — and a **"Not in the REST API (verified dead ends)"** section recording
what is *not* reachable and why, so you don't repeat the search. The headline
one: **epic-challenge progress (Everest etc.) travels on Zwift's realtime UDP
protocol, not HTTP** — proven by a full proxy capture — so no HTTP client can
read it.

## Licence

MIT.
