import { ENV } from "../env";

/**
 * RNB Academy roster API — creates a rep's Academy user (docs/academy-roster-api.md).
 * The bearer token is ACADEMY_ROSTER_TOKEN in .env.local; it is never logged.
 */
const ROSTER_URL = "https://www.rocknblockacademy.com/api/roster";

export interface RosterUser {
  email: string;
  password: string;
  role: string;
  company: string;
  track: string;
  manager: string | null;
}

export interface RosterResult {
  created: boolean;
  id: string;
  user_id: string;
  email: string;
  role: string;
  company: string;
}

export async function createRosterUser(user: RosterUser): Promise<RosterResult> {
  const token = ENV.academyRosterToken();
  if (!token) throw new Error("ACADEMY_ROSTER_TOKEN is not set");
  const res = await fetch(ROSTER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(user),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`academy roster: ${res.status} ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as RosterResult;
  } catch {
    throw new Error(`academy roster: ${res.status} non-JSON response: ${text.slice(0, 200)}`);
  }
}
