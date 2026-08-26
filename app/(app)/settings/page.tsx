import { SettingsView } from "@/modules/settings/SettingsView";
import { appBaseUrl } from "@/lib/os/baseUrl";

export const dynamic = "force-dynamic";

/**
 * `baseUrl` is read here, on the server, rather than from window.location in the
 * browser. The intake links are handed to people outside the company, and a
 * Vercel deployment URL (what you land on when you open the app from the Vercel
 * dashboard) sits behind Vercel's SSO — a link copied from that host sends the
 * manager to a Vercel login screen instead of the form.
 */
export default function SettingsPage() {
  return <SettingsView baseUrl={appBaseUrl()} />;
}
