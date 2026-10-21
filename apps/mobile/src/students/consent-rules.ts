// Pure TypeScript: what the profile says about a parent's WhatsApp consent, unit-tested in Node.

export type ConsentStatus = 'unknown' | 'opted_in' | 'opted_out';

export interface ConsentView {
  /** The switch: on only with a recorded "yes" (consent is never assumed, KB "Messaging"). */
  on: boolean;
  /** The line under it (an i18n key). */
  note: 'consent.stoppedEverywhere' | 'consent.on' | 'consent.off' | 'consent.unknown';
}

export function consentView(status: ConsentStatus, stoppedEverywhere: boolean): ConsentView {
  const on = status === 'opted_in';
  // A STOP reply beats this institute's "yes": nothing automatic goes out until START.
  if (stoppedEverywhere) {
    return { on, note: 'consent.stoppedEverywhere' };
  }
  return {
    on,
    note: on ? 'consent.on' : status === 'opted_out' ? 'consent.off' : 'consent.unknown',
  };
}
