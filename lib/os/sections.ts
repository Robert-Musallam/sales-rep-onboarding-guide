/**
 * RNB Onboarding section registry — the single source of truth for the left nav
 * and section routing (pattern inherited from GCVPM OS). Every module registers
 * here: key, label, route, icon, kind, and whether it has a usable module yet.
 * The shell renders nav straight from this list, so adding a section is a
 * one-line change.
 *
 * `kind`:
 *   - "entity" sections CREATE and TRACK things and log to shared.entity_activity
 *     (so they carry an `entityType` matching the shared.entity_type enum).
 *   - "view" sections are forms/config/read surfaces that own no entities.
 */
export type SectionStatus = "live" | "soon" | "external";
export type SectionKind = "entity" | "view";

export interface Section {
  key: string;
  label: string;
  href: string;
  icon: string; // maps to components/os/icons
  kind: SectionKind;
  status: SectionStatus;
  /** true = has a real route/module; false = coming-soon placeholder page */
  enabled: boolean;
  /** entity sections only — names a value in the shared.entity_type enum */
  entityType?: string;
  blurb: string;
}

export const SECTIONS: Section[] = [
  {
    key: "reps",
    label: "Onboarding",
    href: "/reps",
    icon: "reps",
    kind: "entity",
    status: "live",
    enabled: true,
    entityType: "rep",
    blurb:
      "Every sales rep moving through onboarding: pipeline board, checklist, automations, and per-rep activity timeline.",
  },
  {
    key: "intake",
    label: "New Rep",
    href: "/intake",
    icon: "intake",
    kind: "view",
    status: "live",
    enabled: true,
    blurb:
      "Manager kick-off form — replaces the first Jotform. Submitting creates the rep, instantiates the checklist, and queues the welcome text.",
  },
  {
    key: "training",
    label: "Training",
    href: "/training",
    icon: "training",
    kind: "view",
    status: "live",
    enabled: true,
    blurb:
      "Curriculum and readiness test administration: courses, lessons, quizzes, and each rep's attempts. Reps take the test from their personal onboarding link.",
  },
  {
    key: "guide",
    label: "Manager's Guide",
    href: "/guide",
    icon: "guide",
    kind: "view",
    status: "live",
    enabled: true,
    blurb:
      "The step-by-step manager's guide: what to do, what happens automatically, and who gets looped in.",
  },
  {
    key: "settings",
    label: "Settings",
    href: "/settings",
    icon: "settings",
    kind: "view",
    status: "live",
    enabled: true,
    blurb:
      "Territories, people & rosters, message templates, checklist template, connections, and automation kill switches.",
  },
];

export function sectionByKey(key: string): Section | undefined {
  return SECTIONS.find((s) => s.key === key);
}
