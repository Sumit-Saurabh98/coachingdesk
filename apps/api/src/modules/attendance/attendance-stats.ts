import type { AttendanceStatus } from '@coachingdesk/shared';

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  leave: number;
}

/**
 * Counts and the attendance percentage for a set of marks.
 *   attended   = present + late          (late still came to class)
 *   counted    = everything except leave (approved leave doesn't hurt the percentage)
 *   percentage = attended / counted, rounded to a whole number; null when nothing counts.
 */
export class AttendanceStats {
  private constructor(readonly counts: AttendanceCounts) {}

  static of(statuses: Iterable<AttendanceStatus>): AttendanceStats {
    const counts: AttendanceCounts = { present: 0, absent: 0, late: 0, leave: 0 };
    for (const status of statuses) {
      counts[status] += 1;
    }
    return new AttendanceStats(counts);
  }

  get percentage(): number | null {
    const { present, absent, late } = this.counts;
    const counted = present + absent + late;
    return counted === 0 ? null : Math.round(((present + late) / counted) * 100);
  }

  toJSON() {
    return { ...this.counts, percentage: this.percentage };
  }
}
