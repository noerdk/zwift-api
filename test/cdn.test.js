import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGameDictionary, parsePortalRoads, activePortalRoads, nextPortalChange, parseZwiftDate } from '../src/cdn.js';

const GD = `<GameDictionary>
<ROUTES>
<ROUTE name="Tempus Fugit" map="WATOPIA" distanceInMeters="17231.3" ascentInMeters="26" leadinDistanceInMeters="2356" leadinAscentInMeters="0" eventOnly="0" levelLocked="0" sports="1" signature="2128890027"/>
<ROUTE name="Col d&apos;Aspin" map="" distanceInMeters="1353582.25" ascentInMeters="81151.24" leadinDistanceInMeters="0" leadinAscentInMeters="0" eventOnly="0" levelLocked="0" sports="1" signature="10004"/>
<ROUTE name="Run Only" map="WATOPIA" distanceInMeters="5000" ascentInMeters="10" eventOnly="0" levelLocked="1" sports="2" signature="42"/>
</ROUTES>
<ACHIEVEMENTS>
<ACHIEVEMENT imageName="RouteComplete" name="TEMPUS FUGIT" sport="0" signature="100"/>
<ACHIEVEMENT imageName="RouteComplete" name="FLAT ROUTE RUN" sport="1" signature="498"/>
<ACHIEVEMENT imageName="Drafting" name="MASTER DRAFTSMAN" sport="0" signature="2"/>
</ACHIEVEMENTS>
<CHALLENGES><CHALLENGE imageName="Climb_Mt__Everest" name="Climb Mt. Everest" signature="1231"/></CHALLENGES>
</GameDictionary>`;

test('ordinary routes are metres, Climb Portal roads are centimetres', () => {
  const { routes } = parseGameDictionary(GD);
  const tempus = routes.find((r) => r.id === 2128890027);
  assert.ok(Math.abs(tempus.distanceKm - 17.2313) < 1e-4);
  assert.equal(tempus.elevationM, 26);
  assert.equal(tempus.isPortal, false);

  // Portal road: the `...InMeters` attributes actually hold centimetres.
  const aspin = routes.find((r) => r.id === 10004);
  assert.equal(aspin.isPortal, true);
  assert.ok(Math.abs(aspin.distanceKm - 13.5358) < 1e-3, `got ${aspin.distanceKm}`);
  assert.ok(Math.abs(aspin.elevationM - 811.51) < 0.01, `got ${aspin.elevationM}`);
});

test('sports is a bitfield, not a label', () => {
  const { routes } = parseGameDictionary(GD);
  assert.equal(routes.find((r) => r.id === 2128890027).cycling, true);
  assert.equal(routes.find((r) => r.id === 42).cycling, false);
  assert.equal(routes.find((r) => r.id === 42).running, true);
});

test('XML entities are decoded and levelLocked is read', () => {
  const { routes } = parseGameDictionary(GD);
  assert.equal(routes.find((r) => r.id === 10004).name, "Col d'Aspin");
  assert.equal(routes.find((r) => r.id === 42).levelLocked, true);
});

test('route badges are identified by imageName, sport by field', () => {
  const { achievements, challenges } = parseGameDictionary(GD);
  const badges = achievements.filter((a) => a.isRouteCompletion);
  assert.equal(badges.length, 2);
  assert.equal(badges.find((a) => a.id === 498).sport, 1, 'running badge');
  assert.equal(achievements.find((a) => a.id === 2).isRouteCompletion, false);
  assert.equal(challenges[0].id, 1231);
});

const PR = `<PortalRoads>
<PortalRoadMetadataCollections>
<PortalRoadMetadata name="Cote de Trebiac" id="10009" distanceCentimeters="459264.21" elevCentimeters="20742.36"/>
<PortalRoadMetadata name="Alto de Patios" id="10052" distanceCentimeters="593000" elevCentimeters="37700"/>
</PortalRoadMetadataCollections>
<PortalRoadSchedule><appointments>
<appointment road="10009" world="1" portal="0" start="2026-09-10T00:01-04"/>
<appointment road="10052" world="1" portal="0" start="2026-09-12T00:01-04"/>
</appointments></PortalRoadSchedule></PortalRoads>`;

test('portal centimetres become km and metres', () => {
  const { roads } = parsePortalRoads(PR);
  const t = roads.find((r) => r.id === 10009);
  assert.ok(Math.abs(t.distanceKm - 4.5926) < 1e-3);
  assert.ok(Math.abs(t.elevationM - 207.42) < 0.01);
});

test('Zwift offsets without minutes parse', () => {
  // new Date('2026-09-10T00:01-04') is Invalid Date; '-04:00' is not.
  assert.ok(!Number.isNaN(parseZwiftDate('2026-09-10T00:01-04').getTime()));
  assert.equal(parsePortalRoads(PR).schedule.length, 2);
});

test('the open portal road is the last one scheduled before now', () => {
  const d = parsePortalRoads(PR);
  assert.equal(activePortalRoads(d, new Date('2026-09-11T12:00:00Z'))[0].name, 'Cote de Trebiac');
  assert.equal(activePortalRoads(d, new Date('2026-09-13T12:00:00Z'))[0].name, 'Alto de Patios');
  assert.equal(activePortalRoads(d, new Date('2026-01-01T00:00:00Z')).length, 0);
  assert.equal(nextPortalChange(d, new Date('2026-09-11T12:00:00Z')).roadId, 10052);
  assert.equal(nextPortalChange(d, new Date('2027-01-01T00:00:00Z')), null);
});
