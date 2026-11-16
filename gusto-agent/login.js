// Deterministic Gusto sign-in (Option B). Runs BEFORE the AI step, never inside it:
// the password goes Keychain -> this process -> the page, and is never printed,
// logged, or handed to Claude.
//
// Keychain item (created once by Robert): service "gusto-agent", account = Gusto login email.
//
// Exit codes:
//   0  signed in (already, or after filling email + password)
//   10 Gusto wants the 2-step code -> the script requests it by text once, leaves the page open,
//      and later runs just wait on that page (no new code) until Robert enters it
//   11 no Keychain credentials
//   12 sign-in rejected (wrong password / locked) -> never retried automatically
//   13 cooldown: a sign-in attempt that did NOT succeed was made < 60 min ago (protects against lockout)
//   14 CAPTCHA / bot check -> needs Robert
//   15 page not recognised (stop and look)
//   16 browser not reachable on :9336
const { chromium } = require('playwright-core');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CDP = process.env.GUSTO_CDP_URL || 'http://127.0.0.1:9336';
const SERVICE = 'gusto-agent';
const STAMP = path.join(__dirname, '.login-attempt');
const ALERTS = path.join(__dirname, '..', 'worker', 'logs', 'alerts.log');
const COOLDOWN_MS = 60 * 60 * 1000;
// Set when this script made Gusto text a code; read by record-result.ts to message Robert once.
const CODE_REQUESTED = path.join(__dirname, '.code-requested');
const REMIND_MS = 4 * 60 * 60 * 1000;

function log(msg) { console.error(`[gusto-login ${new Date().toISOString()}] ${msg}`); }

