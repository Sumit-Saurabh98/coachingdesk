import type { GenerationSummary } from './invoice-generator';

export interface ActiveInstitutesLookup {
  listActive(): Promise<Array<{ id: string }>>;
}
export interface DueBillingRunner {
  runDue(instituteId: string): Promise<GenerationSummary | null>;
}

export interface BillingRunSummary {
  institutes: number;
  billed: number; // institutes whose period was generated in this run
  invoicesCreated: number;
  failed: Array<{ instituteId: string; error: string }>;
}

/**
 * The worker's billing job (LLD §6.1 "daily scheduler"). Runs often (every 15 min): each run
 * bills only institutes whose current period isn't done yet, so a missed run, an outage or a
 * restart just means the next run catches up. One institute failing never blocks the others.
 */
export class BillingScheduler {
  constructor(
    private readonly institutes: ActiveInstitutesLookup,
    private readonly billing: DueBillingRunner,
  ) {}

  async runOnce(): Promise<BillingRunSummary> {
    const institutes = await this.institutes.listActive();
    const summary: BillingRunSummary = {
      institutes: institutes.length,
      billed: 0,
      invoicesCreated: 0,
      failed: [],
    };
    for (const { id } of institutes) {
      try {
        const result = await this.billing.runDue(id);
        if (result) {
          summary.billed += 1;
          summary.invoicesCreated += result.created;
        }
      } catch (error) {
        // The run stays "not completed", so the next pass retries this institute.
        summary.failed.push({ instituteId: id, error: String(error) });
      }
    }
    return summary;
  }
}
