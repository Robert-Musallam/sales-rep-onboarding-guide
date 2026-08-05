import { config } from "dotenv";
import path from "node:path";

/**
 * Worker env. Loads .env.local from the repo root (same file the webapp dev
 * server uses) so there is exactly one place secrets live on a machine.
 * launchd EnvironmentVariables win over the file (dotenv never overrides).
 */
config({ path: path.join(__dirname, "..", ".env.local") });

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const ENV = {
  supabaseUrl: () => req("NEXT_PUBLIC_SUPABASE_URL"),
  serviceRoleKey: () => req("SUPABASE_SERVICE_ROLE_KEY"),
  appBaseUrl: () => process.env.APP_BASE_URL ?? "http://localhost:3000",

  msTenantId: () => req("MS_TENANT_ID"),
  msClientId: () => req("MS_CLIENT_ID"),
  msClientSecret: () => req("MS_CLIENT_SECRET"),

  dialpadApiKey: () => req("DIALPAD_API_KEY"),
  dialpadBaseUrl: () => process.env.DIALPAD_BASE_URL ?? "https://dialpad.com/api/v2",

  jotformApiKey: () => req("JOTFORM_API_KEY"),
  jotformBaseUrl: () => process.env.JOTFORM_BASE_URL ?? "https://api.jotform.com",

  hcpDefaultApiKey: () => process.env.HCP_API_KEY ?? "",
  hcpBaseUrl: () => process.env.HCP_BASE_URL ?? "https://api.housecallpro.com",

  slackWebhookUrl: () => process.env.SLACK_WEBHOOK_URL ?? "",
};

/**
 * Send-gate stack, inherited from the leasing daemon:
 *  - dry-run is the DEFAULT: nothing leaves the building unless
 *    RNB_AUTOMATION_MODE=send_enabled
 *  - RNB_GLOBAL_KILL_SWITCH=1 stops all sends regardless of mode
 *  - PILOT_SEND_ONLY=1 restricts recipients to the comma-separated allowlists
 *    PILOT_ALLOWED_PHONES / PILOT_ALLOWED_EMAILS (Teams sends are allowed in
 *    pilot mode only when PILOT_ALLOW_TEAMS=1 — chat ids aren't allowlistable)
 */
export type GateVerdict = { allowed: true } | { allowed: false; reason: string };

export function gate(kind: "sms" | "email" | "teams" | "provision", recipient?: string): GateVerdict {
  if (process.env.RNB_GLOBAL_KILL_SWITCH === "1") {
    return { allowed: false, reason: "kill_switch" };
  }
  if (process.env.RNB_AUTOMATION_MODE !== "send_enabled") {
    return { allowed: false, reason: "dry_run (RNB_AUTOMATION_MODE != send_enabled)" };
  }
  if (process.env.PILOT_SEND_ONLY === "1") {
    if (kind === "sms") {
      const allowed = (process.env.PILOT_ALLOWED_PHONES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const digits = (recipient ?? "").replace(/\D/g, "").slice(-10);
      if (!allowed.some((a) => a.replace(/\D/g, "").slice(-10) === digits)) {
        return { allowed: false, reason: `pilot: phone ${recipient} not in PILOT_ALLOWED_PHONES` };
      }
    }
    if (kind === "email") {
      const allowed = (process.env.PILOT_ALLOWED_EMAILS ?? "")
        .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (!allowed.includes((recipient ?? "").toLowerCase())) {
        return { allowed: false, reason: `pilot: email ${recipient} not in PILOT_ALLOWED_EMAILS` };
      }
    }
    if (kind === "teams" && process.env.PILOT_ALLOW_TEAMS !== "1") {
      return { allowed: false, reason: "pilot: Teams sends disabled (set PILOT_ALLOW_TEAMS=1)" };
    }
    if (kind === "provision" && process.env.PILOT_ALLOW_PROVISION !== "1") {
      return { allowed: false, reason: "pilot: provisioning disabled (set PILOT_ALLOW_PROVISION=1)" };
    }
  }
  return { allowed: true };
}
