import type { Clock } from './clock';
import { LocalDate } from './local-date';

export class InstituteClock {
  constructor(
    private readonly clock: Clock,
    private readonly timeZone: string,
  ) {}

  today(): LocalDate {
    return LocalDate.fromInstant(this.clock.now(), this.timeZone);
  }

  minutesSinceMidnight(): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.timeZone,
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    }).formatToParts(this.clock.now());
    const part = (type: 'hour' | 'minute') => Number(parts.find((p) => p.type === type)?.value);
    return part('hour') * 60 + part('minute');
  }
}
