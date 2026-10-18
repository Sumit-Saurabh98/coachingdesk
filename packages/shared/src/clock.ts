export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class FixedClock implements Clock {
  private currentMs: number;

  constructor(start: Date) {
    this.currentMs = start.getTime();
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  set(instant: Date): void {
    this.currentMs = instant.getTime();
  }

  advanceMinutes(minutes: number): void {
    this.currentMs += minutes * 60_000;
  }
}
