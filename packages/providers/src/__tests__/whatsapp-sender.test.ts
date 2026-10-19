import { describe, expect, it } from 'vitest';
import { PhoneNumber } from '@coachingdesk/shared';
import { ConsoleWhatsAppSender, FakeWhatsAppSender, WhatsAppSendError } from '../index';

const message = {
  to: PhoneNumber.parse('9876543210'),
  template: 'absence_alert',
  locale: 'en' as const,
  params: { student: 'Aarav', date: '19 Oct', batch: 'Maths', institute: 'Sharma Classes' },
};

describe('FakeWhatsAppSender', () => {
  it('records what was sent and returns a provider id', async () => {
    const sender = new FakeWhatsAppSender();
    expect(await sender.sendTemplate(message)).toEqual({ providerMessageId: 'fake-wamid-1' });
    expect(sender.sent).toEqual([message]);
  });

  it('can be told to fail the next sends, in order', async () => {
    const sender = new FakeWhatsAppSender();
    sender.failNext(
      new WhatsAppSendError('timeout', true),
      new WhatsAppSendError('bad number', false),
    );

    await expect(sender.sendTemplate(message)).rejects.toMatchObject({ retryable: true });
    await expect(sender.sendTemplate(message)).rejects.toMatchObject({ retryable: false });
    await expect(sender.sendTemplate(message)).resolves.toBeDefined();
  });
});

describe('ConsoleWhatsAppSender', () => {
  it('prints the template with the phone MASKED', async () => {
    const lines: string[] = [];
    await new ConsoleWhatsAppSender((line) => lines.push(line)).sendTemplate(message);
    expect(lines[0]).toContain('absence_alert');
    expect(lines[0]).toContain('+9198XXXXX210');
    expect(lines[0]).not.toContain('9876543210');
  });
});
