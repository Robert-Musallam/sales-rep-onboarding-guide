import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type KpiTone = "navy" | "red" | "green" | "amber" | "teal";

const ACCENT: Record<KpiTone, string> = {
  navy: "#2a5885",
  red: "#d1495b",
  green: "#2e9e5b",
  amber: "#e0992b",
  teal: "#1f7a8c",
};

/** Single KPI stat card with a colored accent rail. Shared by all modules. */
export function KpiCard({
  label,
  value,
  sub,
  tone = "navy",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: KpiTone;
}) {
  const accent = ACCENT[tone];
  return (
    <div className="card p-3.5 relative overflow-hidden">
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: accent }} />
      <div className="text-[11px] font-semibold text-muted uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-0.5" style={{ color: accent }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted mt-0.5">{sub}</div>}
    </div>
  );
}

/**
 * Responsive KPI header row. Modules drop KpiCards (and optional custom widgets
 * like a chart) as children and control the column template via `className`.
 */
export function KpiHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-1 gap-3", className)}>{children}</div>;
}
