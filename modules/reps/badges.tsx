import { Badge } from "@/components/os/Badge";
import type { ItemStatus, OutboxState, RepStatus } from "./types";

export const STATUS_LABEL: Record<RepStatus, string> = {
  invited: "Invited",
  info_submitted: "Info Submitted",
  contract_sent: "Contract Sent",
  contract_signed: "Contract Signed",
  provisioning: "Provisioning",
  active: "Active",
  inactive: "Inactive",
};

const STATUS_TONE: Record<RepStatus, string> = {
  invited: "slate",
  info_submitted: "teal",
  contract_sent: "amber",
  contract_signed: "orange",
  provisioning: "navy",
  active: "green",
  inactive: "red",
};

export function RepStatusBadge({ status }: { status: RepStatus }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"} label={STATUS_LABEL[status] ?? status} dot />;
}

const ITEM_TONE: Record<ItemStatus, string> = {
  pending: "slate",
  done: "green",
  skipped: "amber",
  blocked: "red",
};

export function ItemStatusBadge({ status }: { status: ItemStatus }) {
  return <Badge tone={ITEM_TONE[status] ?? "slate"} label={status} />;
}

const OUTBOX_TONE: Record<OutboxState, string> = {
  pending: "slate",
  in_flight: "teal",
  done: "green",
  failed: "red",
  skipped: "amber",
};

export function OutboxStateBadge({ state }: { state: OutboxState }) {
  return <Badge tone={OUTBOX_TONE[state] ?? "slate"} label={state} />;
}
