import { EmptyState } from "@/components/os/EmptyState";
import { sectionByKey } from "@/lib/os/sections";

/** Honest coming-soon page for a section that has a nav slot but no module yet. */
export function SectionPlaceholder({ sectionKey }: { sectionKey: string }) {
  const s = sectionByKey(sectionKey);
  if (!s) return null;
  return (
    <EmptyState
      icon={s.icon}
      title={s.label}
      tag={s.status === "external" ? "Separate workstream" : "Coming soon"}
      message={s.blurb}
    >
      {s.status === "external" && (
        <p className="text-[12px] text-muted">
          Owned by another workstream — a read-only view will surface here once wired.
        </p>
      )}
    </EmptyState>
  );
}
