import { redirect } from "next/navigation";
import { HOLDING_OS_RNB_URL } from "@/lib/holdingOs";

/**
 * The onboarding screens left this app on 2026-09-28 and were switched off on
 * 2026-10-19: everything under /reps, /settings, /training, /intake (admin)
 * and /guide sends the visitor to Holding OS → RNB. Nothing renders here.
 *
 * What this deployment still does, and why it stays up:
 *   - /my/<token> and /intake/<token> — the links reps and managers hold.
 *   - /login + /api/oauth/microsoft/* — the Microsoft delegated consent. Azure
 *     has one registered redirect URI and it is this host; Holding OS links
 *     here for "Connect Microsoft account". The consent needs a session on
 *     this host, which is the only reason /login survives.
 *   - /guide/index.html — the static manager's guide, no login.
 */
export default function AppLayout() {
  redirect(HOLDING_OS_RNB_URL);
}
