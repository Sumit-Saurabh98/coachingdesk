import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLANS, PLAN_IDS, TERMS_VERSION, TRIAL_DAYS } from '@coachingdesk/shared';
import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  fill,
  LANGUAGES,
  lookup,
  missingDetails,
  PAGES,
  pageUrl,
  renderPage,
  rupees,
} from '../lib.mjs';

const root = join(__dirname, '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');
const site = JSON.parse(read('site.json'));
const content = Object.fromEntries(
  LANGUAGES.map((lang: string) => [lang, JSON.parse(read('content', `${lang}.json`))]),
);

function keysOf(node: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(node).flatMap(([key, value]) =>
    typeof value === 'object' && value !== null
      ? keysOf(value as Record<string, unknown>, `${prefix}${key}.`)
      : [`${prefix}${key}`],
  );
}

describe('content', () => {
  it('English and Hindi have exactly the same keys', () => {
    expect(keysOf(content.hi).sort()).toEqual(keysOf(content.en).sort());
  });

  it('a missing text is a build error, never a blank on the page', () => {
    expect(() => lookup(content.en, 'hero.nope')).toThrow(/Missing text/);
  });
});

describe('pricing on the website', () => {
  it('matches the plans the app actually sells (packages/shared)', () => {
    expect(site.trialDays).toBe(TRIAL_DAYS);
    expect(site.plans.map((p: { id: string }) => p.id)).toEqual([...PLAN_IDS]);
    for (const shown of site.plans) {
      const real = PLANS[shown.id as (typeof PLAN_IDS)[number]];
      expect(shown.monthlyRupees * 100).toBe(real.monthlyPricePaise);
      expect(shown.yearlyRupees * 100).toBe(real.yearlyPricePaise);
      expect(shown.maxActiveStudents).toBe(real.maxActiveStudents);
      expect(shown.maxMembers).toBe(real.maxMembers);
      expect(shown.monthlyMessages).toBe(real.monthlyMessages);
      expect(shown.features).toEqual([...real.features]);
    }
  });

  it('formats rupees the Indian way', () => {
    expect(rupees(14999)).toBe('14,999');
    expect(rupees(149999)).toBe('1,49,999');
  });
});

describe('terms version', () => {
  it('the app asks users to accept the version these pages show (KB #54)', () => {
    // site.json says "22 October 2026"; TERMS_VERSION is "2026-10-22". Change both together.
    const shown = new Date(`${site.lastUpdated} UTC`).toISOString().slice(0, 10);
    expect(shown).toBe(TERMS_VERSION);
  });
});

describe('building', () => {
  it('refuses while a business detail is blank (no placeholder can go live)', () => {
    expect(missingDetails({ ...site, supportEmail: ' ' })).toEqual(['supportEmail']);
    expect(missingDetails(site)).toEqual([]);
  });

  it('escapes text so it cannot break the page', () => {
    expect(escapeHtml('A & B <x>')).toBe('A &amp; B &lt;x&gt;');
  });

  it('English at /, Hindi under /hi', () => {
    expect(pageUrl('en', 'index')).toBe('/');
    expect(pageUrl('hi', 'index')).toBe('/hi');
    expect(pageUrl('hi', 'privacy')).toBe('/hi/privacy');
  });

  it('every page renders in both languages, with its title, a working switch, and nothing left to fill', () => {
    const layout = read('templates', 'layout.html');
    for (const lang of LANGUAGES) {
      for (const page of PAGES) {
        const body =
          page === 'index'
            ? read('templates', 'index.html')
            : read('templates', 'legal', lang, `${page}.html`);
        const html = renderPage(layout, body, { site, content: content[lang], lang, page });
        expect(html).toContain(`<html lang="${lang}">`);
        expect(html).toContain(`<title>${escapeHtml(content[lang].meta[page].title)}</title>`);
        expect(html).toContain(`href="${pageUrl(lang === 'en' ? 'hi' : 'en', page)}"`);
        expect(html).not.toMatch(/\{\{|\{[a-z]+\}/);
        expect(html).toContain(site.supportEmail);
        // No trackers (DPDP: children's data): only the self-hosted video switcher, on the home page.
        const scripts = html.match(/<script[^>]*>/gi) ?? [];
        expect(scripts).toEqual(page === 'index' ? ['<script src="/video.js" defer>'] : []);
      }
    }
  });

  it('the product video and its poster exist in every language', () => {
    const files = readdirSync(join(root, 'static'));
    for (const lang of LANGUAGES) {
      expect(files).toContain(`coachingdesk-${lang}.mp4`);
      expect(files).toContain(`coachingdesk-${lang}.jpg`);
    }
  });

  it('every illustration renders in both languages with nothing left to fill', () => {
    for (const lang of LANGUAGES) {
      for (const file of readdirSync(join(root, 'illustrations'))) {
        const svg = fill(read('illustrations', file), {
          site,
          content: content[lang],
          lang,
          page: 'index',
        });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg).not.toMatch(/\{\{/);
      }
    }
  });
});
