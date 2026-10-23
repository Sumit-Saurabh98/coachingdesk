import { createErrorReporter } from './lib/create-error-reporter';
import type { ErrorReporter } from '@coachingdesk/providers';
import { createDb } from '@coachingdesk/db';
import { ConsoleWhatsAppSender, type WhatsAppSender } from '@coachingdesk/providers';
import { SystemClock, UuidV7Generator } from '@coachingdesk/shared';
import { BillingScheduler } from './modules/fees/billing-scheduler';
import { AbsenceRevalidator } from './modules/messaging/absence-revalidator';
import { ReceiptRenderer } from './modules/messaging/receipt-renderer';
import { ResultRevalidator } from './modules/messaging/result-revalidator';
import { FeeReminderRenderer } from './modules/messaging/fee-reminder-renderer';
import { ReminderPlanner, ReminderScheduler } from './modules/messaging/reminder-planner';
import { OutboxDispatcher } from './modules/messaging/outbox-dispatcher';
import { createFileStore } from './file-store-config';
import { DrizzleDataExportRepository } from './modules/privacy/drizzle-data-export.repository';
import { DrizzleTenantDataRepository } from './modules/privacy/drizzle-tenant-data.repository';
import { ExportProcessor } from './modules/privacy/export-processor';
import { PurgeJob } from './modules/privacy/purge-job';
import { createDomainServices } from './services';
import type { WorkerConfig } from './worker-config';

export interface WorkerContainer {
  dispatcher: OutboxDispatcher;
  billing: BillingScheduler;
  reminders: ReminderScheduler;
  exports: ExportProcessor;
  purge: PurgeJob;
  errorReporter: ErrorReporter;
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
    // Per category: "is this message still true?" (LLD §6.3). Receipts arrive with payments.
    revalidators: {
      absence: new AbsenceRevalidator(services.attendanceService),
      result: new ResultRevalidator(services.testService),
      receipt: new ReceiptRenderer(services.paymentService),
      fee_reminder: new FeeReminderRenderer(
        services.studentService,
        services.invoiceService,
        services.instituteService,
      ),
    },
    quota: services.messageQuota,
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

  const files = createFileStore(config);
  const tenantData = new DrizzleTenantDataRepository(database.db);
  const exports = new ExportProcessor({
    exports: new DrizzleDataExportRepository(database.db),
    source: tenantData,
    files,
    clock,
  });
  const purge = new PurgeJob({ tenantData, files, clock });

  const errorReporter = createErrorReporter(config, 'worker');
  return {
    dispatcher,
    billing,
    reminders,
    exports,
    purge,
    errorReporter,
    close: async () => {
      await database.close();
      await errorReporter.flush(2000);
    },
  };
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
