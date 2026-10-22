import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLAN_IDS, PLANS, TRIAL_DAYS } from '@coachingdesk/shared';
import { describe, expect, it } from 'vitest';
import { escapeHtml, missingDetails, renderPage, rupees } from '../lib.mjs';

const root = join(__dirname, '..');
const site = JSON.parse(readFileSync(join(root, 'site.json'), 'utf8'));
const filled = {
  ...site,
  supportEmail: 'support@example.in',
  legalName: 'Example Pvt Ltd',
  address: 'Pune, Maharashtra',
  grievanceOfficer: 'A. Person',
  jurisdictionCity: 'Pune',
};

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

describe('building', () => {
  it('refuses while a business detail is blank (no placeholder can go live)', () => {
    expect(missingDetails({ ...filled, supportEmail: ' ' })).toEqual(['supportEmail']);
    expect(missingDetails(filled)).toEqual([]);
  });

  it('escapes details so they cannot break the page', () => {
    expect(escapeHtml('A & B <x>')).toBe('A &amp; B &lt;x&gt;');
  });

  it('every page renders with its own title, and nothing left to fill', () => {
    const layout = readFileSync(join(root, 'layout.html'), 'utf8');
    const meta = JSON.parse(readFileSync(join(root, 'pages.json'), 'utf8')) as Record<
      string,
      { title: string; description: string }
    >;
    expect(Object.keys(meta).sort()).toEqual(readdirSync(join(root, 'pages')).sort());
    expect(Object.keys(meta).sort()).toEqual([
      'contact.html',
      'delete-account.html',
      'index.html',
      'privacy.html',
      'terms.html',
    ]);
    for (const [file, page] of Object.entries(meta)) {
      const body = readFileSync(join(root, 'pages', file), 'utf8');
      const html = renderPage(layout, { ...page, body }, filled);
      expect(html).toContain(`<title>${escapeHtml(page.title)}</title>`);
      expect(page.title).not.toMatch(/description:/); // headers never merged into the title
      expect(html).not.toMatch(/\{\{/);
      expect(html).toContain('support@example.in');
      expect(html).not.toMatch(/<script/i); // no scripts, no trackers (DPDP: children's data)
    }
  });
});
