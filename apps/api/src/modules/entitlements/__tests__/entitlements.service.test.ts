import { describe, expect, it } from 'vitest';
import { FixedClock } from '@coachingdesk/shared';
import { InMemorySubscriptionRepository } from '../../subscriptions/subscription.repository';
import { SubscriptionService } from '../../subscriptions/subscription.service';
import { EntitlementsService, planLimitReached } from '../entitlements.service';

function setup() {
  const clock = new FixedClock(new Date('2026-10-19T10:00:00Z'));
  const subscriptions = new InMemorySubscriptionRepository();
  const entitlements = new EntitlementsService(new SubscriptionService(subscriptions, clock));
  const trial = (endsAt: string) =>
    subscriptions.put({
      instituteId: 'inst-1',
      plan: 'pro',
      status: 'trialing',
      currentPeriodEnd: new Date(endsAt),
      graceUntil: null,
    });
  return { entitlements, trial, clock, subscriptions };
}

describe('EntitlementsService', () => {
  it('during the trial: Pro limits', async () => {
    const { entitlements, trial } = setup();
    trial('2026-11-18T10:00:00Z');

    const result = await entitlements.get('inst-1');

    expect(result).toMatchObject({ plan: 'pro', maxActiveStudents: 300, maxMembers: 5 });
    expect(result.features.has('result_cards')).toBe(true);
    expect(await entitlements.limitFor('inst-1', 'activeStudents')).toBe(300);
  });

  it('the moment the trial ends: Free limits, no job needed', async () => {
    const { entitlements, trial, clock } = setup();
    trial('2026-10-19T10:30:00Z');
    expect(await entitlements.limitFor('inst-1', 'activeStudents')).toBe(300);

    clock.advanceMinutes(30);

    expect(await entitlements.limitFor('inst-1', 'activeStudents')).toBe(25);
    expect(await entitlements.limitFor('inst-1', 'members')).toBe(0);
  });

  it('assertFeature: 402 FEATURE_NOT_IN_PLAN when the plan lacks it', async () => {
    const { entitlements } = setup(); // no subscription row -> free
    await expect(entitlements.assertFeature('inst-1', 'automatic_messages')).rejects.toMatchObject({
      code: 'FEATURE_NOT_IN_PLAN',
      details: { feature: 'automatic_messages' },
    });
  });

  it('assertFeature passes when the plan has it', async () => {
    const { entitlements, trial } = setup();
    trial('2026-11-18T10:00:00Z');
    await expect(entitlements.assertFeature('inst-1', 'result_cards')).resolves.toBeUndefined();
  });

  it('messagingLimits: trial = Pro quota, 100/day, 200 total since the trial began', async () => {
    const { entitlements, trial } = setup();
    trial('2026-11-18T10:00:00Z');

    const limits = await entitlements.messagingLimits('inst-1', new Date('2026-10-19T10:00:00Z'));

    expect(limits).toEqual({
      monthly: 3000,
      daily: 100,
      trialTotal: { limit: 200, since: new Date('2026-10-19T10:00:00Z') },
    });
  });

  it('messagingLimits: a paid plan has only its monthly quota; Free has 0', async () => {
    const { entitlements, subscriptions } = setup();
    subscriptions.put({
      instituteId: 'inst-1',
      plan: 'starter',
      status: 'active',
      currentPeriodEnd: new Date('2026-11-30T00:00:00Z'),
      graceUntil: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(await entitlements.messagingLimits('inst-1', new Date('2026-10-19T10:00:00Z'))).toEqual({
      monthly: 1000,
      daily: null,
      trialTotal: null,
    });
    expect((await entitlements.messagingLimits('other', new Date())).monthly).toBe(0);
  });

  it('messagingLimits: a paid institute in its first 7 days is capped at 100/day', async () => {
    const { entitlements, subscriptions } = setup();
    subscriptions.put({
      instituteId: 'inst-1',
      plan: 'academy',
      status: 'active',
      currentPeriodEnd: new Date('2026-11-30T00:00:00Z'),
      graceUntil: null,
      createdAt: new Date('2026-10-15T00:00:00Z'),
    });
    expect(
      (await entitlements.messagingLimits('inst-1', new Date('2026-10-19T10:00:00Z'))).daily,
    ).toBe(100);
    expect(
      (await entitlements.messagingLimits('inst-1', new Date('2026-10-23T00:00:00Z'))).daily,
    ).toBeNull();
  });

  it('planLimitReached: the documented 402 shape', () => {
    expect(planLimitReached('activeStudents', 25)).toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      message: 'Student limit reached for your plan',
      details: { limit: 25 },
    });
  });
});
