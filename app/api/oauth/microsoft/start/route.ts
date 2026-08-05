import { NextResponse } from "next/server";
import { requireUser, ActionError } from "@/lib/os/entity";

export const dynamic = "force-dynamic";

/**
 * GET /api/oauth/microsoft/start — kicks off the ONE-TIME delegated consent so
 * the worker can send Teams chat messages as a real user (the same identity
 * Make used). Sign into the RNB Microsoft account that should appear as the
 * sender when the consent screen opens.
 */
export async function GET(req: Request) {
  try {
    await requireUser();
    const clientId = process.env.MS_CLIENT_ID;
    const tenant = process.env.MS_TENANT_ID;
    if (!clientId || !tenant) throw new ActionError("MS_CLIENT_ID / MS_TENANT_ID not configured", 500);

    const origin = new URL(req.url).origin;
    const redirect = `${process.env.APP_BASE_URL ?? origin}/api/oauth/microsoft/callback`;
    const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("redirect_uri", redirect);
    url.searchParams.set("response_mode", "query");
    url.searchParams.set(
      "scope",
      "offline_access openid profile https://graph.microsoft.com/Chat.ReadWrite",
    );
    url.searchParams.set("prompt", "select_account");
    return NextResponse.redirect(url);
  } catch (e) {
    if (e instanceof ActionError) return NextResponse.json({ error: e.message }, { status: e.status });
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}