function alert(title, message) {
  try {
    fs.mkdirSync(path.dirname(ALERTS), { recursive: true });
    fs.appendFileSync(ALERTS, JSON.stringify({ ts: new Date().toISOString(), title, message }) + '\n');
  } catch { /* best effort */ }
  try {
    execFileSync('osascript', ['-e', `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
  } catch { /* best effort */ }
}

function creds() {
  try {
    const meta = execFileSync('security', ['find-generic-password', '-s', SERVICE], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const m = meta.match(/"acct"<blob>="([^"]+)"/);
    const password = execFileSync('security', ['find-generic-password', '-s', SERVICE, '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).replace(/\n$/, '');
    if (!m || !password) return null;
    return { email: m[1], password };
  } catch { return null; }
}

async function visible(loc) { try { return await loc.first().isVisible({ timeout: 1500 }); } catch { return false; } }

async function classify(page) {
  const url = page.url();
  const body = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).toLowerCase();
  if (await visible(page.locator('iframe[src*="captcha"], iframe[title*="challenge" i]')) || /verify you are (a )?human|captcha/.test(body)) return 'captcha';
  if (await visible(page.locator('input[name="deliveryMethod"], input[type="radio"][name*="method" i]'))) return 'choose_method';
  if (await visible(page.locator('input[autocomplete="one-time-code"]')) || /verification code|enter the code|we (just )?sent (you )?a code|text message|2-step/.test(body)) return 'needs_code';
  if (await visible(page.locator('input[type="password"]')) || await visible(page.locator('input[type="email"], input[name*="email" i]'))) return 'login_form';
  if (await visible(page.getByRole('button', { name: /use another email/i }))) return 'chooser';
  if (/^https:\/\/app\.gusto\.com\//.test(url) && !/login|sign_in|signin/.test(url)) return 'signed_in';
  return 'unknown';
}

// Page fingerprint for the log: URL without query, title, and the KINDS of fields and
// button labels on the page. Never field values.
async function describe(page) {
  const u = page.url().split('?')[0];
  const t = await page.title().catch(() => '');
  const fields = await page.$$eval('input', els => els.filter(e => e.offsetParent !== null)
    .map(e => `${e.type}${e.name ? ':' + e.name : ''}${e.autocomplete ? '/' + e.autocomplete : ''}`).slice(0, 8)).catch(() => []);
  const buttons = await page.$$eval('button', els => els.filter(e => e.offsetParent !== null)
    .map(e => (e.innerText || '').trim().slice(0, 30)).filter(Boolean).slice(0, 8)).catch(() => []);
  return `url=${u} title="${t}" inputs=[${fields.join(',')}] buttons=[${buttons.join('|')}]`;
}

async function clickSubmit(page) {
  const btn = page.getByRole('button', { name: /^(continue|next|sign in|log in|submit)$/i });
  if (await visible(btn)) { await btn.first().click(); return true; }
  await page.keyboard.press('Enter');
  return true;
}


// Gusto's 2-step page first asks HOW to send the code (radio deliveryMethod). Pick text
// message, press Continue so the code is actually sent, then pre-tick "remember this
// device" if Gusto offers it. Returns the state afterwards.
async function requestSmsCode(page) {
  const radios = page.locator('input[name="deliveryMethod"], input[type="radio"][name*="method" i]');
  const n = await radios.count();
  let picked = -1;
  for (let i = 0; i < n; i++) {
    const r = radios.nth(i);
    const label = await r.evaluate((el) => {
      const l = (el.id && document.querySelector(`label[for="${el.id}"]`)) || el.closest('label') || el.parentElement;
      return ((l && l.innerText) || el.value || '').toLowerCase();
    }).catch(() => '');
    if (/text|sms/.test(label)) { picked = i; break; }
  }
  if (picked < 0) picked = 0;
  await radios.nth(picked).check({ force: true }).catch(async () => { await radios.nth(picked).click({ force: true }); });
  await clickSubmit(page);
  await page.waitForTimeout(6000);
  const remember = page.getByRole('checkbox', { name: /remember|trust|don.t ask/i });
  if (await visible(remember)) { await remember.first().check().catch(() => {}); log('ticked "remember this device"'); }
  return classify(page);
}

/** An earlier run already left the code page open: keep it, send nothing new. */
async function findPendingCodePage(context) {
  for (const p of context.pages()) {
    if (!/login\.gusto\.com/.test(p.url())) continue;
    const st = await classify(p).catch(() => 'unknown');
    if (st === 'needs_code' || st === 'choose_method') return { page: p, state: st };
  }
  return null;
}

(async () => {
  let browser;
  try { browser = await chromium.connectOverCDP(CDP, { timeout: 10000 }); }
  catch (e) { log(`no browser on ${CDP}: ${e.message}`); process.exit(16); }
  const context = browser.contexts()[0];
  const pending = await findPendingCodePage(context);
  if (pending) {
    log(`code page still open from an earlier run (${pending.state}) — waiting for Robert, nothing re-sent`);
    let last = 0; try { last = fs.statSync(CODE_REQUESTED).mtimeMs; } catch {}
    if (Date.now() - last > REMIND_MS) {
      alert('Gusto agent: still waiting for the code', 'The Gusto Chrome window on the Mac mini is still on the 2-step code page. Enter the code there (tick Remember this device). New reps wait until then.');
      try { fs.writeFileSync(CODE_REQUESTED, 'remind'); } catch {}
    }
    await browser.close().catch(() => {});
    log('exit 10');
    process.exit(10);
  }
  const page = await context.newPage();
  let code = 15;
  try {
    await page.goto('https://app.gusto.com/u/companies', { waitUntil: 'domcontentloaded', timeout: 30000 });
    let state = 'unknown';
    for (let i = 0; i < 10 && state === 'unknown'; i++) {
      await page.waitForTimeout(2000);
      state = await classify(page);
    }
    log(`state on arrival: ${state} (${await describe(page)})`);

    if (state === 'choose_method') {
      state = await requestSmsCode(page);
      log(`after requesting the code: ${state} (${await describe(page)})`);
      if (state === 'choose_method') state = 'needs_code';
      if (state === 'needs_code') try { fs.writeFileSync(CODE_REQUESTED, 'new'); } catch {}
    }

    if (state === 'login_form' || state === 'chooser') {
      try {
        const last = Number(fs.readFileSync(STAMP, 'utf8'));
        if (Date.now() - last < COOLDOWN_MS) { log('cooldown: last sign-in attempt < 60 min ago'); code = 13; throw 'done'; }
      } catch (e) { if (e === 'done') throw e; }
      const c = creds();
      if (!c) { log('no Keychain item "gusto-agent"'); code = 11; throw 'done'; }
      fs.writeFileSync(STAMP, String(Date.now()));

      // Gusto's account chooser: "robert@… | Use another email". Pick the saved account
      // that matches the Keychain email; otherwise fall through to the email form.
      if (state === 'chooser') {
        const saved = page.getByRole('button', { name: new RegExp('^\\s*' + c.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*$', 'i') });
        if (await visible(saved)) await saved.first().click();
        else await page.getByRole('button', { name: /use another email/i }).first().click();
        await page.locator('input[type="password"], input[type="email"], input[name*="email" i]').first()
          .waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        log(`after chooser: ${await describe(page)}`);
      }

      const email = page.locator('input[type="email"], input[name*="email" i], input[autocomplete="username"]');
      if (await visible(email)) {
        await email.first().fill(c.email);
        if (!(await visible(page.locator('input[type="password"]')))) {
          await clickSubmit(page);
          await page.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
        }
      }
      const pw = page.locator('input[type="password"]');
      if (!(await visible(pw))) { log('password field never appeared'); state = await classify(page); }
      else {
        await pw.first().fill(c.password);
        await clickSubmit(page);
        await page.waitForTimeout(8000);
        state = await classify(page);
        if (state === 'login_form' || state === 'chooser') {
          const body = (await page.locator('body').innerText().catch(() => '')).toLowerCase();
          log(/incorrect|invalid|wrong|locked|try again/.test(body) ? 'sign-in rejected by Gusto' : 'still on the sign-in form after submit');
          code = 12; throw 'done';
        }
      }
      log(`state after sign-in: ${state} (${await describe(page)})`);
      if (state === 'choose_method') {
        state = await requestSmsCode(page);
        log(`after requesting the code: ${state} (${await describe(page)})`);
        if (state === 'choose_method') state = 'needs_code';
        if (state === 'needs_code') try { fs.writeFileSync(CODE_REQUESTED, 'new'); } catch {}
      }
    }

    if (state === 'signed_in') {
      code = 0;
      // The cooldown only protects against repeated FAILED attempts.
      try { fs.unlinkSync(STAMP); } catch { /* none */ }
    }
    else if (state === 'needs_code') {
      code = 10;
      alert('Gusto agent: code needed', 'Gusto texted a code to your phone. Enter it in the Gusto Chrome window on the Mac mini and tick Remember this device. The agent waits on that page and sends nothing new; nothing was added.');
    } else if (state === 'captcha') {
      code = 14;
      alert('Gusto agent: human check', 'Gusto is showing a bot/CAPTCHA check in the Gusto Chrome window on the Mac mini.');
    } else { code = 15; log(`unrecognised page: ${await describe(page)}`); }
  } catch (e) {
    if (e !== 'done') log(`error: ${e && e.message ? e.message : e}`);
  } finally {
    if (code === 12) alert('Gusto agent: sign-in rejected', 'Gusto rejected the saved password. Update it in Keychain (service gusto-agent). The agent will not retry on its own.');
    if (code !== 10 && code !== 14) await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  log(`exit ${code}`);
  process.exit(code);
})();
