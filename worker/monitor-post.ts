import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

/**
 * Post to the GCV #monitor Slack channel. Shared by gusto-agent/check-sessions.ts and the
 * agent result recorders (worker/agent-report.ts). Moved here unchanged from check-sessions.ts.
 */
// #monitor, same as appfolio-pipeline/monitor/collect_kanban.js and ops-agent/watchdog.js.
const MONITOR_CHANNEL = process.env.OPS_SLACK_CHANNEL || "C0C0KKCBW20";
const PIPELINE = path.join(os.homedir(), "appfolio-pipeline");

/** DATABASE_URL from appfolio-pipeline's config/.env, read in place (never copied or printed). */
function pipelineDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    for (const l of readFileSync(path.join(PIPELINE, "config", ".env"), "utf8").split("\n")) {
      const m = l.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, "");
    }
  } catch { /* no file */ }
  return "";
}

/**
 * Post to #monitor the way collect_kanban.js does: bot token from Vault
 * (slack_ops_bot_token), else ~/.config/ops-watchdog/slack_ops_bot_token; chat.postMessage.
 * Never throws; returns what happened.
 */
export async function postMonitor(text: string): Promise<string> {
  let token = "";
  const url = pipelineDatabaseUrl();
  if (url) {
    try {
      const { Client } = createRequire(path.join(PIPELINE, "package.json"))("pg");
      // On the Mac mini DATABASE_URL points at the local pgbouncer (127.0.0.1:6432), which
      // speaks no SSL; asking for SSL there fails and the alert silently never posted.
      const local = /@(127\.0\.0\.1|localhost)[:/]/.test(url);
      const c = new Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
      c.on("error", () => {});
      await c.connect();
      try {
        const r = await c.query(`select decrypted_secret from vault.decrypted_secrets where name = 'slack_ops_bot_token'`);
        token = r.rows[0]?.decrypted_secret ?? "";
      } finally { await c.end().catch(() => {}); }
    } catch { /* fall back to the file */ }
  }
  if (!token) {
    try { token = readFileSync(path.join(os.homedir(), ".config", "ops-watchdog", "slack_ops_bot_token"), "utf8").trim(); } catch { /* none */ }
  }
  if (!token) return "#monitor: no Slack token (Vault or file) — not posted";
  try {
    const r = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: MONITOR_CHANNEL, text }),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return j.ok ? "#monitor: posted" : `#monitor: Slack error ${j.error ?? r.status}`;
  } catch (e) {
    return `#monitor: post failed (${String((e as Error).message ?? e).slice(0, 120)})`;
  }
}
