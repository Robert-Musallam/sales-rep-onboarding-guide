/** Smoke test: Jotform API key + form visibility. */
import { ENV } from "../worker/env";
import { whoAmI } from "../worker/connectors/jotform";
import { getSetting } from "../worker/db";

async function main() {
  const user = await whoAmI();
  console.log(`✅ Jotform key OK (user: ${user})`);
  const formId = (await getSetting<string>("jotform_info_form_id")) ?? "";
  const res = await fetch(`${ENV.jotformBaseUrl()}/form/${formId}?apiKey=${ENV.jotformApiKey()}`);
  if (!res.ok) throw new Error(`info form ${formId} not visible: ${res.status}`);
  const j = (await res.json()) as { content?: { title?: string; status?: string } };
  console.log(`✅ info form ${formId}: "${j.content?.title}" (${j.content?.status})`);
}

main().catch((e) => {
  console.error("❌", e.message ?? e);
  process.exit(1);
});
