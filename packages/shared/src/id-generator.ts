import { v7 as uuidv7 } from 'uuid';
import type { Clock } from './clock';

/** Where new IDs come from. Injected like Clock, so tests get predictable IDs. */
export interface IdGenerator {
  next(): string;
}

/**
 * Production: UUID v7 (docs/LLD.md §1). The first 48 bits are the timestamp, so IDs created
 * later sort later. Postgres indexes stay compact, and "newest first" is just ORDER BY id.
 */
export class UuidV7Generator implements IdGenerator {
  constructor(private readonly clock: Clock) {}

  next(): string {
    return uuidv7({ msecs: this.clock.now().getTime() });
  }
}

/** Tests: readable, predictable IDs (…-000000000001, …-000000000002, …). Still valid UUIDs. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  next(): string {
    this.counter += 1;
    return `00000000-0000-7000-8000-${String(this.counter).padStart(12, '0')}`;
  }
}
