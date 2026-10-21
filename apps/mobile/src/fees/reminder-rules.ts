// Pure TypeScript: what to tell the owner after "Send reminder", unit-tested in Node.

/** Goes out now, or waits (quiet hours 21:00-08:00: the server schedules it for 08:00). */
export function reminderTiming(scheduledFor: string, now: Date): 'now' | 'later' {
  // A couple of minutes' slack: "now" means the worker picks it up on its next pass.
  return new Date(scheduledFor).getTime() - now.getTime() > 2 * 60_000 ? 'later' : 'now';
}

export type RemindRefusal = 'alreadyToday' | 'notInPlan' | 'nothingDue';

/** The refusals the screen explains in its own words (null: show the general error). */
export function remindRefusal(error: { code: string | null }): RemindRefusal | null {
  switch (error.code) {
    case 'ALREADY_REMINDED_TODAY':
      return 'alreadyToday'; // one fee reminder per parent per day (FR-5.2); owner may force one
    case 'FEATURE_NOT_IN_PLAN':
      return 'notInPlan'; // Free plan: no automatic WhatsApp, share by hand instead
    case 'NOTHING_DUE':
      return 'nothingDue';
    default:
      return null;
  }
}

/** wa.me link that opens a chat with this number and the text typed in (the owner taps Send). */
export function whatsAppMessageLink(e164: string, text: string): string {
  return `https://wa.me/${e164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}
