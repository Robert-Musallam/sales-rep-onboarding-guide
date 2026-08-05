import { NextResponse } from "next/server";
import { requireUser, ActionError } from "@/lib/os/entity";
import { createAdminClient } from "@/lib/os/supabase/admin";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import { encryptToken } from "@/lib/tokenCrypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/microsoft/callback — exchanges the auth code, stores the
 * ENCRYPTED refresh token in onboarding.oauth_tokens (service role — the table
 * is invisible to the browser session), and bounces back to Settings.
 */
export async function GET(req: Request) {
  try {
    await requireUser();
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (!code) throw new ActionError(`Consent failed: ${url.searchParams.get("error_description") ?? "no code"}`);

    const redirect = `${process.env.APP_BASE_URL ?? url.origin}/api/oauth/microsoft/callback`;
    const res = await fetch(
      `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: process.env.MS_CLIENT_ID!,
          client_secret: process.env.MS_CLIENT_SECRET!,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirect,
        }),
      },
    );
    if (!res.ok) throw new ActionError(`Token exchange failed: ${await res.text()}`, 500);
    const j = (await res.json()) as { refresh_token?: string; access_token?: string; scope?: string };
    if (!j.refresh_token) throw new ActionError("No refresh token returned (offline_access missing?)", 500);

    // Who consented? (label shown in Settings)
    let upn = "unknown";
    if (j.access_token) {
      const me = await fetch("https://graph.microsoft.com/v1.0/me?$select=userPrincipalName", {
        headers: { Authorization: `Bearer ${j.access_token}` },
      });
      if (me.ok) upn = ((await me.json()) as { userPrincipalName?: string }).userPrincipalName ?? "unknown";
    }

    const admin = createAdminClient();
    const { error } = await admin
      .schema(ONBOARDING_SCHEMA)
      .from("oauth_tokens")
      .upsert(
        {
          provider: "microsoft-delegated",
          account_label: upn,
          refresh_token_enc: encryptToken(j.refresh_token),
          scopes: j.scope ?? null,
        },
        { onConflict: "provider" },
      );
    if (error) throw new ActionError(error.message, 500);

    return NextResponse.redirect(`${process.env.APP_BASE_URL ?? url.origin}/settings?connected=microsoft`);
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
