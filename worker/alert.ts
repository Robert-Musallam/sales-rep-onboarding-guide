import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { ENV } from "./env";

/**
 * Failure alerting — a slim port of appfolio-pipeline/lib/alert.js.
 * Always logs to worker/logs/alerts.log; posts to SLACK_WEBHOOK_URL when set
 * (optional — the Settings health panel reads outbox failures regardless).
 */
const LOG_DIR = path.join(__dirname, "logs");

export async function alert(title: string, message: string): Promise<void> {
  const line = JSON.stringify({ ts: new Date().toISOString(), title, message });
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path.join(LOG_DIR, "alerts.log"), line + "\n");
  } catch {
    // best effort
  }
  const hook = ENV.slackWebhookUrl();
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `🚨 *rnb-onboarding* — ${title}\n${message}` }),
    });
  } catch (e) {
    console.error("slack alert failed:", e);
  }
}
