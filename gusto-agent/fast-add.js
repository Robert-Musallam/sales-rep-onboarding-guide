// Fast path (deterministic, no AI): company switch + header check, duplicate check, Basics form fill.
// Stops with the filled Basics form open and UNSAVED. In send mode the AI then finishes from there
// (save → employment info → invite → documents → verify). Anything unexpected → exit != 0 and
// run.sh falls back to the full AI skill, which has all the stop rules.
//
// Input:  one JSON argument {rep_id, first_name, last_name, email, territory, contractor_type, business_name}
// Output: one JSON line on stdout {ok, stage, company, slug, notes, filled}
// Exit:   0 ok · 20 unmapped territory · 21 duplicate found (STOP, no fallback) · 30 unexpected page (fallback)
const { chromium } = require('playwright-core');

const CDP = process.env.GUSTO_CDP_URL || 'http://127.0.0.1:9336';
const COMPANY = {
  'arizona': 'Rock n block arizona',
  'colorado': 'Rock N Block CO LLC',
  'tampa': 'Rock n block florida llc',
  'las vegas': 'Rock N Block llc',
  'utah': 'Rock N Block llc',
  'san diego': 'Rock n block San Diego llc',
  'oc/ie': 'Rock n block San Diego llc',
};
const notes = [];
const t0 = Date.now();
function out(obj, code) {
  process.stdout.write(JSON.stringify({ ...obj, notes, ms: Date.now() - t0 }) + '\n');
  process.exit(code);
}
function note(s) { notes.push(s); console.error(`[fast-add ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); }
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

(async () => {
  const rep = JSON.parse(process.argv[2] || '{}');
  const company = COMPANY[norm(rep.territory)];
  if (!company) out({ ok: false, stage: 'map', reason: `unmapped_location:${rep.territory}` }, 20);
  const business = rep.contractor_type === 'business';
  const fullName = `${rep.first_name} ${rep.last_name}`.trim();

  const browser = await chromium.connectOverCDP(CDP, { timeout: 10000 });
  const page = await browser.contexts()[0].newPage();
  page.setDefaultTimeout(15000);
  try {
    // 1. Company switch
    await page.goto('https://app.gusto.com/u/companies', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => [...document.querySelectorAll('button, a')].some((b) => /^\s*sign in/i.test(b.innerText || '')), null, { timeout: 20000 });
    const clicked = await page.evaluate((target) => {
      const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const btns = [...document.querySelectorAll('button, a')].filter((b) => /^\s*sign in/i.test(b.innerText || ''));
      for (const b of btns) {
        let row = b;
        while (row.parentElement && [...row.parentElement.querySelectorAll('button, a')].filter((x) => /^\s*sign in/i.test(x.innerText || '')).length === 1) row = row.parentElement;
        const lines = (row.innerText || '').split('\n').map(norm);
        if (lines.includes(norm(target))) { b.click(); return true; }
      }
      return false;
    }, company);
    if (!clicked) out({ ok: false, stage: 'company', reason: `company row not found: ${company}` }, 30);
    await page.waitForURL((u) => !/\/u\/companies/.test(u.toString()), { timeout: 30000 });
    await page.waitForFunction((n) => document.body.innerText.toLowerCase().includes(n.toLowerCase()), company, { timeout: 20000 });
    const slug = new URL(page.url()).pathname.split('/')[1];
    note(`company ${company} (slug ${slug}) confirmed in page`);

    // Close promo dialogs (Close / X / Not now / Dismiss only)
    const dismissPromos = async () => {
      for (const name of [/^close$/i, /^not now$/i, /^dismiss$/i, /^no thanks$/i]) {
        const d = page.getByRole('dialog').getByRole('button', { name });
        if (await d.count()) { await d.first().click().catch(() => {}); note('closed a dialog'); }
      }
    };

    // 2. Duplicate check: email, full name, business name — Active, Onboarding, Dismissed
    const terms = [rep.email, fullName, business ? rep.business_name : null].filter(Boolean);
    for (const tab of ['Active', 'Onboarding', 'Dismissed']) {
      await page.goto(`https://app.gusto.com/${slug}/payroll_admin/people/all`, { waitUntil: 'domcontentloaded' });
      await dismissPromos();
      const tabEl = page.getByRole('tab', { name: new RegExp(`^${tab}`, 'i') }).or(page.getByRole('link', { name: new RegExp(`^${tab}$`, 'i') }));
      await tabEl.first().click();
      await page.waitForTimeout(1500);
      const search = page.locator('input[placeholder="Search people"]:visible');
      if (await search.count()) {
        for (const term of terms) {
          await search.first().fill('');
          await search.first().fill(term);
          await page.waitForTimeout(1500);
          const body = norm(await page.locator('main').innerText().catch(() => page.locator('body').innerText()));
          const hitName = norm(term) !== norm(rep.email) && body.includes(norm(term));
          const hitEmail = body.includes(norm(rep.email));
          if (hitName || hitEmail) out({ ok: false, stage: 'duplicate', company, slug, reason: `already_in_gusto:${tab}:${term}` }, 21);
        }
        await search.first().fill('');
        await page.waitForTimeout(800);
      } else {
        // No search box on this tab (Onboarding): the list is short — read it whole.
        const body = norm(await page.locator('main').innerText().catch(() => page.locator('body').innerText()));
        for (const term of terms) {
          if (body.includes(norm(term))) out({ ok: false, stage: 'duplicate', company, slug, reason: `already_in_gusto:${tab}:${term}` }, 21);
        }
      }
      note(`${tab}: clean`);
      // Onboarding: Gusto search may not match emails → open same-last-name / business-name entries and compare.
      if (tab === 'Onboarding') {
        const links = page.locator('main a').filter({ hasText: new RegExp(`${rep.last_name}|${business ? rep.business_name : '\\u0000'}`, 'i') });
        const hrefs = (await links.evaluateAll((els) => els.map((e) => e.getAttribute('href')))).filter(Boolean);
        const base = page.url();
        for (const href of [...new Set(hrefs)].slice(0, 5)) {
          const pageUrl = new URL(href, base).toString();
          await page.goto(pageUrl.replace(/\/(work|onboarding_checklist)?$/, '') + '/personal', { waitUntil: 'domcontentloaded' });
          if (norm(await page.locator('body').innerText()).includes(norm(rep.email))) out({ ok: false, stage: 'duplicate', company, slug, reason: 'already_in_gusto:Onboarding:email' }, 21);
        }
      }
    }
    note(`duplicate check clean (${terms.length} terms × 3 tabs)`);

    // 3. Basics form
    await page.goto(`https://app.gusto.com/${slug}/payroll_admin/people/add_team_member/basics`, { waitUntil: 'domcontentloaded' });
    await dismissPromos();
    await page.getByLabel(/^first name/i).fill(rep.first_name);
    await page.getByLabel(/^last name/i).fill(rep.last_name);
    await page.getByLabel(/^preferred first name/i).fill(rep.first_name);
    await page.getByLabel(business ? /contractor \(business\)/i : /contractor \(individual\)/i).check();
    if (business) {
      const bn = page.getByLabel(/business name/i);
      await bn.waitFor();
      await bn.fill(rep.business_name || '');
    }
    const country = page.getByLabel(/^country/i).first();
    if (await country.count()) {
      const val = async () => (await country.inputValue().catch(() => '')) || (await country.getAttribute('placeholder').catch(() => '')) || '';
      for (let i = 0; i < 10 && !/united states/i.test(await val()); i++) await page.waitForTimeout(500);
      if (!/united states/i.test(await val())) {
        await country.fill('United States');
        await page.getByRole('option', { name: /^united states$/i }).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
      const v = await val();
      if (!/united states/i.test(v)) out({ ok: false, stage: 'basics', reason: `country field shows "${v}"` }, 30);
      note(`country: ${v}`);
    }
    await page.getByLabel(/^personal email/i).fill(rep.email);
    const agreement = page.getByLabel(/send a contractor agreement/i);
    if ((await agreement.count()) && (await agreement.isChecked())) await agreement.uncheck();

    // read back
    const filled = {
      first_name: await page.getByLabel(/^first name/i).inputValue(),
      last_name: await page.getByLabel(/^last name/i).inputValue(),
      preferred: await page.getByLabel(/^preferred first name/i).inputValue(),
      worker_type: business ? 'business' : 'individual',
      business_name: business ? await page.getByLabel(/business name/i).inputValue() : null,
      email: await page.getByLabel(/^personal email/i).inputValue(),
    };
    const bad = filled.first_name !== rep.first_name || filled.last_name !== rep.last_name || norm(filled.email) !== norm(rep.email)
      || (business && filled.business_name !== rep.business_name);
    if (bad) out({ ok: false, stage: 'basics', reason: 'read-back mismatch', filled }, 30);
    note('Basics filled and read back OK — NOT saved');
    out({ ok: true, stage: 'basics_filled', company, slug, url: page.url(), filled }, 0);
  } catch (e) {
    out({ ok: false, stage: 'error', reason: String(e && e.message ? e.message : e).slice(0, 300), url: page.url() }, 30);
  }
})();
