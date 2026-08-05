import type { ReactNode } from "react";

/**
 * Titled action section — the card wrapper used for each group of actions in a
 * detail drawer (decision, rent, outreach, notes, …). Shared across modules so
 * every drawer has consistent action affordances.
 */
export function ActionBar({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="card p-4">
      {title && (
        <div className="text-[12px] font-semibold text-muted uppercase mb-2">{title}</div>
      )}
      {children}
    </section>
  );
}
