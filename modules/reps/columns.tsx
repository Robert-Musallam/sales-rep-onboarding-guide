import type { ColumnDef } from "@tanstack/react-table";
import { fmtDate } from "@/lib/utils";
import { RepStatusBadge } from "./badges";
import type { Rep } from "./types";

export const repColumns: ColumnDef<Rep, unknown>[] = [
  {
    id: "name",
    header: "Rep",
    accessorFn: (r) => `${r.first_name} ${r.last_name}`,
    cell: ({ row }) => (
      <span className="font-semibold text-ink">
        {row.original.first_name} {row.original.last_name}
        {row.original.is_test && <span className="text-amber text-[11px] ml-1.5">TEST</span>}
      </span>
    ),
  },
  {
    id: "territory",
    header: "Territory",
    accessorFn: (r) => r.territory?.name ?? "",
  },
  {
    id: "status",
    header: "Status",
    accessorKey: "status",
    cell: ({ row }) => <RepStatusBadge status={row.original.status} />,
  },
  {
    id: "phone",
    header: "Phone",
    accessorKey: "phone_e164",
    cell: ({ getValue }) => (getValue() as string) ?? "—",
  },
  {
    id: "rnb_email",
    header: "RNB Email",
    accessorKey: "rnb_email",
    cell: ({ getValue }) => (getValue() as string) ?? "—",
  },
  {
    id: "manager",
    header: "Manager",
    accessorKey: "manager_name",
    cell: ({ getValue }) => (getValue() as string) ?? "—",
  },
  {
    id: "start",
    header: "Expected Start",
    accessorKey: "expected_start",
    cell: ({ getValue }) => fmtDate(getValue() as string | null),
  },
  {
    id: "created",
    header: "Added",
    accessorKey: "created_at",
    cell: ({ getValue }) => fmtDate(getValue() as string),
  },
];
