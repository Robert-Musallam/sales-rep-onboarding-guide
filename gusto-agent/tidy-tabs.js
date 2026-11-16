// Chrome now stays open between runs, so tabs from earlier runs would pile up.
// Close leftover tabs before a run, but never a Gusto sign-in/code page (Robert may be
// mid-code) or the green marker tab; always leave at least one tab so the window stays.
const { chromium } = require('playwright-core');
(async () => {
  let b;
  try { b = await chromium.connectOverCDP(process.env.GUSTO_CDP_URL || 'http://127.0.0.1:9336', { timeout: 10000 }); } catch { process.exit(0); }
  const pages = b.contexts()[0].pages();
  const keep = (p) => /login\.gusto\.com|marker\.html/.test(p.url());
  let closed = 0;
  const closable = pages.filter((p) => !keep(p));
  const leaveOne = pages.length === closable.length ? 1 : 0;
  for (const p of closable.slice(leaveOne)) { await p.close().catch(() => {}); closed++; }
  console.error(`[tidy-tabs] ${pages.length} tab(s), closed ${closed}`);
  await b.close().catch(() => {});
})();
