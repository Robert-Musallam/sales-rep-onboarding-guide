"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/os/supabase/client";
import { SHARED_SCHEMA } from "@/lib/os/schemas";
import { ActivityTimeline, type TimelineEntry } from "@/components/os/DrawerShell";

/**
 * Section-agnostic activity feed. Reads the shared audit primitive
 * `shared.entity_activity` filtered to (entity_type, entity_id) and renders the
 * generic timeline. Any module reuses this — renewals passes 'renewal', leasing
 * will pass 'lease', etc. `reloadKey` bumps to refetch after a mutation.
 *
 * entity_activity stores (action, actor_label, occurred_at, payload.channel);
 * we map those onto the timeline's (type, actor, created_at, channel) shape.
 */
export function ActivityFeed({
  entityType,
  entityId,
  icons,
  reloadKey = 0,
  emptyMessage,
}: {
  entityType: string;
  entityId: string | number;
  icons?: Record<string, string>;
  reloadKey?: number;
  emptyMessage?: string;
}) {
  const [items, setItems] = useState<TimelineEntry[]>([]);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .schema(SHARED_SCHEMA)
      .from("entity_activity")
      .select("id, action, actor_label, summary, payload, occurred_at")
      .eq("entity_type", entityType)
      .eq("entity_id", String(entityId))
      .order("occurred_at", { ascending: false });

    const rows = (data ?? []) as Array<{
      id: number;
      action: string;
      actor_label: string | null;
      summary: string | null;
      payload: Record<string, unknown> | null;
      occurred_at: string;
    }>;

    setItems(
      rows.map((r) => ({
        id: r.id,
        type: r.action,
        summary: r.summary,
        actor: r.actor_label,
        created_at: r.occurred_at,
        channel: (r.payload?.channel as string | undefined) ?? null,
      })),
    );
  }, [entityType, entityId]);

  useEffect(() => {
    // Async load on open + whenever reloadKey changes; setState is post-await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load, reloadKey]);

  return <ActivityTimeline items={items} icons={icons} emptyMessage={emptyMessage} />;
}
