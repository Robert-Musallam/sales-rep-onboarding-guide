import type { ReactNode } from "react";
import { Icon } from "@/components/os/icons";

/**
 * Honest empty / not-yet-built state. Used for coming-soon section pages (so a
 * nav item never 404s or looks broken) and for genuinely-empty data tables.
 */
export function EmptyState({
  icon,
  title,
  message,
  tag,
  children,
}: {
  icon?: string;
  title: string;
  message?: ReactNode;
  tag?: string;
  children?: ReactNode;
}) {
  return (
    <div className="card p-10 flex flex-col items-center text-center gap-3 max-w-xl mx-auto mt-6">
      {icon && (
        <div className="w-11 h-11 rounded-xl bg-bg text-navy grid place-items-center">
          <Icon name={icon} width={22} height={22} />
        </div>
      )}
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-navy text-lg">{title}</h2>
        {tag && (
          <span className="tag bg-bg text-muted border border-line uppercase tracking-wide">{tag}</span>
        )}
      </div>
      {message && <p className="text-[13px] text-muted leading-relaxed">{message}</p>}
      {children}
    </div>
  );
}
