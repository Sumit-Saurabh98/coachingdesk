// Pure TypeScript (unit-tested in Node): where the website's legal and help pages are.

/** The public website (apps/web). Builds can point elsewhere with EXPO_PUBLIC_WEB_URL. */
const DEFAULT_WEB_URL = 'https://coachingdesk.in';

export function webBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_WEB_URL ?? DEFAULT_WEB_URL).replace(/\/+$/, '');
}

export type LegalPage = 'privacy' | 'terms' | 'delete-account' | 'contact';

/** Where users write for help (the website's contact page shows the same address). */
const DEFAULT_SUPPORT_EMAIL = 'support@coachingdesk.in';

export function supportEmail(): string {
  return process.env.EXPO_PUBLIC_SUPPORT_EMAIL ?? DEFAULT_SUPPORT_EMAIL;
}

/**
 * A ready-to-send email to support. The app version and phone type help us answer; nothing
 * personal is added (the user can write what they want to share).
 */
export function supportMailto(subject: string, appVersion: string, platform: string): string {
  const body = `\n\n---\nCoaching Desk ${appVersion} (${platform})`;
  return `mailto:${supportEmail()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** The page in the app's language: English at "/privacy", Hindi at "/hi/privacy". */
export function legalPageUrl(page: LegalPage, language: string, base = webBaseUrl()): string {
  return `${base}${language === 'hi' ? '/hi' : ''}/${page}`;
}
