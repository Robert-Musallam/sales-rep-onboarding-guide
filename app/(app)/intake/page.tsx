import { fetchTerritories } from "@/modules/reps/data";
import { IntakeForm } from "@/modules/intake/IntakeForm";

export const dynamic = "force-dynamic";

export default async function IntakePage() {
  const territories = await fetchTerritories();
  return <IntakeForm territories={territories} />;
}
