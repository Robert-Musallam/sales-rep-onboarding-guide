"use client";

import type { ReactNode } from "react";

/**
 * Generic right-side detail drawer chrome: overlay, sliding panel, sticky header
 * (title / subtitle / meta / badges), an error slot, and a body. Modules supply
 * the header bits + action sections as children. Deep-link pages reuse the same
 * shell by rendering it inline.
 */
export function DrawerShell({
  title,
  subtitle,
  meta,
  badges,
  error,
  onClose,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  badges?: ReactNode;
  error?: string | null;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-navy/30" onClick={onClose} />
      <div className="relative w-full max-w-[520px] bg-bg h-full overflow-y-auto thin-scroll shadow-2xl">
        <div className="sticky top-0 bg-card border-b border-line px-5 py-4 z-10">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-bold text-navy text-lg leading-tight">{title}</div>
              {subtitle && <div className="text-[13px] text-muted">{subtitle}</div>}
              {meta && <div className="text-[12px] text-muted mt-0.5">{meta}</div>}
            </div>
            <button className="btn btn-sm" onClick={onClose}>
              ✕
            </button>
          </div>
          {badges && <div className="flex flex-wrap items-center gap-2 mt-3">{badges}</div>}
        </div>

        {error && (
          <div className="mx-5 mt-4 text-[12px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  );
}

export interface TimelineEntry {
  id: number | string;
  type: string;
  summary: string | null;
  actor: string | null;
  created_at: string;
  channel?: string | null;
}

/**
 * Generic activity timeline. Pass entity_activity-shaped rows and an optional
 * type→icon map. Renders newest-first as already ordered by the caller.
 */
export function ActivityTimeline({
  items,
  icons = {},
  emptyMessage = "No activity yet.",
}: {
  items: TimelineEntry[];
  icons?: Record<string, string>;
  emptyMessage?: string;
}) {
  if (items.length === 0) {
    return <div className="text-[13px] text-muted">{emptyMessage}</div>;
  }
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="flex gap-2.5 text-[13px]">
          <span className="shrink-0">{icons[a.type] ?? "•"}</span>
          <div className="min-w-0">
            <div className="text-ink">{a.summary}</div>
            <div className="text-[11px] text-muted">
              {a.actor} · {new Date(a.created_at).toLocaleString("en-US")}
              {a.channel ? ` · ${a.channel}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
