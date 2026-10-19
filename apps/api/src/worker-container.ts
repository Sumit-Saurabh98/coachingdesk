import { createDb } from '@coachingdesk/db';
import { ConsoleWhatsAppSender, type WhatsAppSender } from '@coachingdesk/providers';
import { SystemClock, UuidV7Generator } from '@coachingdesk/shared';
import { AbsenceRevalidator } from './modules/messaging/absence-revalidator';
import { OutboxDispatcher } from './modules/messaging/outbox-dispatcher';
import { createDomainServices } from './services';
import type { WorkerConfig } from './worker-config';

export interface WorkerContainer {
  dispatcher: OutboxDispatcher;
  close: () => Promise<void>;
}

/** The WORKER's composition root (the API has container.ts). No InMemory/Fake classes here. */
export function createWorkerContainer(config: WorkerConfig): WorkerContainer {
  assertSafeForProduction(config); // first, before connecting to anything

  const clock = new SystemClock();
  const ids = new UuidV7Generator(clock);
  const database = createDb(config.DATABASE_URL);
  const services = createDomainServices(database.db, clock, ids);

  const dispatcher = new OutboxDispatcher({
    outbox: services.outboxRepository,
    consents: services.consentRepository,
    sender: createWhatsAppSender(config),
    institutes: services.instituteService,
    // Per category: "is this message still true?" (LLD §6.3). More arrive with fees/results.
    revalidators: { absence: new AbsenceRevalidator(services.attendanceService) },
    clock,
  });

  return { dispatcher, close: () => database.close() };
}

function createWhatsAppSender(config: WorkerConfig): WhatsAppSender {
  switch (config.WHATSAPP_PROVIDER) {
    case 'console':
      return new ConsoleWhatsAppSender();
    case 'meta':
      throw new Error('MetaWhatsAppSender is not implemented yet');
  }
}

/** AGENTS.md: production must never run with dev/fake implementations. */
function assertSafeForProduction(config: WorkerConfig): void {
  if (config.NODE_ENV === 'production' && config.WHATSAPP_PROVIDER === 'console') {
    throw new Error('Refusing to start: WHATSAPP_PROVIDER=console is not allowed in production');
  }
}
