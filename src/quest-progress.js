// Helpers for reading progress out of a quest payload.
//
// Structure: quest -> goals -> tasks. A task completes on a ROUTE (`routeId`),
// an EVENT (`eventSeriesId`), a DISTANCE accumulator, or an in-game ACTION.
// Milestones pay out at a threshold — `goalsCount` goals for GOAL milestones,
// `distance` metres for ACCUMULATOR ones — so the XP unlocked by finishing one
// more goal is exact rather than apportioned.
const goalsOf = (q) => q.goals ?? [];
const tasksOf = (q) => goalsOf(q).flatMap((g) => g.tasks ?? []);
const xpOf = (m) => (m.rewards ?? []).reduce((s, r) => s + (r.experiencePoints ?? 0), 0);
const dropsOf = (m) => (m.rewards ?? []).reduce((s, r) => s + (r.drops ?? 0), 0);

export function isActive(quest, now = new Date()) {
  if (!quest.isPublished || quest.isArchived) return false;
  const t = now.getTime();
  if (quest.startDate && new Date(quest.startDate).getTime() > t) return false;
  if (quest.endDate && new Date(quest.endDate).getTime() < t) return false;
  return true;
}

/** XP unlocked by completing `extra` more goals, and XP still unclaimed. */
export function goalXp(quest, extra = 1) {
  const completed = goalsOf(quest).filter((g) => g.completed).length;
  const milestones = (quest.milestones ?? []).filter((m) => m.type === 'GOAL');
  return {
    completedGoals: completed,
    totalGoals: goalsOf(quest).length,
    xpNow: milestones.filter((m) => m.goalsCount > completed && m.goalsCount <= completed + extra).reduce((s, m) => s + xpOf(m), 0),
    xpRemaining: milestones.filter((m) => m.goalsCount > completed).reduce((s, m) => s + xpOf(m), 0),
  };
}

/** Live progress for a DISTANCE/ACCUMULATOR quest. */
export function accumulatorProgress(quest) {
  const card = tasksOf(quest).map((t) => t.taskCard).find((c) => c?.type === 'DISTANCE');
  if (!card) return null;
  const done = card.totalDistanceMeters ?? 0;
  const milestones = (quest.milestones ?? []).filter((m) => m.type === 'ACCUMULATOR');
  const next = milestones.filter((m) => (m.distance ?? 0) > done).sort((a, b) => a.distance - b.distance)[0] ?? null;
  return {
    currentKm: done / 1000,
    targetKm: (card.targetDistanceMeters ?? 0) / 1000,
    indoorKm: (card.indoorDistanceMeters ?? 0) / 1000,
    outdoorKm: (card.outdoorDistanceMeters ?? 0) / 1000,
    ratio: card.completionRatio ?? 0,
    nextMilestoneKm: next ? next.distance / 1000 : null,
    nextMilestoneXp: next ? xpOf(next) : 0,
    nextMilestoneDrops: next ? dropsOf(next) : 0,
    xpRemaining: milestones.filter((m) => (m.distance ?? 0) > done).reduce((s, m) => s + xpOf(m), 0),
  };
}

function index(quests, pick) {
  const out = new Map();
  for (const q of quests) {
    const g = goalXp(q);
    for (const goal of goalsOf(q)) {
      if (goal.completed) continue;
      for (const t of goal.tasks ?? []) {
        const key = pick(t.completionRequirements ?? {});
        if (key == null) continue;
        if (!out.has(key)) out.set(key, []);
        out.get(key).push({ questId: q.id, quest: q.name, slug: q.slug, endDate: q.endDate, ...g });
      }
    }
  }
  return out;
}

export const routeXpIndex = (quests) => index(quests, (cr) => (cr.type === 'ROUTE' && cr.routeId ? cr.routeId : null));
export const eventSeriesXpIndex = (quests) => index(quests, (cr) => (cr.type === 'EVENT' && cr.eventSeriesId ? cr.eventSeriesId : null));
export const portalRoadXpIndex = (quests) => index(quests, (cr) =>
  cr.type === 'ACTION' && cr.actionName === 'completed_climb_portal' && Number.isFinite(Number(cr.properties?.portalRoadId))
    ? Number(cr.properties.portalRoadId) : null);

/** Best immediately-claimable XP among index entries. */
export const bestXp = (entries) => (entries?.length ? Math.max(...entries.map((e) => e.xpNow)) : 0);

export function summarise(quests) {
  return quests.map((q) => ({
    id: q.id, name: q.name, slug: q.slug, endDate: q.endDate,
    registered: q.registered, completed: q.completed,
    ...goalXp(q),
    accumulator: accumulatorProgress(q),
    xpTotal: (q.milestones ?? []).reduce((s, m) => s + xpOf(m), 0),
    // Drops are Zwift's in-game currency (profile.totalDrops is the balance).
    // Quests pay them at milestones, same as XP.
    dropsTotal: (q.milestones ?? []).reduce((s, m) => s + dropsOf(m), 0),
    dropsRemaining: (q.milestones ?? []).filter((m) =>
      m.type === 'GOAL' ? m.goalsCount > goalsOf(q).filter((g) => g.completed).length
        : (m.distance ?? 0) > ((tasksOf(q).map((t) => t.taskCard).find((c) => c?.type === 'DISTANCE')?.totalDistanceMeters) ?? 0),
    ).reduce((s, m) => s + dropsOf(m), 0),
  }));
}
