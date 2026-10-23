// Pure TypeScript (unit-tested in Node): where the website's legal and help pages are.

/** The public website (apps/web). Builds can point elsewhere with EXPO_PUBLIC_WEB_URL. */
const DEFAULT_WEB_URL = 'https://coachingdesk.in';

export function webBaseUrl(): string {
  return (process.env.EXPO_PUBLIC_WEB_URL ?? DEFAULT_WEB_URL).replace(/\/+$/, '');
}

export type LegalPage = 'privacy' | 'terms' | 'delete-account' | 'contact';

/** The page in the app's language: English at "/privacy", Hindi at "/hi/privacy". */
export function legalPageUrl(page: LegalPage, language: string, base = webBaseUrl()): string {
  return `${base}${language === 'hi' ? '/hi' : ''}/${page}`;
}
