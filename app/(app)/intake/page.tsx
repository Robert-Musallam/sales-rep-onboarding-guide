import { fetchManagers, fetchTerritories } from "@/modules/reps/data";
import { IntakeForm } from "@/modules/intake/IntakeForm";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const [territories, managers] = await Promise.all([fetchTerritories(), fetchManagers()]);
  return <IntakeForm territories={territories} managers={managers} />;
}
