// The website builder, as plain functions (tested in __tests__). Templates use placeholders:
//   {{t:path.to.text}}  text from content/<lang>.json (HTML-escaped)
//   {{site:key}}        a business detail from site.json (HTML-escaped)
//   {{link:page}}       that page's URL in the current language ("/privacy" or "/hi/privacy")
//   {{img:name}}        that illustration in the current language
//   {{switch}}          this same page in the other language
//   {{lang}}, {{year}}, {{pricing}}
// The build refuses to run while a business detail is blank, so no placeholder text goes live.

export const LANGUAGES = ['en', 'hi'];
export const PAGES = ['index', 'privacy', 'terms', 'delete-account', 'contact'];

/** The details every page needs. All must be filled in site.json before a build. */
export const REQUIRED_DETAILS = [
  'productName',
  'domain',
  'supportEmail',
  'legalName',
  'address',
  'grievanceOfficer',
  'jurisdictionCity',
  'lastUpdated',
];

export function missingDetails(site) {
  return REQUIRED_DETAILS.filter((key) => typeof site[key] !== 'string' || site[key].trim() === '');
}

/** Text for HTML and SVG: & < > " ' escaped, so content can never break the page. */
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 2999 -> "2,999"; 149999 -> "1,49,999" (Indian grouping). */
export function rupees(amount) {
  return new Intl.NumberFormat('en-IN').format(amount);
}

/** "content.path" -> the string; a missing key is a build error, never a blank on the page. */
export function lookup(content, path) {
  const value = path
    .split('.')
    .reduce((node, key) => (node == null ? undefined : node[key]), content);
  if (typeof value !== 'string') {
    throw new Error(`Missing text "${path}" for language ${content.lang?.code ?? '?'}`);
  }
  return value;
}

/** "{n} active students" with { n: 100 } -> "100 active students". */
export function format(text, values) {
  return text.replace(/\{(\w+)\}/g, (_m, key) =>
    key in values ? String(values[key]) : `{${key}}`,
  );
}

/** URL of a page in a language: English at "/", Hindi under "/hi". */
export function pageUrl(lang, page) {
  const prefix = lang === 'en' ? '' : `/${lang}`;
  if (page === 'index') {
    return prefix === '' ? '/' : prefix;
  }
  return `${prefix}/${page}`;
}

/** The pricing cards, from site.json (a test keeps them equal to the app's real plans). */
export function pricingHtml(site, content) {
  const t = (path) => escapeHtml(lookup(content, `pricing.${path}`));
  const cards = site.plans
    .map((plan) => {
      const popular = plan.id === site.popularPlan;
      const price =
        plan.monthlyRupees === 0
          ? `<p class="price">₹0 <span>${t('forever')}</span></p><p class="yearly">&nbsp;</p>`
          : `<p class="price">₹${rupees(plan.monthlyRupees)} <span>${t('perMonth')}</span></p>
          <p class="yearly">${escapeHtml(format(lookup(content, 'pricing.orYear'), { amount: rupees(plan.yearlyRupees) }))}</p>`;
      const lines = [
        plan.maxActiveStudents === null
          ? t('unlimitedStudents')
          : escapeHtml(format(lookup(content, 'pricing.students'), { n: plan.maxActiveStudents })),
        plan.maxMembers === null
          ? t('unlimitedTeam')
          : plan.maxMembers === 0
            ? t('justYou')
            : plan.maxMembers === 1
              ? t('oneHelper')
              : escapeHtml(format(lookup(content, 'pricing.team'), { n: plan.maxMembers })),
        plan.features.includes('automatic_messages')
          ? escapeHtml(
              format(lookup(content, 'pricing.messages'), { n: rupees(plan.monthlyMessages) }),
            )
          : t('manual'),
        plan.features.includes('result_cards') ? t('results') : null,
      ].filter(Boolean);
      return `<div class="plan${popular ? ' plan--popular' : ''}">
          ${popular ? `<span class="plan-badge">${t('popular')}</span>` : ''}
          <h3>${t(plan.id)}</h3>
          ${price}
          <ul>${lines.map((line) => `<li>${line}</li>`).join('')}</ul>
        </div>`;
    })
    .join('\n');
  return `<div class="plans">${cards}</div>
      <p class="note">${escapeHtml(format(lookup(content, 'pricing.note'), { days: site.trialDays }))}</p>`;
}

/** Fill every placeholder for one language (and one page, for {{switch}}). */
export function fill(template, ctx) {
  const { site, content, lang, page } = ctx;
  return template.replace(/\{\{([a-z]+)(?::([\w.-]+))?\}\}/g, (_m, kind, arg) => {
    switch (kind) {
      case 't':
        return escapeHtml(lookup(content, arg));
      case 'site':
        if (!(arg in site)) {
          throw new Error(`Unknown site detail {{site:${arg}}}`);
        }
        return escapeHtml(site[arg]);
      case 'link':
        return pageUrl(lang, arg);
      case 'img':
        return `/images/${lang}/${arg}.svg`;
      case 'switch':
        return pageUrl(lang === 'en' ? 'hi' : 'en', page);
      case 'lang':
        return lang;
      case 'year':
        return String(new Date().getFullYear());
      case 'pricing':
        return pricingHtml(site, content);
      default:
        throw new Error(`Unknown placeholder {{${kind}}}`);
    }
  });
}

/** One page in one language: the layout around the page's body, everything filled. */
export function renderPage(layout, body, ctx) {
  const page = ctx.page;
  const html = layout
    .replaceAll('{{title}}', escapeHtml(lookup(ctx.content, `meta.${page}.title`)))
    .replaceAll('{{description}}', escapeHtml(lookup(ctx.content, `meta.${page}.description`)))
    .replaceAll('{{canonical}}', `https://${ctx.site.domain}${pageUrl(ctx.lang, page)}`)
    .replaceAll('{{alternateEn}}', `https://${ctx.site.domain}${pageUrl('en', page)}`)
    .replaceAll('{{alternateHi}}', `https://${ctx.site.domain}${pageUrl('hi', page)}`)
    .replaceAll('{{body}}', body);
  return fill(html, ctx);
}
