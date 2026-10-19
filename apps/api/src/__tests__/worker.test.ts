import { afterEach, describe, expect, it, vi } from 'vitest';
import { Poller } from '../lib/poller';
import { createWorkerContainer } from '../worker-container';
import { loadWorkerConfig } from '../worker-config';

const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' };

describe('loadWorkerConfig', () => {
  it('needs only the database; console sender and 5 s polling by default', () => {
    expect(loadWorkerConfig(base)).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: base.DATABASE_URL,
      WHATSAPP_PROVIDER: 'console',
      OUTBOX_POLL_MS: 5000,
    });
  });

  it('rejects a missing database URL and a silly poll interval', () => {
    expect(() => loadWorkerConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadWorkerConfig({ ...base, OUTBOX_POLL_MS: '10' })).toThrow(/OUTBOX_POLL_MS/);
  });
});

describe('createWorkerContainer', () => {
  it('refuses the console WhatsApp sender in production', () => {
    const config = loadWorkerConfig({ ...base, NODE_ENV: 'production' });
    expect(() => createWorkerContainer(config)).toThrow(/not allowed in production/);
  });
});

describe('Poller', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs at once, then every interval, never overlapping', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const poller = new Poller(
      async () => void runs++,
      1000,
      () => {},
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(runs).toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(runs).toBe(2);
    await poller.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(2); // stopped: no more runs
  });

  it('a failing run is reported and the poller keeps going', async () => {
    vi.useFakeTimers();
    const errors: unknown[] = [];
    let runs = 0;
    const poller = new Poller(
      async () => {
        runs++;
        if (runs === 1) throw new Error('db restarting');
      },
      1000,
      (error) => errors.push(error),
    );

    poller.start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(errors).toHaveLength(1);
    expect(runs).toBe(2);
    await poller.stop();
  });

  it('stop() waits for the run in progress', async () => {
    vi.useFakeTimers();
    let finished = false;
    const poller = new Poller(
      () => new Promise<void>((resolve) => setTimeout(() => ((finished = true), resolve()), 500)),
      1000,
      () => {},
    );
    poller.start();
    await vi.advanceTimersByTimeAsync(0); // the run has started, not finished

    const stopping = poller.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopping;

    expect(finished).toBe(true);
  });
});
