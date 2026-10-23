import type { ErrorEvent } from '@sentry/node';
import { describe, expect, it } from 'vitest';
import { NoopErrorReporter, RecordingErrorReporter } from '../error-reporter';
import { scrubEvent } from '../sentry-error-reporter';

describe('scrubEvent (what leaves the server for Sentry)', () => {
  it('drops the request and masks phone numbers everywhere text can hide', () => {
    const event = {
      type: undefined,
      message: 'send to 9812345678 failed',
      request: { url: '/v1/x/guardians/9812345678', headers: { authorization: 'Bearer t' } },
      exception: { values: [{ type: 'Error', value: 'no consent for +919812345678' }] },
      extra: { to: '9812345678', count: 3 },
    } as ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.request).toBeUndefined();
    expect(scrubbed.message).toBe('send to 98XXXXX678 failed');
    expect(scrubbed.exception?.values?.[0]?.value).toBe('no consent for +9198XXXXX678');
    expect(scrubbed.extra).toEqual({ to: '98XXXXX678', count: 3 });
  });

  it('leaves ids and amounts alone (only phone-shaped numbers are masked)', () => {
    const event = {
      type: undefined,
      message: 'invoice 01900000-0000-7000-8000-000000000001 for 150000 paise',
    } as ErrorEvent;
    expect(scrubEvent(event).message).toBe(
      'invoice 01900000-0000-7000-8000-000000000001 for 150000 paise',
    );
  });
});

describe('the reporters without Sentry', () => {
  it('Noop never throws; Recording remembers what was reported', async () => {
    new NoopErrorReporter().capture(new Error('x'), { job: 'outbox' });
    await new NoopErrorReporter().flush(10);

    const recording = new RecordingErrorReporter();
    recording.capture(new Error('boom'), { job: 'billing' });
    expect(recording.captured).toHaveLength(1);
    expect(recording.captured[0]?.context).toEqual({ job: 'billing' });
  });
});
