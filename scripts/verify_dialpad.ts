/**
 * Smoke test: Dialpad API key (+ optional live SMS).
 *   npm run verify:dialpad                          — key check only
 *   npm run verify:dialpad -- --to +17025550123     — send a real test text
 */
import { ENV } from "../worker/env";
import { sendSms } from "../worker/connectors/dialpad";
import { getSetting } from "../worker/db";

async function main() {
  const res = await fetch(`${ENV.dialpadBaseUrl()}/company`, {
    headers: { Authorization: `Bearer ${ENV.dialpadApiKey()}` },
  });
  if (!res.ok) throw new Error(`key check failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { name?: string };
  console.log(`✅ Dialpad key OK (company: ${j.name ?? "unknown"})`);

  const toIdx = process.argv.indexOf("--to");
  if (toIdx > -1) {
    const to = process.argv[toIdx + 1];
    const from = (await getSetting<string>("dialpad_from_number")) ?? "";
    await sendSms({ from, to, text: "RNB Onboarding — Dialpad smoke test. It works. 🎉" });
    console.log(`✅ test SMS sent ${from} → ${to}`);
  }
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
