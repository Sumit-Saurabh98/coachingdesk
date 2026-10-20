// Pure TypeScript: unit-tested in Node. The WORDS come in as `labels` (from the translation
// files), so this file only decides the ARRANGEMENT and stays language-neutral.

export interface ScheduleLabels {
  /** Short weekday names, Monday first (ISO 1..7). */
  weekdays: readonly [string, string, string, string, string, string, string];
  everyDay: string;
  am: string;
  pm: string;
}

/**
 * ISO weekdays -> how people say them:
 *   [1,3,5]         -> "Mon, Wed, Fri"
 *   [1,2,3,4,5,6]   -> "Mon–Sat"        (3+ days in a row become a range)
 *   [1,2,3,5]       -> "Mon–Wed, Fri"
 *   [1..7]          -> "Every day"
 */
export function formatDays(days: readonly number[], labels: ScheduleLabels): string {
  const sorted = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (sorted.length === 7) {
    return labels.everyDay;
  }
  const name = (day: number) => labels.weekdays[day - 1] ?? '';
  const parts: string[] = [];
  let runStart = 0;
  for (let i = 1; i <= sorted.length; i++) {
    // A run ends at the last day, or where the next day isn't the day after.
    const runEnds = i === sorted.length || sorted[i] !== (sorted[i - 1] ?? 0) + 1;
    if (!runEnds) {
      continue;
    }
    const run = sorted.slice(runStart, i);
    const first = run[0];
    const last = run[run.length - 1];
    if (first !== undefined && last !== undefined) {
      parts.push(run.length >= 3 ? `${name(first)}–${name(last)}` : run.map(name).join(', '));
    }
    runStart = i;
  }
  return parts.join(', ');
}

/** "17:00" -> "5:00 PM"; "09:30" -> "9:30 AM"; "00:15" -> "12:15 AM". */
export function formatTime(hhmm: string, labels: ScheduleLabels): string {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${h < 12 ? labels.am : labels.pm}`;
}

/** "Mon, Wed, Fri · 5:00 PM – 6:00 PM" */
export function formatSchedule(
  schedule: { days: readonly number[]; start: string; end: string },
  labels: ScheduleLabels,
): string {
  return `${formatDays(schedule.days, labels)} · ${formatTime(schedule.start, labels)} – ${formatTime(schedule.end, labels)}`;
}
