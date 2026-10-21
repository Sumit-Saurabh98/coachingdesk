// Teaches TypeScript our translation keys: t('common.retry') is checked and autocompleted;
// a typo like t('common.rtery') is a compile error instead of an empty label on screen.
import type { Translations } from '@coachingdesk/i18n';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Translations };
  }
}
