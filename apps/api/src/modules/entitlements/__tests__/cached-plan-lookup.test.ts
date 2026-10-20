import { describe, expect, it } from 'vitest';
import { FixedClock, type PlanId } from '@coachingdesk/shared';
import { CachedPlanLookup } from '../cached-plan-lookup';

function setup() {
  const clock = new FixedClock(new Date('2026-10-20T10:00:00Z'));
  const plans = new Map<string, PlanId>([['i1', 'pro']]);
  let queries = 0;
  const inner = {
    currentPlan: async (id: string) => plans.get(id) ?? 'free',
    state: async (id: string) => {
      queries += 1;
      return { plan: plans.get(id) ?? ('free' as PlanId), trialStartedAt: null, signedUpAt: null };
    },
  };
  const cache = new CachedPlanLookup(inner, clock, 30_000, 2);
  return { clock, plans, cache, queries: () => queries };
}

describe('CachedPlanLookup', () => {
  it('asks once per institute per 30 s', async () => {
    const { cache, queries, clock, plans } = setup();
    expect(await cache.currentPlan('i1')).toBe('pro');
    expect((await cache.state('i1')).plan).toBe('pro');
    expect(queries()).toBe(1);

    plans.set('i1', 'free'); // downgraded elsewhere
    clock.set(new Date('2026-10-20T10:00:29Z'));
    expect(await cache.currentPlan('i1')).toBe('pro'); // still within 30 s
    clock.set(new Date('2026-10-20T10:00:30Z'));
    expect(await cache.currentPlan('i1')).toBe('free');
    expect(queries()).toBe(2);
  });

  it('forget(): this process sees a change at once', async () => {
    const { cache, plans } = setup();
    await cache.currentPlan('i1');
    plans.set('i1', 'academy');
    cache.forget('i1');
    expect(await cache.currentPlan('i1')).toBe('academy');
  });

  it('never grows past maxEntries', async () => {
    const { cache, queries } = setup();
    await cache.currentPlan('a');
    await cache.currentPlan('b');
    await cache.currentPlan('c'); // full: cleared, then c stored
    await cache.currentPlan('c');
    expect(queries()).toBe(3);
    await cache.currentPlan('a'); // was dropped: asked again
    expect(queries()).toBe(4);
  });
});
