import { afterEach, describe, expect, it } from 'vitest';
import { legalPageUrl, supportEmail, supportMailto, webBaseUrl } from '../legal-links';

afterEach(() => {
  delete process.env.EXPO_PUBLIC_WEB_URL;
  delete process.env.EXPO_PUBLIC_SUPPORT_EMAIL;
});

describe('legal page links', () => {
  it('English pages at the root, Hindi under /hi', () => {
    expect(legalPageUrl('privacy', 'en', 'https://coachingdesk.in')).toBe(
      'https://coachingdesk.in/privacy',
    );
    expect(legalPageUrl('terms', 'hi', 'https://coachingdesk.in')).toBe(
      'https://coachingdesk.in/hi/terms',
    );
    expect(legalPageUrl('delete-account', 'en-IN', 'https://coachingdesk.in')).toBe(
      'https://coachingdesk.in/delete-account',
    );
  });

  it('the website address comes from EXPO_PUBLIC_WEB_URL (no trailing slash), else coachingdesk.in', () => {
    expect(webBaseUrl()).toBe('https://coachingdesk.in');
    process.env.EXPO_PUBLIC_WEB_URL = 'https://staging.example.com/';
    expect(webBaseUrl()).toBe('https://staging.example.com');
    expect(legalPageUrl('contact', 'hi')).toBe('https://staging.example.com/hi/contact');
  });
});

describe('support email', () => {
  it('support@coachingdesk.in unless EXPO_PUBLIC_SUPPORT_EMAIL says otherwise', () => {
    expect(supportEmail()).toBe('support@coachingdesk.in');
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help@example.com';
    expect(supportEmail()).toBe('help@example.com');
  });

  it('a mailto with the subject and the app version, safely encoded', () => {
    const url = supportMailto('Coaching Desk: help & feedback', '1.0.0', 'android');
    expect(url.startsWith('mailto:support@coachingdesk.in?subject=')).toBe(true);
    const query = new URLSearchParams(url.split('?')[1]);
    expect(query.get('subject')).toBe('Coaching Desk: help & feedback');
    expect(query.get('body')).toContain('Coaching Desk 1.0.0 (android)');
  });
});
