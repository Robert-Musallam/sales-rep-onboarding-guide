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

/**
 * The temp password every new rep gets. Deliberately STATIC and shared: the
 * welcome email hands it to the rep in plain text and Microsoft forces a change
 * at first sign-in (`forceChangePasswordNextSignIn` below), so it never
 * survives past that login.
 *
 * It used to be random per rep, which silently broke onboarding — the welcome
 * email had "Temporary_password" hardcoded, so every rep was told a password
 * that had never been set. Keep this value and the email in sync: the email
 * renders it from `{{temp_password}}`, so it now follows this constant.
 */
export const TEMP_PASSWORD = "Temporary_password1";

export function generateTempPassword(): string {
  return TEMP_PASSWORD;
}

/**
 * Contact-card fields — everything the M365 admin center shows behind "Manage
 * contact information". All optional: blank/absent values are dropped so we
 * never write an empty string over a field an admin filled in by hand.
 */
export interface ContactInfo {
  jobTitle?: string | null;
  companyName?: string | null;
  officeLocation?: string | null;
  streetAddress?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  mobilePhone?: string | null;
  otherMails?: string[];
}

function contactPayload(c: ContactInfo | undefined): Record<string, unknown> {
  if (!c) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) {
    if (k === "otherMails") continue;
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  const mails = (c.otherMails ?? []).filter((m) => m && m.includes("@"));
  if (mails.length) out.otherMails = mails;
  return out;
}

export async function createUser(opts: {
  firstName: string;
  lastName: string;
  domain: string;
  contact?: ContactInfo;
}): Promise<{ userId: string; upn: string; tempPassword: string }> {
  const token = await getAppToken();
  const base = `${opts.firstName[0]}${opts.lastName}`.toLowerCase().replace(/[^a-z0-9]/g, "");

  // Collision rule: initial+lastname, then numeric suffix (rmusallam → rmusallam2 → …)
  // until a free UPN is found.
  let mailNickname = base;
  for (let n = 2; n <= 20; n++) {
    if (!(await findUserByUpn(`${mailNickname}@${opts.domain}`))) break;
    mailNickname = `${base}${n}`;
  }

  const upn = `${mailNickname}@${opts.domain}`;
  const tempPassword = generateTempPassword();
  const res = await graphFetch(token, "/users", {
    method: "POST",
    body: JSON.stringify({
      accountEnabled: true,
      // Full name. It used to be initial+lastname ("CZurek") only because the
      // Make scenario reused the mail nickname for both. The UPN below keeps
      // that rule — mailboxes stay czurek@ — but the directory shows a name.
      displayName: `${opts.firstName} ${opts.lastName}`,
      givenName: opts.firstName,
      surname: opts.lastName,
      mailNickname,
      userPrincipalName: upn,
      passwordProfile: { password: tempPassword, forceChangePasswordNextSignIn: true },
      ...contactPayload(opts.contact),
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

const PROFILE_SELECT =
  "displayName,jobTitle,companyName,officeLocation,streetAddress,city,state,postalCode,country,mobilePhone,otherMails";

/** Read back the fields the admin center shows — used to preview a backfill. */
export async function getUserProfile(userId: string): Promise<Record<string, unknown>> {
  const token = await getAppToken();
  return must(
    await graphFetch(token, `/users/${encodeURIComponent(userId)}?$select=${PROFILE_SELECT}`),
    `graph getUserProfile ${userId}`,
  );
}

/**
 * PATCH an existing directory record — display name and/or the contact card.
 * Same field rules as createUser: blank values are dropped, never written over
 * something an admin filled in by hand.
 */
export async function updateUser(
  userId: string,
  patch: { displayName?: string | null; contact?: ContactInfo },
): Promise<void> {
  const body: Record<string, unknown> = { ...contactPayload(patch.contact) };
  if (patch.displayName?.trim()) body.displayName = patch.displayName.trim();
  if (!Object.keys(body).length) return;
  const token = await getAppToken();
  await must(
    await graphFetch(token, `/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
    `graph updateUser ${userId}`,
  );
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

export interface MailMessage {
  id: string;
  internetMessageId: string;
  subject: string;
  receivedDateTime: string;
  from: string;
}

/**
 * Inbox messages received at or after `since`, oldest first.
 *
 * The sender cut happens in the caller, not in `$filter`: Graph rejects a
 * filter that combines `from/emailAddress/address` with a receivedDateTime
 * range ("InefficientFilter"), and the mailbox being watched sees ~20 messages
 * a day, so filtering in memory costs nothing.
 */
export async function listInboxSince(mailbox: string, since: string, top = 100): Promise<MailMessage[]> {
  const token = await getAppToken();
  const qs = new URLSearchParams({
    $filter: `receivedDateTime ge ${since}`,
    $orderby: "receivedDateTime asc",
    $top: String(top),
    $select: "id,internetMessageId,subject,receivedDateTime,from",
  });
  const j = await must(
    await graphFetch(token, `/users/${encodeURIComponent(mailbox)}/mailFolders/Inbox/messages?${qs}`),
    "graph listInbox",
  );
  const rows = (j.value ?? []) as Array<Record<string, unknown>>;
  return rows.map((m) => ({
    id: m.id as string,
    internetMessageId: (m.internetMessageId as string) ?? (m.id as string),
    subject: (m.subject as string) ?? "",
    receivedDateTime: m.receivedDateTime as string,
    from: (((m.from as Record<string, Record<string, string>>)?.emailAddress?.address ?? "") as string).toLowerCase(),
  }));
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
