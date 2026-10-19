/**
 * Runs `task` again and again, `intervalMs` apart (measured from the END of a run, so runs
 * never overlap). stop() waits for the run in progress to finish: a deploy never cuts a
 * message off halfway between "sent" and "marked sent".
 */
export class Poller {
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private current: Promise<void> | null = null;

  constructor(
    private readonly task: () => Promise<void>,
    private readonly intervalMs: number,
    private readonly onError: (error: unknown) => void,
  ) {}

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.current; // let the run in progress finish
  }

  private schedule(delayMs: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.current = this.runOnce().finally(() => {
        this.current = null;
        if (this.running) {
          this.schedule(this.intervalMs);
        }
      });
    }, delayMs);
  }

  private async runOnce(): Promise<void> {
    try {
      await this.task();
    } catch (error) {
      // One failed run (e.g. the database restarting) must not kill the worker: log, go on.
      this.onError(error);
    }
  }
}
