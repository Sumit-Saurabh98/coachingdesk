import { Poller } from './lib/poller';
import { createWorkerContainer } from './worker-container';
import { loadWorkerConfig } from './worker-config';

// The worker process: sends what the API put in the outbox (AGENTS rule 4).
// Same code base as the API, separate process: `pnpm --filter @coachingdesk/api worker`.
const config = loadWorkerConfig(process.env);
const container = createWorkerContainer(config);

// One JSON line per event. Never phone numbers or message contents (AGENTS rule 9).
const log = (level: 'info' | 'error', msg: string, data: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, time: new Date().toISOString(), msg, ...data }));

/** A job threw: log it AND report it (Step 40), so someone finds out. */
const failed = (job: string) => (error: unknown) => {
  log('error', `${job} run failed`, { error: String(error) });
  container.errorReporter.capture(error, { job });
};

/** A run finished but some institutes failed inside it (each was caught so the rest went on). */
const reportPartial = (job: string, count: number) => {
  if (count > 0) {
    container.errorReporter.capture(new Error(`${job}: ${count} failed in one run`), { job });
  }
};

const poller = new Poller(
  async () => {
    const summary = await container.dispatcher.runOnce();
    if (summary.claimed > 0 || summary.released > 0) {
      log('info', 'outbox dispatched', { ...summary });
    }
  },
  config.OUTBOX_POLL_MS,
  failed('outbox'),
);

const billingPoller = new Poller(
  async () => {
    const summary = await container.billing.runOnce();
    if (summary.billed > 0 || summary.failed.length > 0) {
      log(summary.failed.length > 0 ? 'error' : 'info', 'billing run', { ...summary });
      reportPartial('billing', summary.failed.length);
    }
  },
  config.INVOICE_POLL_MS,
  failed('billing'),
);

const reminderPoller = new Poller(
  async () => {
    const summary = await container.reminders.runOnce();
    if (summary.queued > 0 || summary.failed.length > 0) {
      log(summary.failed.length > 0 ? 'error' : 'info', 'reminders planned', { ...summary });
      reportPartial('reminders', summary.failed.length);
    }
  },
  config.REMINDER_POLL_MS,
  failed('reminders'),
);

const exportPoller = new Poller(
  async () => {
    const summary = await container.exports.runOnce();
    if (summary.built + summary.retried + summary.failed + summary.expired > 0) {
      log(summary.failed > 0 ? 'error' : 'info', 'exports run', { ...summary });
      reportPartial('exports', summary.failed);
    }
  },
  config.EXPORT_POLL_MS,
  failed('exports'),
);

const purgePoller = new Poller(
  async () => {
    const summary = await container.purge.runOnce();
    if (summary.purged + summary.notDue + summary.failed > 0) {
      // Counts only: never the institute's name (it's in the DB tombstone if ever needed).
      log(summary.failed > 0 ? 'error' : 'info', 'purge run', { ...summary });
      reportPartial('purge', summary.failed);
    }
  },
  config.RETENTION_POLL_MS,
  failed('purge'),
);

// Graceful shutdown, like server.ts: finish the current runs, close the database, exit.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log('info', 'worker shutting down', { signal });
  await Promise.all([
    poller.stop(),
    billingPoller.stop(),
    reminderPoller.stop(),
    exportPoller.stop(),
    purgePoller.stop(),
  ]);
  await container.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

// A crash nothing else caught: report it, give the report 2 s to leave, then exit so the
// platform restarts the worker (staying up in an unknown state is worse).
async function crash(error: unknown): Promise<void> {
  log('error', 'worker crashed', { error: String(error) });
  container.errorReporter.capture(error, { job: 'process' });
  await container.errorReporter.flush(2000);
  process.exit(1);
}
process.on('uncaughtException', (error) => void crash(error));
process.on('unhandledRejection', (reason) => void crash(reason));

log('info', 'worker started', {
  outboxPollMs: config.OUTBOX_POLL_MS,
  invoicePollMs: config.INVOICE_POLL_MS,
  reminderPollMs: config.REMINDER_POLL_MS,
  exportPollMs: config.EXPORT_POLL_MS,
  retentionPollMs: config.RETENTION_POLL_MS,
  provider: config.WHATSAPP_PROVIDER,
});
poller.start();
billingPoller.start();
reminderPoller.start();
exportPoller.start();
purgePoller.start();
