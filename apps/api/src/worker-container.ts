import { createDb } from '@coachingdesk/db';
import { ConsoleWhatsAppSender, type WhatsAppSender } from '@coachingdesk/providers';
import { SystemClock, UuidV7Generator } from '@coachingdesk/shared';
import { BillingScheduler } from './modules/fees/billing-scheduler';
import { AbsenceRevalidator } from './modules/messaging/absence-revalidator';
import { FeeReminderRenderer } from './modules/messaging/fee-reminder-renderer';
import { ReminderPlanner, ReminderScheduler } from './modules/messaging/reminder-planner';
import { OutboxDispatcher } from './modules/messaging/outbox-dispatcher';
import { createDomainServices } from './services';
import type { WorkerConfig } from './worker-config';

export interface WorkerContainer {
  dispatcher: OutboxDispatcher;
  billing: BillingScheduler;
  reminders: ReminderScheduler;
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
    revalidators: {
      absence: new AbsenceRevalidator(services.attendanceService),
      fee_reminder: new FeeReminderRenderer(
        services.studentService,
        services.invoiceService,
        services.instituteService,
      ),
    },
    clock,
  });

  const billing = new BillingScheduler(services.instituteService, services.invoiceGenerator);

  const reminders = new ReminderScheduler(
    services.instituteService,
    new ReminderPlanner({
      outbox: services.outboxRepository,
      institutes: services.instituteService,
      entitlements: services.entitlements,
      invoices: services.invoiceService,
      students: services.studentService,
      ids,
      clock,
    }),
  );

  return { dispatcher, billing, reminders, close: () => database.close() };
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
