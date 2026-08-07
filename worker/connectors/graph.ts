import { randomBytes } from "node:crypto";
import { ENV } from "../env";
import { db, ONBOARDING } from "../db";
import { decryptToken, encryptToken } from "../../lib/tokenCrypto";

/**
 * Microsoft Graph connector.
 *
 * Two token paths (mirrors what the Make scenario did):
 *  - APP-ONLY (client credentials): user creation, sendMail, chat creation,
 *    chat-member adds. Same app registration the Make scenario used.
 *  - DELEGATED (refresh token from onboarding.oauth_tokens, consented once via
 *    /settings → Connections): chat MESSAGE sends — Graph refuses app-only
 *    chat messages, they must come from a real user (rmusallam today).
 */
const GRAPH = "https://graph.microsoft.com/v1.0";

let appToken: { token: string; exp: number } | null = null;

export async function getAppToken(): Promise<string> {
  if (appToken && appToken.exp > Date.now() + 60_000) return appToken.token;
  const res = await fetch(`https://login.microsoftonline.com/${ENV.msTenantId()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ENV.msClientId(),
      client_secret: ENV.msClientSecret(),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`graph app token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  appToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return appToken.token;
}

/** Delegated access token via the stored (encrypted) refresh token. Rotates the refresh token on every use. */
export async function getDelegatedToken(): Promise<string> {
  const { data } = await db()
    .schema(ONBOARDING)
    .from("oauth_tokens")
    .select("refresh_token_enc")
    .eq("provider", "microsoft-delegated")
    .maybeSingle();
  if (!data) {
    throw new Error("No delegated Microsoft token stored — run the one-time consent at /settings (Connections)");
  }
  const refresh = decryptToken(data.refresh_token_enc);
  const res = await fetch(`https://login.microsoftonline.com/${ENV.msTenantId()}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: ENV.msClientId(),
      client_secret: ENV.msClientSecret(),
      grant_type: "refresh_token",
      refresh_token: refresh,
      scope: "offline_access openid profile https://graph.microsoft.com/Chat.ReadWrite",
    }),
  });
  if (!res.ok) throw new Error(`graph delegated token: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string };
  if (j.refresh_token) {
    await db()
      .schema(ONBOARDING)
      .from("oauth_tokens")
      .update({ refresh_token_enc: encryptToken(j.refresh_token) })
      .eq("provider", "microsoft-delegated");
  }
  return j.access_token;
}

async function graphFetch(token: string, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function must(res: Response, what: string): Promise<Record<string, unknown>> {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

// ── Users ────────────────────────────────────────────────────────────────────

export function generateTempPassword(): string {
  // 16 chars, mixed classes — replaces the Make scenario's static "Temporary_password".
  return `Rnb-${randomBytes(6).toString("base64url")}-${Math.floor(Math.random() * 90 + 10)}!`;
}

export async function createUser(opts: {
  firstName: string;
  lastName: string;
  domain: string;
}): Promise<{ userId: string; upn: string; tempPassword: string }> {
  const token = await getAppToken();
  const mailNickname = `${opts.firstName[0]}${opts.lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  const upn = `${mailNickname}@${opts.domain}`;
  const tempPassword = generateTempPassword();
  const res = await graphFetch(token, "/users", {
    method: "POST",
    body: JSON.stringify({
      accountEnabled: true,
      displayName: `${opts.firstName[0]}${opts.lastName}`,
      givenName: opts.firstName,
      surname: opts.lastName,
      mailNickname,
      userPrincipalName: upn,
      passwordProfile: { password: tempPassword, forceChangePasswordNextSignIn: true },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    // 400/409 (e.g. UPN already exists) won't fix itself — fail fast so the
    // full Graph error surfaces in the drawer immediately instead of after
    // five backoff retries.
    const prefix = res.status === 400 || res.status === 409 ? "PERMANENT: " : "";
    throw new Error(`${prefix}graph createUser (upn ${upn}): ${res.status} ${text}`);
  }
  const j = (await res.json()) as { id: string };
  return { userId: j.id, upn, tempPassword };
}

export async function findUserByUpn(upn: string): Promise<{ id: string } | null> {
  const token = await getAppToken();
  const res = await graphFetch(token, `/users/${encodeURIComponent(upn)}?$select=id`);
  if (res.status === 404) return null;
  const j = await must(res, "graph findUser");
  return { id: j.id as string };
}

// ── Mail ─────────────────────────────────────────────────────────────────────

export async function sendMail(opts: {
  fromUpn: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
}): Promise<void> {
  const token = await getAppToken();
  const addr = (a: string) => ({ emailAddress: { address: a } });
  await must(
    await graphFetch(token, `/users/${encodeURIComponent(opts.fromUpn)}/sendMail`, {
      method: "POST",
      body: JSON.stringify({
        message: {
          subject: opts.subject,
          body: { contentType: "HTML", content: opts.html },
          toRecipients: opts.to.map(addr),
          ccRecipients: (opts.cc ?? []).map(addr),
          bccRecipients: (opts.bcc ?? []).map(addr),
        },
        saveToSentItems: "true",
      }),
    }),
    "graph sendMail",
  );
}

// ── Chats ────────────────────────────────────────────────────────────────────

const member = (idOrUpn: string) => ({
  "@odata.type": "#microsoft.graph.aadUserConversationMember",
  roles: ["owner"],
  "user@odata.bind": `https://graph.microsoft.com/v1.0/users('${idOrUpn}')`,
});

export async function createOneOnOneChat(userA: string, userB: string): Promise<string> {
  const token = await getAppToken();
  const j = await must(
    await graphFetch(token, "/chats", {
      method: "POST",
      body: JSON.stringify({ chatType: "oneOnOne", members: [member(userA), member(userB)] }),
    }),
    "graph create 1:1 chat",
  );
  return j.id as string;
}

export async function createGroupChat(topic: string, memberIds: string[]): Promise<string> {
  const token = await getAppToken();
  const j = await must(
    await graphFetch(token, "/chats", {
      method: "POST",
      body: JSON.stringify({ chatType: "group", topic, members: memberIds.map(member) }),
    }),
    "graph create group chat",
  );
  return j.id as string;
}

/** Add a member to an existing chat. 409/400-conflict (already a member) is treated as success. */
export async function addChatMember(chatId: string, userId: string): Promise<void> {
  const token = await getAppToken();
  const res = await graphFetch(token, `/chats/${chatId}/members`, {
    method: "POST",
    body: JSON.stringify(member(userId)),
  });
  if (res.status === 409) return;
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("already exists") || text.includes("Duplicate")) return;
    throw new Error(`graph addChatMember: ${res.status} ${text}`);
  }
}

/** Chat message sends require DELEGATED auth — they come from the consented human account. */
export async function sendChatMessage(chatId: string, html: string): Promise<void> {
  const token = await getDelegatedToken();
  await must(
    await graphFetch(token, `/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body: { contentType: "html", content: html } }),
    }),
    "graph sendChatMessage",
  );
}
