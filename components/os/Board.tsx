"use client";

import { useState, type ReactNode } from "react";

export interface Stage {
  key: string;
  label: string;
}

/**
 * Generic drag-to-advance kanban board. Module-agnostic: pass the stages, a
 * function mapping an item → its stage key, a move handler, and a card renderer.
 * The board owns only drag state; the consuming module owns data + drawer.
 */
export function Board<T extends { id: number }>({
  items,
  stages,
  stageOf,
  onMove,
  renderCard,
  onCardClick,
}: {
  items: T[];
  stages: Stage[];
  stageOf: (item: T) => string;
  onMove: (id: number, stage: string) => Promise<void> | void;
  renderCard: (item: T) => ReactNode;
  onCardClick?: (item: T) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  const byStage: Record<string, T[]> = {};
  for (const s of stages) byStage[s.key] = [];
  for (const it of items) (byStage[stageOf(it)] ??= []).push(it);

  async function drop(stage: string) {
    setOverCol(null);
    const id = dragId;
    setDragId(null);
    if (id == null) return;
    const it = items.find((i) => i.id === id);
    if (!it || stageOf(it) === stage) return;
    await onMove(id, stage);
  }

  return (
    <div className="flex gap-3 overflow-x-auto thin-scroll pb-3">
      {stages.map((s) => (
        <div
          key={s.key}
          className={`shrink-0 w-[250px] rounded-xl border p-2 transition-colors ${
            overCol === s.key ? "border-navy bg-bl/20" : "border-line bg-card"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setOverCol(s.key);
          }}
          onDragLeave={() => setOverCol((c) => (c === s.key ? null : c))}
          onDrop={() => drop(s.key)}
        >
          <div className="flex items-center justify-between px-1 py-1.5">
            <span className="text-[13px] font-semibold text-ink">{s.label}</span>
            <span className="text-[12px] text-muted">{byStage[s.key]?.length ?? 0}</span>
          </div>
          <div className="space-y-2 min-h-[40px]">
            {(byStage[s.key] ?? []).map((it) => (
              <div
                key={it.id}
                draggable
                onDragStart={() => setDragId(it.id)}
                onDragEnd={() => setDragId(null)}
                onClick={onCardClick ? () => onCardClick(it) : undefined}
                className="card p-2.5 cursor-grab active:cursor-grabbing hover:border-navy/40"
              >
                {renderCard(it)}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
