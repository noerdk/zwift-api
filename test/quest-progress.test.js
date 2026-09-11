import { test } from 'node:test';
import assert from 'node:assert/strict';
import { goalXp, accumulatorProgress, routeXpIndex, eventSeriesXpIndex, portalRoadXpIndex, bestXp, isActive } from '../src/quest-progress.js';

const quest = {
  id: 'q1', name: 'Zwift Shorts', slug: 'zwiftshorts', isPublished: true,
  startDate: '2026-08-17T00:00:00Z', endDate: '2026-09-28T00:00:00Z',
  goals: [
    { completed: true, tasks: [{ completionRequirements: { type: 'ROUTE', routeId: 111 } }] },
    { completed: false, tasks: [{ completionRequirements: { type: 'ROUTE', routeId: 222 } }] },
    { completed: false, tasks: [{ completionRequirements: { type: 'EVENT', eventSeriesId: 13035 } }] },
  ],
  milestones: [
    { type: 'GOAL', goalsCount: 2, rewards: [{ rewardType: 'XP', experiencePoints: 250 }] },
    { type: 'GOAL', goalsCount: 3, rewards: [{ rewardType: 'XP', experiencePoints: 400 }] },
  ],
};

test('milestone XP is exact, not apportioned', () => {
  const g = goalXp(quest);
  assert.equal(g.completedGoals, 1);
  assert.equal(g.xpNow, 250, 'one more goal reaches the goalsCount=2 milestone only');
  assert.equal(g.xpRemaining, 650);
  assert.equal(goalXp(quest, 2).xpNow, 650);
});

test('indexes skip completed goals and key by the right id', () => {
  const routes = routeXpIndex([quest]);
  assert.ok(!routes.has(111), 'already completed');
  assert.equal(bestXp(routes.get(222)), 250);
  assert.equal(bestXp(eventSeriesXpIndex([quest]).get(13035)), 250);
  assert.equal(bestXp(undefined), 0);
});

test('Climb of the Week targets a portal road through an ACTION task', () => {
  const cotw = {
    ...quest, id: 'q2', goals: [{ completed: false, tasks: [{ completionRequirements: {
      type: 'ACTION', actionName: 'completed_climb_portal', properties: { portalRoadId: '10009', portalDifficulty: 'ANY' } } }] }],
    milestones: [{ type: 'GOAL', goalsCount: 1, rewards: [{ rewardType: 'XP', experiencePoints: 250 }] }],
  };
  const idx = portalRoadXpIndex([cotw]);
  assert.equal(bestXp(idx.get(10009)), 250, 'keyed by number, not the string from the payload');
  assert.equal(portalRoadXpIndex([quest]).size, 0, 'ROUTE tasks are not portal tasks');
});

test('accumulator reports the next unreached milestone', () => {
  const acc = accumulatorProgress({
    goals: [{ tasks: [{ taskCard: { type: 'DISTANCE', targetDistanceMeters: 1000000, totalDistanceMeters: 9536, indoorDistanceMeters: 9536, outdoorDistanceMeters: 0, completionRatio: 0.009536 } }] }],
    milestones: [
      { type: 'ACCUMULATOR', distance: 250000, rewards: [{ rewardType: 'DROPS', drops: 100000 }] },
      { type: 'ACCUMULATOR', distance: 750000, rewards: [{ rewardType: 'XP', experiencePoints: 5000 }] },
    ],
  });
  assert.equal(acc.currentKm, 9.536);
  assert.equal(acc.nextMilestoneKm, 250, 'not the 1000km end');
  assert.equal(acc.nextMilestoneXp, 0, 'that one pays drops');
  assert.equal(acc.xpRemaining, 5000);
});

test('date windows are respected', () => {
  assert.ok(isActive(quest, new Date('2026-09-10T00:00:00Z')));
  assert.ok(!isActive(quest, new Date('2026-10-01T00:00:00Z')));
  assert.ok(!isActive(quest, new Date('2026-08-01T00:00:00Z')));
  assert.ok(!isActive({ ...quest, isArchived: true }, new Date('2026-09-10T00:00:00Z')));
});
