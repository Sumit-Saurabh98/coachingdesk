import { z } from 'zod';

// The worker needs much less than the API: no HTTP, no JWT/OTP secrets, no Redis (yet).
// Same rule as config.ts: a missing or malformed variable stops the process at startup.
const WorkerConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  // 'console' prints messages (local dev). 'meta' = WhatsApp Cloud API, once the number exists.
  WHATSAPP_PROVIDER: z.enum(['console', 'meta']).default('console'),
  // How often the worker looks for due messages. LLD §7: "outbox poller (every 30 s)" in
  // production; shorter locally so you see messages quickly.
  OUTBOX_POLL_MS: z.coerce.number().int().min(500).default(5000),
  // How often the billing job checks "has every institute's current period been billed?".
  // Cheap when there is nothing to do; catches up after any outage (LLD §6.1).
  INVOICE_POLL_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .default(15 * 60_000),
});

export type WorkerConfig = z.infer<typeof WorkerConfigSchema>;

export function loadWorkerConfig(env: Record<string, string | undefined>): WorkerConfig {
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ''));
  const result = WorkerConfigSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Invalid worker configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
