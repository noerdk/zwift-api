# Changelog

All notable changes to `zwift-api` are recorded here. This project follows
[Semantic Versioning](https://semver.org). Pre-1.0, minor versions may make
breaking changes.

## 0.3.0

- Endpoints captured from a live proxy of the game: `powerCurve`, `racingScore`,
  `clubs`, `homeRecommendations`.
- Documented that epic-challenge progress travels on the realtime UDP protocol,
  not HTTP — an HTTP client cannot read it.

## 0.2.0

- Complete data model of the verified API surface.
- Endpoints: profile, earned achievements, achievement catalogue, route-completion
  achievements, challenges, upcoming events, quests, activities, fitness
  metrics-and-goals, streaks, personal records, zfiles.
- CDN parsers: GameDictionary, PortalRoadSchedule, MapSchedule.
- `wire.decode()` for faithful decoding of unknown protobuf messages.
- `achievements` helpers: tiered achievement ladders (Ride On, Watt, …).
- Terminology aligned to Zwift's data layer: route completions are flagged
  `isRouteCompletion`.

## 0.1.0

- Initial extraction from the Zwift Badge Planner project: `ZwiftClient`, auth
  (password + refresh grants), protobuf wire reader, error types.
