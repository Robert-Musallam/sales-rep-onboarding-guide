// Housecall Pro "Add team member" (deterministic, no AI) in the Gusto agent's Chrome (:9336),
// signed in to HCP as an admin of every RNB territory account.
//
// Adds the rep as Field Tech in the territory account, with "See & edit customer database"
// OFF and every other permission left at the Field Tech default. Saving sends the rep HCP's
// invite by email + SMS. NEVER authorizes a payment: a pay-for-another-user prompt is
// cancelled and reported (exit 22).
//
// Input:  JSON arg {rep_id, first_name, last_name, email, phone, territory, used_colors[]}
//         --send to click Save (default: dry run — fill + read back, never save)
// Output: one JSON line {outcome, reason, account, color, filled, notes, ms}
// Exit:   0 created | dry_run_ok   10 session   20 stopped   21 duplicate   22 payment_required   30 unexpected
const { chromium } = require('playwright-core');

const CDP = process.env.GUSTO_CDP_URL || 'http://127.0.0.1:9336';
const SEND = process.argv.includes('--send');
const ACCOUNT = {
  'arizona': 'Rock N Block - Turf N Hardscapes Arizona',
  'las vegas': 'Rock N Block - Turf N Hardscapes Las Vegas',
  'oc/ie': 'Rock N Block - Turf N Hardscapes OC / IE',
  'san diego': 'Rock N Block - Turf N Hardscapes San Diego',
  'santa clara': 'Rock N Block - Turf N Hardscapes Santa Clara',
  'tampa': 'Rock N Block - Turf N Hardscapes Tampa',
  'utah': 'Rock N Block - Turf N Hardscapes Utah',
  'colorado': 'Rock N Block Turf N Hardscapes Colorado',
};
const FORBIDDEN = ['Rock N Block-Parent', 'RNB Contractors', 'TEMPLATE ACCOUNT'];
const DEFAULT_COLOR = '#c0370c';
// Field Tech permissions as HCP shows them (2026-11-03). Anything else on the form → stop.
const PERMS = {
  'Add/edit jobs': true, 'Delete/cancel jobs': true, 'Take payments & see prices': true,
  'Allow user to deposit checks with mobile check deposit': true, 'See customer phone number & email': true,
  'Allow user to chat with customers': true, 'See & edit customer database': false,
  'Update company account info': false, 'Online booking availability': true, 'Show techs next job': true,
  'Show techs full schedule': true, 'Edit message on invoice': true, 'Show home data': true,
  'See job costing margins': false, 'View and manage Price Book': false,
};
const PAY_RX = /(additional (user|seat|license)|authorize (the )?(payment|charge)|upgrade your plan|user limit|add(ing)? a seat|will be charged|billing)/i;

