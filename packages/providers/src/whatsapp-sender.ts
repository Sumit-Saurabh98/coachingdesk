import type { PhoneNumber } from '@coachingdesk/shared';

export interface TemplateMessage {
  to: PhoneNumber;
  template: string; // an approved Meta template name, e.g. 'absence_alert'
  locale: 'en' | 'hi';
  params: Record<string, string>;
}

/**
 * Sends approved WhatsApp templates. Only the worker calls this (AGENTS rule 4); API code
 * writes to the outbox instead. The Meta Cloud API implementation comes once the number exists.
 */
export interface WhatsAppSender {
  sendTemplate(message: TemplateMessage): Promise<{ providerMessageId: string }>;
}

/**
 * A failed send. `retryable` decides what the worker does: try again later (timeouts, 5xx,
 * rate limits) or give up (invalid number, template rejected).
 */
export class WhatsAppSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: string = 'UNKNOWN',
  ) {
    super(message);
    this.name = 'WhatsAppSendError';
  }
}

/** Records messages instead of sending. Tests can make the next sends fail. */
export class FakeWhatsAppSender implements WhatsAppSender {
  readonly sent: TemplateMessage[] = [];
  private readonly failures: WhatsAppSendError[] = [];
  private counter = 0;

  async sendTemplate(message: TemplateMessage): Promise<{ providerMessageId: string }> {
    const failure = this.failures.shift();
    if (failure) {
      throw failure;
    }
    this.sent.push(message);
    this.counter += 1;
    return { providerMessageId: `fake-wamid-${this.counter}` };
  }

  /** Test helper: the next send(s) throw this error, in order. */
  failNext(...errors: WhatsAppSendError[]): void {
    this.failures.push(...errors);
  }
}

/**
 * Local dev only: prints the message instead of sending it (phone MASKED in the log).
 * The worker's composition root refuses it in production.
 */
export class ConsoleWhatsAppSender implements WhatsAppSender {
  private counter = 0;

  constructor(private readonly print: (line: string) => void = console.log) {}

  async sendTemplate(message: TemplateMessage): Promise<{ providerMessageId: string }> {
    this.counter += 1;
    this.print(
      `[dev whatsapp] ${message.template} (${message.locale}) to ${message.to}: ${JSON.stringify(message.params)}`,
    );
    return { providerMessageId: `console-wamid-${Date.now()}-${this.counter}` };
  }
}
