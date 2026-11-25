/**
 * Daily session check for the agents' Chrome (~/chrome-gusto, :9336).
 *
 * Read-only: opens each site the agents use in a NEW tab, decides signed in or
 * not from where the page lands, closes the tab. Never types, clicks or signs in.
 * Alerts only when something is wrong, so a quiet day means all four sessions are
 * alive. Where: the GCV #monitor Slack channel (same bot, channel and token source as
 * appfolio-pipeline/monitor/collect_kanban.js: Vault secret slack_ops_bot_token read
 * through ~/appfolio-pipeline/config/.env DATABASE_URL, nothing copied), plus
 * worker/logs/alerts.log and a Mac notification. Teams to Robert (worker/notify.ts) is
 * tried too; it fails 401 today and starts working once that is fixed.
 *
 *   npx tsx gusto-agent/check-sessions.ts            check + alert on problems
 *   npx tsx gusto-agent/check-sessions.ts --quiet    dry run: check and print, send nothing
 *
 * Exit: 0 all signed in · 1 at least one signed out · 2 Chrome not usable · 3 skipped (agent run in progress)
 * Started daily at 08:00 by launchd (ops/com.rnb.check-sessions.plist), wrapped in an external kill.
 */
import { existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { alert } from "../worker/alert";
import { notifyRobert } from "../worker/notify";
import { postMonitor } from "../worker/monitor-post";

const req = createRequire(path.join(__dirname, "package.json"));
const { chromium } = req("playwright-core") as typeof import("playwright-core");


const CDP = process.env.GUSTO_CDP_URL || "http://127.0.0.1:9336";
const RUN_LOCK = path.join(__dirname, ".run.lock");
const QUIET = process.argv.includes("--quiet");

type Check = { name: string; url: string; signedIn: (url: string) => boolean; wait?: "m365" };
const SITES: Check[] = [
  { name: "Gusto", url: "https://app.gusto.com/u/companies", signedIn: (u) => /app\.gusto\.com/.test(u) && !/login/.test(u) },
  { name: "Microsoft 365", url: "https://admin.cloud.microsoft/#/users", signedIn: () => false, wait: "m365" },
  { name: "Holding OS", url: "https://gcv-renewals.vercel.app/rnb/reps", signedIn: (u) => !/\/login/.test(u) },
  // Only /app/log_in is the sign-in page; /app/settings/login_authentication is a signed-in settings page.
  { name: "Housecall Pro", url: "https://pro.housecallpro.com/app/settings/employees", signedIn: (u) => /pro\.housecallpro\.com\/app\//.test(u) && !/\/app\/log_in/.test(u) },
];

function macNotify(title: string, message: string) {
  try {
    execFileSync("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`]);
  } catch { /* best effort */ }
}

async function report(title: string, lines: string[]) {
  const message = lines.join("\n");
  console.log(`${title}\n${message}`);
  if (QUIET) return;
  await alert(title, message);
  macNotify(title, lines[0] ?? "");
  console.log(await postMonitor(`:rotating_light: *RNB onboarding agents — ${title}*\n${lines.map((l) => `• ${l}`).join("\n")}`));
  console.log(await notifyRobert(`${title}\n${message}`));
}

const FIX =
  "Fix: on the Mac mini, in the agents' Chrome window (profile ~/chrome-gusto), sign in again. " +
  "If that Chrome is not open: bash ~/rnb-onboarding/gusto-agent/chrome-gusto.sh signin";

async function main() {
  // An agent run owns the browser; checking now could close its tab via tidy-tabs races. Try tomorrow.
  if (existsSync(RUN_LOCK) && Date.now() - statSync(RUN_LOCK).mtimeMs < 45 * 60_000) {
    console.log("skipped: an agent run holds .run.lock");
    process.exit(3);
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(CDP, { timeout: 15000 });
  } catch (e) {
    await report("Agents' Chrome not usable", [
      `Could not connect to ${CDP}: ${String((e as Error).message).split("\n")[0].slice(0, 160)}`,
      "Gusto, M365 and HCP agents will all fail until it is reopened.",
      "Fix: bash ~/rnb-onboarding/gusto-agent/chrome-gusto.sh stop && bash ~/rnb-onboarding/gusto-agent/chrome-gusto.sh signin, then sign in to the four sites.",
    ]);
    process.exit(2);
  }

  const ctx = browser.contexts()[0];
  const results: { name: string; ok: boolean; detail: string }[] = [];
  for (const s of SITES) {
    const page = await ctx.newPage();
    const t0 = Date.now();
    try {
      await page.goto(s.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      let ok: boolean;
      if (s.wait === "m365") {
        await page.waitForURL((u) => !/login\.microsoftonline\.com/.test(String(u)), { timeout: 60000 }).catch(() => {});
        ok = await page.getByRole("searchbox").first().waitFor({ state: "visible", timeout: 90000 }).then(() => true, () => false);
      } else {
        await page.waitForTimeout(8000);
        ok = s.signedIn(page.url());
      }
      results.push({ name: s.name, ok, detail: `${((Date.now() - t0) / 1000).toFixed(1)}s ${page.url().split("?")[0].slice(0, 80)}` });
    } catch (e) {
      results.push({ name: s.name, ok: false, detail: `error: ${String((e as Error).message).split("\n")[0].slice(0, 120)}` });
    } finally {
      await page.close().catch(() => {});
    }
  }
  await browser.close().catch(() => {});

  for (const r of results) console.log(`${r.ok ? "OK " : "OUT"} ${r.name} — ${r.detail}`);
  const out = results.filter((r) => !r.ok);
  if (!out.length) process.exit(0);
  await report(`Agents' Chrome: signed out of ${out.map((r) => r.name).join(", ")}`, [
    ...out.map((r) => `${r.name}: not signed in (${r.detail})`),
    FIX,
  ]);
  process.exit(1);
}

main().catch(async (e) => {
  console.error("check-sessions failed:", e);
  if (!QUIET) await alert("Session check crashed", String((e as Error)?.message ?? e)).catch(() => {});
  process.exit(2);
});
