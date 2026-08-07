import { Suspense } from "react";
import { fetchManagers, fetchReps } from "@/modules/reps/data";
import { getSessionUser } from "@/lib/os/auth";
import { RepsView } from "@/modules/reps/RepsView";

export const dynamic = "force-dynamic";

export default async function RepsPage() {
  const [reps, managers, session] = await Promise.all([
    fetchReps(),
    fetchManagers(),
    getSessionUser(),
  ]);

  // Managers land filtered to their own reps by default (matched by name
  // against the manager dropdown); admins/staff see everything. Just a default —
  // anyone can switch the filter to any manager or "All".
  const fullName = session?.profile?.full_name ?? "";
  const defaultManager =
    session?.profile?.role === "manager" &&
    managers.some((m) => m.toLowerCase() === fullName.toLowerCase())
      ? managers.find((m) => m.toLowerCase() === fullName.toLowerCase())!
      : "";

  return (
    <Suspense fallback={null}>
      <RepsView initialReps={reps} managers={managers} defaultManager={defaultManager} />
    </Suspense>
  );
}
