import * as WebBrowser from 'expo-web-browser';
import { type LegalPage, legalPageUrl } from './legal-links';

/** Opens a website page in an in-app browser tab: closing it returns to where the user was. */
export function openLegalPage(page: LegalPage, language: string): void {
  void WebBrowser.openBrowserAsync(legalPageUrl(page, language));
}
