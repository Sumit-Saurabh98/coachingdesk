import { afterEach, describe, expect, it } from 'vitest';
import { legalPageUrl, webBaseUrl } from '../legal-links';

afterEach(() => {
  delete process.env.EXPO_PUBLIC_WEB_URL;
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
