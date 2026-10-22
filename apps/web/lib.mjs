// The website builder, as plain functions (tested in __tests__): fill the business details
// into every page, and refuse to build while any of them is still blank, so placeholder text
// can never go live.

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

/** The names of required details that are missing or blank. */
export function missingDetails(site) {
  return REQUIRED_DETAILS.filter((key) => typeof site[key] !== 'string' || site[key].trim() === '');
}

/** Text for HTML: & < > " ' escaped, so a detail can never break the page. */
export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 2999 -> "2,999"; 14999 -> "14,999" (Indian grouping). */
export function rupees(amount) {
  return new Intl.NumberFormat('en-IN').format(amount);
}

const limit = (value, unit) => (value === null ? `Unlimited ${unit}` : `${value} ${unit}`);

/** The pricing cards, from site.json (a test keeps them equal to the app's real plans). */
export function pricingHtml(plans, trialDays) {
  const cards = plans
    .map((plan) => {
      const price =
        plan.monthlyRupees === 0
          ? '<p class="price">₹0 <span>forever</span></p>'
          : `<p class="price">₹${rupees(plan.monthlyRupees)} <span>/ month</span></p>
        <p class="yearly">or ₹${rupees(plan.yearlyRupees)} / year</p>`;
      const lines = [
        limit(plan.maxActiveStudents, 'active students'),
        plan.maxMembers === 0
          ? 'Just you (no team members)'
          : limit(plan.maxMembers, 'team members (teachers, staff)'),
        plan.features.includes('automatic_messages')
          ? `${rupees(plan.monthlyMessages)} WhatsApp messages a month: fee reminders, absence alerts, receipts, notices`
          : 'Send reminders yourself from WhatsApp',
        plan.features.includes('result_cards') ? 'Tests, marks and result cards' : null,
      ].filter(Boolean);
      return `<div class="plan">
        <h3>${escapeHtml(plan.name)}</h3>
        ${price}
        <ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      </div>`;
    })
    .join('\n');
  return `<div class="plans">${cards}</div>
    <p class="note">Every new institute starts with a ${trialDays}-day free trial of Pro. Prices include no hidden fees; GST as applicable.</p>`;
}

/** {{key}} -> the escaped detail; {{pricing}} -> the pricing cards. Unknown keys fail. */
export function fill(template, site) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    if (key === 'pricing') {
      return pricingHtml(site.plans, site.trialDays);
    }
    if (key === 'year') {
      return String(new Date().getFullYear());
    }
    if (!(key in site)) {
      throw new Error(`Unknown placeholder {{${key}}}`);
    }
    return escapeHtml(site[key]);
  });
}

/** One page: the layout with the page's title, description and body. */
export function renderPage(layout, page, site) {
  const html = layout
    .replace('{{title}}', escapeHtml(page.title))
    .replace('{{description}}', escapeHtml(page.description))
    .replace('{{body}}', page.body);
  return fill(html, site);
}
