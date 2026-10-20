// Sets up i18next for the app. Imported ONCE, by the root layout, before any screen is drawn.
import { type Language, resources } from '@coachingdesk/i18n';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { type LanguagePreference, usePreferences } from '@/stores/preferences';

/** 'system' = the phone's language if we have it (Hindi), else English. */
export function resolveLanguage(preference: LanguagePreference): Language {
  if (preference !== 'system') {
    return preference;
  }
  // getLocales()[0] is the phone's first preferred language, e.g. { languageCode: 'hi', ... }.
  return getLocales()[0]?.languageCode === 'hi' ? 'hi' : 'en';
}

void i18n.use(initReactI18next).init({
  resources,
  // The SAVED choice, read synchronously (MMKV, 26e): the first screen is already in the
  // right language. usePreferences.getState() reads the store outside a component.
  lng: resolveLanguage(usePreferences.getState().language),
  fallbackLng: 'en', // a key missing in Hindi shows the English text, never nothing
  initAsync: false, // our texts are bundled: no reason to wait, be ready immediately
  interpolation: { escapeValue: false }, // React already escapes text; don't do it twice
});

export default i18n;
