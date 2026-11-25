// Pre-run check for the agents' Chrome (:9336): the page must be visible and drawing.
// A minimized/hidden window reports document.visibilityState 'hidden' and never runs
// requestAnimationFrame, so every click then times out ("waiting for element to be visible,
// enabled and stable") even though reading pages still works (2026-11-25, rep 41).
//
// If hidden: ask Chrome to restore the window (CDP Browser.setWindowBounds windowState 'normal')
// and bring the tab to front, then check again. It never clicks, types or navigates.
//
//   node gusto-agent/preflight-visible.js            check and, if hidden, try to restore
//   node gusto-agent/preflight-visible.js --check    read-only: only report
//
// Exit: 0 visible · 30 still hidden (do NOT start the agent) · 31 could not check (callers go on)
const { chromium } = require('playwright-core');
const CDP = process.env.GUSTO_CDP_URL || 'http://127.0.0.1:9336';
const CHECK_ONLY = process.argv.includes('--check');

async function drawing(page) {
  try {
    const vis = await page.evaluate(() => document.visibilityState);
    const raf = await Promise.race([
      page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(true)))),
      new Promise((r) => setTimeout(() => r(false), 2000)),
    ]);
    return { vis, raf, ok: vis === 'visible' && raf === true };
  } catch (e) {
    return { vis: 'error', raf: false, ok: false };
  }
}

(async () => {
  let b;
  try { b = await chromium.connectOverCDP(CDP, { timeout: 10000 }); }
  catch (e) { console.error('[preflight] cannot reach Chrome on', CDP, String(e.message || e).split('\n')[0]); process.exit(31); }
  const ctx = b.contexts()[0];
  const page = ctx && (ctx.pages()[0] || null);
  if (!page) { console.error('[preflight] no tab to check'); await b.close().catch(() => {}); process.exit(31); }

  let s = await drawing(page);
  console.error(`[preflight] visibility=${s.vis} rAF=${s.raf ? 'fires' : 'NO'}`);
  if (!s.ok && !CHECK_ONLY) {
    try {
      const cdp = await ctx.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
      await page.bringToFront();
      await page.waitForTimeout(1200);
      s = await drawing(page);
      console.error(`[preflight] after restore attempt: visibility=${s.vis} rAF=${s.raf ? 'fires' : 'NO'}`);
    } catch (e) {
      console.error('[preflight] restore attempt failed:', String(e.message || e).split('\n')[0]);
    }
  }
  await b.close().catch(() => {});
  process.exit(s.ok ? 0 : 30);
})();
