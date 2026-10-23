import { buildApp } from './app';
import { loadConfig } from './config';
import { createContainer } from './container';

// Order matters: validate config -> wire dependencies -> build app -> listen.
const config = loadConfig(process.env);
const container = createContainer(config);
const app = buildApp(container, { logger: true, trustProxy: config.TRUST_PROXY });

// Graceful shutdown: on deploy, the server gets SIGTERM. Finish in-flight requests,
// close Redis cleanly, THEN exit, so no user request is cut off mid-way.
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  // A second signal (tsx watch + terminal both send one) must not close things twice.
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await container.close();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT')); // Ctrl+C

// A crash nothing else caught (Step 40): report it, give the report 2 s to leave, then exit so
// the platform restarts the server (staying up in an unknown state is worse).
async function crash(error: unknown): Promise<void> {
  app.log.fatal({ err: error }, 'server crashed');
  container.errorReporter.capture(error, { route: 'process' });
  await container.errorReporter.flush(2000);
  process.exit(1);
}
process.on('uncaughtException', (error) => void crash(error));
process.on('unhandledRejection', (reason) => void crash(reason));

// Top-level await works because the package is an ES module ("type": "module").
await app.listen({ host: config.HOST, port: config.PORT });
