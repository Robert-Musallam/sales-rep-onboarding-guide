import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/os/supabase/admin";
import { ONBOARDING_SCHEMA } from "@/lib/os/schemas";
import { splitManagersByTerritory } from "@/lib/onboarding/intake";
import { PublicIntakeForm } from "@/modules/intake/PublicIntakeForm";

export const dynamic = "force-dynamic";

/**
 * City intake form — token-authenticated, no login (same shape as the rep hub
 * at /my/<token>). The token resolves to one city, and that city is the only
 * thing the page hands the form: managers file reps without ever holding an
 * account, and cannot file one into the wrong territory.
 */
export default async function PublicIntakePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: link } = await admin
    .schema(ONBOARDING_SCHEMA)
    .from("intake_links")
    .select("id, territory:territories(name, active)")
    .eq("token", token)
    .eq("active", true)
    .maybeSingle();
  const territory = link?.territory as unknown as { name: string; active: boolean } | null;
  if (!link || !territory?.active) notFound();

  const [{ data: setting }, { data: people }] = await Promise.all([
    admin.schema(ONBOARDING_SCHEMA).from("app_settings").select("value").eq("key", "managers").maybeSingle(),
    admin
      .schema(ONBOARDING_SCHEMA)
      .from("people")
      .select("full_name, territories")
      .eq("active", true)
      .contains("roles", ["manager"]),
  ]);

  const allManagers = Array.isArray(setting?.value) ? (setting.value as string[]) : [];
  const { forCity, others } = splitManagersByTerritory(
    allManagers,
    (people ?? []) as Array<{ full_name: string; territories: string[] }>,
    territory.name,
  );

  return <PublicIntakeForm token={token} city={territory.name} cityManagers={forCity} otherManagers={others} />;
}
