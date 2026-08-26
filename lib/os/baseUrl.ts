/**
 * The canonical, publicly reachable address of this app — the one that goes
 * into links handed to people who don't work here (rep hubs, city intake forms).
 *
 * Never derive this from the incoming request or window.location. Vercel serves
 * the same app on deployment and branch hosts that sit behind its SSO login, so
 * a link built from whatever host an admin happened to be browsing sends the
 * recipient to a Vercel login screen instead of the page.
 *
 * APP_BASE_URL wins when set; otherwise Vercel's own production-domain variable,
 * which is always present in a Vercel runtime, keeps the links working even if
 * nobody configured the first one.
 */
export function appBaseUrl(): string {
  const explicit = process.env.APP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "";
}
