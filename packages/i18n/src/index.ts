// The app's texts in every supported language (AGENTS rule 10: no hard-coded user-facing
// strings; every key in BOTH en.json and hi.json, which the test below enforces).
import en from './locales/en.json';
import hi from './locales/hi.json';

export const LANGUAGES = ['en', 'hi'] as const;
export type Language = (typeof LANGUAGES)[number];

// A language's name is always shown IN that language ("हिंदी", not "Hindi"), so a user who
// can't read the current language can still find their own.
export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', hi: 'हिंदी' };

// The shape i18next expects: language -> namespace ("translation") -> texts.
export const resources = {
  en: { translation: en },
  hi: { translation: hi },
} as const;

// The TYPE of the English texts. The app uses it so that t('preview.typo') is a compile
// error instead of an empty label on screen.
export type Translations = typeof en;
