import type { Clock, PlanId } from '@coachingdesk/shared';
import type { CurrentPlanLookup } from './entitlements.service';

type PlanState = Awaited<ReturnType<CurrentPlanLookup['state']>>;

/**
 * A short-lived cache in front of the subscription lookup (decorator: same interface, so
 * EntitlementsService doesn't know it's there). Every guarded request and every message the
 * worker sends asks "which plan?"; this turns hundreds of identical queries a minute into one.
 *
 * Per process, so a plan change reaches OTHER API instances within `ttlMs` (30 s): fine for
 * plan limits, which nobody notices to the second. Expired entries are dropped on read, and
 * the map is capped so a crawler can't grow it without bound.
 */
export class CachedPlanLookup implements CurrentPlanLookup {
  private readonly entries = new Map<string, { state: PlanState; expiresAtMs: number }>();

  constructor(
    private readonly inner: CurrentPlanLookup,
    private readonly clock: Clock,
    private readonly ttlMs = 30_000,
    private readonly maxEntries = 10_000,
  ) {}

  async currentPlan(instituteId: string): Promise<PlanId> {
    return (await this.state(instituteId)).plan;
  }

  async state(instituteId: string): Promise<PlanState> {
    const nowMs = this.clock.now().getTime();
    const cached = this.entries.get(instituteId);
    if (cached && cached.expiresAtMs > nowMs) {
      return cached.state;
    }
    const state = await this.inner.state(instituteId);
    if (this.entries.size >= this.maxEntries) {
      this.entries.clear(); // simplest bound; a refill costs one query per institute
    }
    this.entries.set(instituteId, { state, expiresAtMs: nowMs + this.ttlMs });
    return state;
  }

  /** After a plan change in THIS process: the next question gets the fresh answer at once. */
  forget(instituteId: string): void {
    this.entries.delete(instituteId);
  }
}
