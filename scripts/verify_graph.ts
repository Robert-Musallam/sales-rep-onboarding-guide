/**
 * Smoke test: Microsoft Graph app credentials (+ optional live sends).
 *   npm run verify:graph                       — token + org read only
 *   npm run verify:graph -- --mail you@x.com   — also send a test email
 * Uses the configured welcome_email_sender as the from-mailbox for --mail.
 */
import { getAppToken, sendMail, getDelegatedToken } from "../worker/connectors/graph";
import { getSetting } from "../worker/db";

async function main() {
  const token = await getAppToken();
  console.log("✅ app token acquired");

  const org = await fetch("https://graph.microsoft.com/v1.0/organization?$select=displayName", {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(org.ok ? `✅ org read: ${JSON.stringify((await org.json()).value?.[0])}` : `❌ org read: ${org.status}`);

  try {
    await getDelegatedToken();
    console.log("✅ delegated token OK (Teams sends will work)");
  } catch (e) {
    console.log(`⚠️  delegated token: ${e instanceof Error ? e.message : e}`);
  }

  const mailIdx = process.argv.indexOf("--mail");
  if (mailIdx > -1) {
    const to = process.argv[mailIdx + 1];
    const sender = (await getSetting<string>("welcome_email_sender")) ?? "";
    if (!sender) throw new Error("Set welcome_email_sender in Settings first");
    await sendMail({ fromUpn: sender, to: [to], subject: "RNB Onboarding — Graph smoke test", html: "<p>It works. 🎉</p>" });
    console.log(`✅ test email sent ${sender} → ${to}`);
  }
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
