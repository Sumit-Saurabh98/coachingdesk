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

const poller = new Poller(
  async () => {
    const summary = await container.dispatcher.runOnce();
    if (summary.claimed > 0 || summary.released > 0) {
      log('info', 'outbox dispatched', { ...summary });
    }
  },
  config.OUTBOX_POLL_MS,
  (error) => log('error', 'outbox run failed', { error: String(error) }),
);

// Graceful shutdown, like server.ts: finish the current run, close the database, exit.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  log('info', 'worker shutting down', { signal });
  await poller.stop();
  await container.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

log('info', 'worker started', {
  pollMs: config.OUTBOX_POLL_MS,
  provider: config.WHATSAPP_PROVIDER,
});
poller.start();
