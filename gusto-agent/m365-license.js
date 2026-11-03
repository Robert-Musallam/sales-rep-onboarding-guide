// M365 license step (deterministic, no AI) in the Gusto agent's Chrome (:9336),
// which must be signed in to admin.cloud.microsoft (tenant Rock N Block LLC).
//
// Assigns Microsoft 365 Business Basic ONLY. Never touches any other license
// (Business Standard is out of seats — checking it makes Microsoft try to BUY one).
//
// Input:  JSON arg {rep_id, upn, name}   ·   --send to click Save (default: dry run, no clicks on licenses)
// Output: one JSON line {outcome, reason, available, licenses_before, licenses_after, notes, ms}
// Exit:   0 licensed | already_licensed | dry_run_ok
//         10 session (Microsoft sign-in needed)   20 stopped (stop rule)   30 unexpected page
const { chromium } = require('playwright-core');

const CDP = process.env.GUSTO_CDP_URL || 'http://127.0.0.1:9336';
const BASIC = 'Microsoft 365 Business Basic';
const SEND = process.argv.includes('--send');
const notes = [];
const t0 = Date.now();
let browser, page;
async function out(obj, code) {
  process.stdout.write(JSON.stringify({ ...obj, mode: SEND ? 'send' : 'dry_run', notes, ms: Date.now() - t0 }) + '\n');
  try { if (page) await page.close(); } catch {}
  try { if (browser) await browser.close(); } catch {}
  process.exit(code);
}
function note(s) { notes.push(s); console.error(`[m365 ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); }
const onLogin = (u) => /login\.microsoftonline\.com|login\.microsoft\.com|login\.live\.com/.test(u);

async function licenseRows() {
  // License rows in the Licenses and apps tab. Microsoft tags each one:
  //   input[data-automation-id="ProductSkuId_<sku>"]  ·  label[for] > [data-automation-id="LicenseText_<name>"]
  //   #LicenseSubText_<sku> → "N of M licenses available" (with hidden U+200E marks, stripped here)
  return page.evaluate(() => {
    const rows = [];
    for (const input of document.querySelectorAll('input[type=checkbox][data-automation-id^="ProductSkuId_"]')) {
      const sku = input.getAttribute('data-automation-id').slice('ProductSkuId_'.length);
      const lab = document.querySelector(`label[for="${input.id}"]`);
      const nameEl = lab && lab.querySelector('[data-automation-id^="LicenseText_"]');
      const name = (nameEl ? nameEl.getAttribute('data-automation-id').slice('LicenseText_'.length) : (lab?.innerText || '')).replace(/[\u200e\u200f]/g, '').trim();
      const sub = document.getElementById(`LicenseSubText_${sku}`);
      const avail = (sub?.innerText || '').replace(/[\u200e\u200f]/g, '').replace(/\s+/g, ' ').trim();
      rows.push({ name, sku, id: input.id, checked: input.checked, avail });
    }
    return rows;
  });
}

(async () => {
  const rep = JSON.parse(process.argv.find((a) => a.startsWith('{')) || '{}');
  const upn = String(rep.upn || '').trim().toLowerCase();
  if (!upn.includes('@')) await out({ outcome: 'stopped', reason: 'no_rnb_email' }, 20);

  browser = await chromium.connectOverCDP(CDP, { timeout: 10000 });
  page = await browser.contexts()[0].newPage();
  page.setDefaultTimeout(30000);
  try {
    await page.goto('https://admin.cloud.microsoft/#/users', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
    if (onLogin(page.url())) await out({ outcome: 'session', reason: 'microsoft_sign_in_needed' }, 10);

    const search = page.getByRole('searchbox').first();
    await search.waitFor({ state: 'visible', timeout: 45000 });
    await search.fill(upn.split('@')[0]);
    await search.press('Enter');
    note(`searched ${upn.split('@')[0]}`);

    // Exactly one row whose username equals the RNB email.
    const cell = page.getByRole('gridcell').filter({ hasText: new RegExp(`^\\s*${upn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i') });
    await cell.first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
    const n = await cell.count();
    if (n !== 1) await out({ outcome: 'stopped', reason: n === 0 ? 'user_not_found' : `multiple_users_match:${n}` }, 20);
    const row = page.getByRole('row').filter({ has: cell });
    await row.getByRole('button').first().click();
    note('opened user panel');

    await page.getByRole('tab', { name: /Licenses and apps/i }).click();
    await page.locator('input[type=checkbox][data-automation-id^="ProductSkuId_"]').first().waitFor({ state: 'attached', timeout: 30000 });
    await page.waitForTimeout(1500);

    const before = await licenseRows();
    const basic = before.find((r) => r.name === BASIC);
    if (!basic) await out({ outcome: 'stopped', reason: 'business_basic_row_not_found' }, 30);
    const checkedBefore = before.filter((r) => r.checked).map((r) => r.name);
    note(`licenses before: ${checkedBefore.join(', ') || 'none'} · Basic: ${basic.avail}`);

    if (basic.checked) {
      await out({ outcome: 'already_licensed', reason: null, available: basic.avail, licenses_before: checkedBefore, licenses_after: checkedBefore }, 0);
    }
    const m = basic.avail.match(/(\d[\d,]*)\s+of/i);
    const free = m ? Number(m[1].replace(/,/g, '')) : NaN;
    if (!(free > 0)) await out({ outcome: 'stopped', reason: `no_business_basic_available (${basic.avail || 'count not shown'})`, available: basic.avail }, 20);

    if (!SEND) {
      await out({ outcome: 'dry_run_ok', reason: null, available: basic.avail, licenses_before: checkedBefore }, 0);
    }

    await page.locator(`label[for="${basic.id}"]`).click();
    await page.waitForTimeout(800);
    const mid = await licenseRows();
    const changed = mid.filter((r) => r.checked !== (before.find((b) => b.name === r.name)?.checked ?? false)).map((r) => r.name);
    if (changed.length !== 1 || changed[0] !== BASIC || !mid.find((r) => r.name === BASIC)?.checked) {
      await out({ outcome: 'stopped', reason: `unexpected_checkbox_change:${changed.join('|') || 'none'}` }, 30);
    }

    await page.getByRole('button', { name: /^Save changes$/ }).click();
    note('clicked Save changes');
    await page.getByText(/Your changes have been saved/i).first().waitFor({ state: 'visible', timeout: 60000 })
      .catch(async () => {
        const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
        const err = (body.match(/(error|couldn.t|failed|not enough)[^.]{0,160}/i) || [''])[0];
        await out({ outcome: 'stopped', reason: `save_not_confirmed${err ? `: ${err}` : ''}` }, 30);
      });
    await page.waitForTimeout(1500);
    const after = await licenseRows();
    const checkedAfter = after.filter((r) => r.checked).map((r) => r.name);
    if (!checkedAfter.includes(BASIC)) await out({ outcome: 'stopped', reason: 'saved_but_basic_not_checked', licenses_after: checkedAfter }, 30);
    await out({ outcome: 'licensed', reason: null, available: after.find((r) => r.name === BASIC)?.avail, licenses_before: checkedBefore, licenses_after: checkedAfter }, 0);
  } catch (e) {
    if (page && onLogin(page.url())) await out({ outcome: 'session', reason: 'microsoft_sign_in_needed' }, 10);
    await out({ outcome: 'stopped', reason: `unexpected: ${String(e.message || e).split('\n')[0].slice(0, 200)}` }, 30);
  }
})();
