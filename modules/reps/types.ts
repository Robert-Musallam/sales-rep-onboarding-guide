export type RepStatus =
  | "invited"
  | "info_submitted"
  | "contract_sent"
  | "contract_signed"
  | "provisioning"
  | "active"
  | "inactive";

export const REP_STATUSES: RepStatus[] = [
  "invited",
  "info_submitted",
  "contract_sent",
  "contract_signed",
  "provisioning",
  "active",
  "inactive",
];

export interface Rep {
  id: number;
  first_name: string;
  last_name: string;
  personal_email: string | null;
  phone_e164: string | null;
  phone_os: string | null;
  home_address: string | null;
  zip_code: string | null;
  dob: string | null;
  how_heard: string | null;
  manager_name: string | null;
  territory_id: number | null;
  expected_start: string | null;
  status: RepStatus;
  rnb_email: string | null;
  m365_user_id: string | null;
  m365_temp_password: string | null;
  teams_chat_id: string | null;
  phone_room_chat_id: string | null;
  hcp_employee_id: string | null;
  hcp_username: string | null;
  gusto_status: string | null;
  greensky_status: string | null;
  training_passed_at: string | null;
  jotform_info_submission_id: string | null;
  info: Record<string, unknown>;
  is_test: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
  territory?: { id: number; name: string } | null;
}

export type ItemStatus = "pending" | "done" | "skipped" | "blocked";

export interface ChecklistItem {
  id: number;
  rep_id: number;
  template_key: string;
  label: string;
  sort_order: number;
  automation_key: string | null;
  status: ItemStatus;
  completed_at: string | null;
  notes: string | null;
}

export type OutboxState = "pending" | "in_flight" | "done" | "failed" | "skipped";

export interface OutboxRow {
  id: number;
  action_type: string;
  rep_id: number | null;
  state: OutboxState;
  attempts: number;
  last_error: string | null;
  run_after: string;
  created_at: string;
  executed_at: string | null;
  dry_run_log: { note?: string } | null;
}

export interface Territory {
  id: number;
  name: string;
  active: boolean;
  post_sales_chat_ids: string[];
  hcp_company_note: string | null;
  hcp_api_key_env: string | null;
  gusto_note: string | null;
}
