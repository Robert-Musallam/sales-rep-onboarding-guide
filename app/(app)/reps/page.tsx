import { Suspense } from "react";
import { fetchReps } from "@/modules/reps/data";
import { RepsView } from "@/modules/reps/RepsView";

export const dynamic = "force-dynamic";

export default async function RepsPage() {
  const reps = await fetchReps();
  return (
    <Suspense fallback={null}>
      <RepsView initialReps={reps} />
    </Suspense>
  );
}
