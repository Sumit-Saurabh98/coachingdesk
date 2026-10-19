import type { Clock, IdGenerator } from '@coachingdesk/shared';
import type { AuditEntry, AuditRepository } from './audit.repository';

export interface AuditEvent {
  instituteId: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  /** Statuses, amounts, ids ONLY. Never names, phones or notes (AGENTS rule 9, erasure). */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

/**
 * The public face of the audit module. Other modules call record() AFTER their change
 * succeeded. Small interface on purpose: modules depend on `AuditRecorder`, not on this class.
 */
export interface AuditRecorder {
  record(event: AuditEvent): Promise<void>;
}

export class AuditLog implements AuditRecorder {
  constructor(
    private readonly repository: AuditRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async record(event: AuditEvent): Promise<void> {
    await this.repository.record({
      id: this.ids.next(),
      instituteId: event.instituteId,
      actorUserId: event.actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: event.before ?? null,
      after: event.after ?? null,
      createdAt: this.clock.now(),
    });
  }

  async list(instituteId: string, limit: number, beforeId?: string): Promise<AuditEntry[]> {
    return this.repository.list(instituteId, { limit, beforeId });
  }
}

/** For tests and wiring where nothing should be recorded. */
export const NO_AUDIT: AuditRecorder = { record: async () => undefined };
