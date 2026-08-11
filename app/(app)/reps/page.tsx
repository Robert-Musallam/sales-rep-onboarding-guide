import { Suspense } from "react";
import { fetchManagers, fetchReps } from "@/modules/reps/data";
import { getSessionUser } from "@/lib/os/auth";
import { RepsView } from "@/modules/reps/RepsView";

export const dynamic = "force-dynamic";

export default async function RepsPage() {
  const session = await getSessionUser();

  // Managers only see their own reps (the ones they registered); admins/staff
  // see everything with the manager filter available.
  const restrictedTo =
    session?.profile?.role === "manager" ? (session.profile.full_name ?? "") : null;

  const [reps, managers] = await Promise.all([
    fetchReps(restrictedTo),
    restrictedTo ? Promise.resolve([]) : fetchManagers(),
  ]);

  return (
    <Suspense fallback={null}>
      <RepsView initialReps={reps} managers={managers} restrictedTo={restrictedTo} />
    </Suspense>
  );
}