const notes = [];
const t0 = Date.now();
let browser, page;
async function out(obj, code) {
  process.stdout.write(JSON.stringify({ ...obj, mode: SEND ? 'send' : 'dry_run', notes, ms: Date.now() - t0 }) + '\n');
  try { if (page) await page.close({ runBeforeUnload: false }); } catch {}
  try { if (browser) await browser.close(); } catch {}
  process.exit(code);
}
function note(s) { notes.push(s); console.error(`[hcp ${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`); }
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const onLogin = () => /\/log_in|\/login|sign_in/.test(page.url());
async function accountShown() {
  const sw = page.getByTestId('franchise-menu-button-with-company-name');
  await sw.waitFor({ state: 'visible', timeout: 45000 });
  return (await sw.innerText()).trim();
}
async function openEmployees() {
  await page.goto('https://pro.housecallpro.com/app/settings/employees', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  if (onLogin()) await out({ outcome: 'session', reason: 'hcp_sign_in_needed' }, 10);
  await page.getByTestId('tab-Team').waitFor({ state: 'visible', timeout: 45000 });
}

async function paymentPrompt() {
  const dlg = page.locator('[role=dialog], [role=alertdialog], .MuiDialog-root');
  const n = await dlg.count();
  for (let i = 0; i < n; i++) {
    const d = dlg.nth(i);
    if (!(await d.isVisible().catch(() => false))) continue;
    const t = (await d.innerText().catch(() => '')).replace(/\s+/g, ' ');
    if (PAY_RX.test(t)) return { d, text: t.slice(0, 300) };
  }
  return null;
}
async function cancelPayment(p) {
  for (const name of [/^cancel$/i, /^close$/i, /^no/i, /not now/i]) {
    const b = p.d.getByRole('button', { name }).first();
    if (await b.count()) { await b.click().catch(() => {}); note('payment prompt cancelled'); return; }
  }
  await page.keyboard.press('Escape').catch(() => {});
  note('payment prompt dismissed with Escape');
}

(async () => {
  const rep = JSON.parse(process.argv.find((a) => a.startsWith('{')) || '{}');
  const account = ACCOUNT[norm(rep.territory)];
  if (!account || FORBIDDEN.includes(account)) await out({ outcome: 'stopped', reason: `unmapped_location:${rep.territory}` }, 20);
  const first = String(rep.first_name || '').trim();
  const last = String(rep.last_name || '').trim();
  const email = String(rep.email || '').trim().toLowerCase();
  const phone = String(rep.phone || '').replace(/\D/g, '').slice(-10);
  const missing = [!first && 'first_name', !last && 'last_name', !email.includes('@') && 'rnb_email', phone.length !== 10 && 'phone'].filter(Boolean);
  if (missing.length) await out({ outcome: 'stopped', reason: `missing:${missing.join(',')}`, account }, 20);

  browser = await chromium.connectOverCDP(CDP, { timeout: 10000 });
  page = await browser.contexts()[0].newPage();
  page.setDefaultTimeout(30000);
  try {
    await openEmployees();

    // ── Step 2: switch to the territory account
    if ((await accountShown()) !== account) {
      await page.getByTestId('franchise-menu-button-with-company-name').click();
      const item = page.locator('[data-testid^="franchisee-menu-item-"]').filter({ hasText: new RegExp(`^\\s*R?\\s*${account.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*$`) });
      if ((await item.count()) !== 1) await out({ outcome: 'stopped', reason: `account_not_in_switcher:${account}` }, 30);
      await item.click();
      // the switch reloads the app — wait it out, then reopen the Team page
      await page.waitForTimeout(5000);
      await page.waitForLoadState('domcontentloaded').catch(() => {});
      await openEmployees();
      note(`switched to ${account}`);
    }
    const shown = await accountShown();
    if (shown !== account || FORBIDDEN.includes(shown)) await out({ outcome: 'stopped', reason: `wrong_account_shown:${shown}`, account }, 30);

    // ── Step 3: duplicate check in the UI (the worker already checked by API)
    await page.waitForTimeout(2000);
    const list = norm(await page.locator('body').innerText());
    if (list.includes(norm(`${first} ${last}`))) await out({ outcome: 'duplicate', reason: `"${first} ${last}" already in ${account}`, account }, 21);

    // ── Step 4: Add team member (full-screen form, no account header — the account was
    // confirmed on the Team page just above and the switch is per-session, not per-page)
    if ((await accountShown()) !== account) await out({ outcome: 'stopped', reason: 'account_changed_before_form', account }, 30);
    await page.goto('https://pro.housecallpro.com/app/settings/employees/new', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('EmployeeOnboardingForm__firstName').waitFor();
    await page.getByTestId('EmployeeOnboardingForm__firstName').fill(first);
    await page.getByTestId('EmployeeOnboardingForm__lastName').fill(last);
    await page.getByTestId('EmployeeOnboardingForm__email').fill(email);
    await page.getByTestId('EmployeeOnboardingForm__mobileNumber').fill(phone);

    // color: first palette color not used in this account (and not the default); else any non-default
    const used = new Set((rep.used_colors || []).map((c) => String(c).toLowerCase()));
    await page.getByRole('combobox', { name: /Team member color/i }).click();
    const opts = page.locator('[role=option][data-value^="#"]');
    await opts.first().waitFor();
    const values = await opts.evaluateAll((els) => els.map((e) => e.getAttribute('data-value').toLowerCase()));
    const color = values.find((v) => v !== DEFAULT_COLOR && !used.has(v)) || values.find((v) => v !== DEFAULT_COLOR);
    await page.locator(`[role=option][data-value="${color}"]`).click();
    note(`color ${color}${used.has(color) ? ' (all colors in use)' : ''}`);

    // role: Field Tech
    const ft = page.getByRole('radio', { name: 'Field Tech' });
    if (!(await ft.isChecked())) await ft.check();

    // permissions: exactly the known Field Tech set; only customer database turned off
    await page.waitForTimeout(800);
    const boxes = await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].map((el) => {
      const l = el.closest('label'); return { label: (l ? l.innerText : '').trim(), checked: el.checked };
    }).filter((x) => x.label));
    const unknown = boxes.filter((b) => !(b.label in PERMS)).map((b) => b.label);
    const absent = Object.keys(PERMS).filter((k) => !boxes.some((b) => b.label === k));
    if (unknown.length || absent.length) await out({ outcome: 'stopped', reason: `permissions_changed: unknown=[${unknown}] missing=[${absent}]`, account }, 30);
    const db = page.getByRole('checkbox', { name: 'See & edit customer database' });
    if (await db.isChecked()) await db.uncheck();
    const acct = page.getByRole('checkbox', { name: 'Update company account info' });
    if (await acct.isChecked()) await acct.uncheck();

    // ── read back everything
    const rb = {
      first: await page.getByTestId('EmployeeOnboardingForm__firstName').inputValue(),
      last: await page.getByTestId('EmployeeOnboardingForm__lastName').inputValue(),
      email: (await page.getByTestId('EmployeeOnboardingForm__email').inputValue()).toLowerCase(),
      phone: (await page.getByTestId('EmployeeOnboardingForm__mobileNumber').inputValue()).replace(/\D/g, ''),
      field_tech: await ft.isChecked(),
      customer_db: await db.isChecked(),
      company_info: await acct.isChecked(),
      account: shown,
    };
    const ok = rb.first === first && rb.last === last && rb.email === email && rb.phone.endsWith(phone) && rb.field_tech && !rb.customer_db && !rb.company_info && rb.account === account;
    if (!ok) await out({ outcome: 'stopped', reason: 'read_back_mismatch', filled: rb, account }, 30);
    note('form filled and read back');

    let pay = await paymentPrompt();
    if (pay) { await cancelPayment(pay); await out({ outcome: 'payment_required', reason: pay.text, account }, 22); }

    if (!SEND) await out({ outcome: 'dry_run_ok', reason: null, account, color, filled: rb }, 0);

    // ── Step 5: Save
    await page.getByRole('button', { name: /^Save$/ }).click();
    note('clicked Save');
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      pay = await paymentPrompt();
      if (pay) { await cancelPayment(pay); await out({ outcome: 'payment_required', reason: pay.text, account, color }, 22); }
      if (!page.url().includes('/employees/new')) break;
      const err = await page.locator('[role=alert], .Mui-error, [class*=rror]').allInnerTexts().catch(() => []);
      const msg = err.map((s) => s.trim()).filter(Boolean).join(' | ');
      if (msg && /already|exists|invalid|required|error/i.test(msg)) await out({ outcome: 'stopped', reason: `save_error: ${msg.slice(0, 200)}`, account }, 30);
      await page.waitForTimeout(1000);
    }
    if (page.url().includes('/employees/new')) await out({ outcome: 'stopped', reason: 'save_not_confirmed (still on the form)', account }, 30);

    // ── Step 6: verify in the list
    await openEmployees();
    await page.waitForTimeout(2000);
    const after = norm(await page.locator('body').innerText());
    if (!after.includes(norm(`${first} ${last}`))) await out({ outcome: 'stopped', reason: 'saved_but_not_in_list', account }, 30);
    await out({ outcome: 'created', reason: null, account, color }, 0);
  } catch (e) {
    if (page && onLogin()) await out({ outcome: 'session', reason: 'hcp_sign_in_needed' }, 10);
    await out({ outcome: 'stopped', reason: `unexpected: ${String(e.message || e).split('\n')[0].slice(0, 200)}` }, 30);
  }
})();
