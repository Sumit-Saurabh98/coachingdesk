import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import { type LegalPage, legalPageUrl, supportMailto } from './legal-links';

/** Opens a website page in an in-app browser tab: closing it returns to where the user was. */
export function openLegalPage(page: LegalPage, language: string): void {
  void WebBrowser.openBrowserAsync(legalPageUrl(page, language));
}

/** Opens an email to support; a phone with no email app gets the website's contact page. */
export function openSupportEmail(
  subject: string,
  appVersion: string,
  platform: string,
  language: string,
): void {
  Linking.openURL(supportMailto(subject, appVersion, platform)).catch(() =>
    openLegalPage('contact', language),
  );
}
