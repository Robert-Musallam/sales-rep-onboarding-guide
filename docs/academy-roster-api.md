# RNB Academy roster API — create a rep's Academy user

Creates a user in RNB Academy (rocknblockacademy.com) and puts them on the
roster. We will call it during onboarding to give each new rep their Academy
login. **Not automated yet**: nothing in this repo calls it today.

## Endpoint

```
POST https://www.rocknblockacademy.com/api/roster
```

### Headers

| Header | Value |
|---|---|
| `Authorization` | `Bearer <ACADEMY_ROSTER_TOKEN>` |
| `Content-Type` | `application/json` |

`ACADEMY_ROSTER_TOKEN` is a **secret**. Never put it in a commit, a chat, a Slack
thread or a task prompt, and never print it. Read it from the machine's
environment (`.env.local`, as `ACADEMY_ROSTER_TOKEN`) or from Supabase Vault
(proposed secret name `academy_roster_token`). A token that was pasted somewhere
readable is compromised and must be rotated.

### Request body

| Field | Type | Example | Notes |
|---|---|---|---|
| `email` | string | `jdoe@rocknblocklandscape.com` | **The rep's new Microsoft 365 email** (`reps.rnb_email`, created by `m365.create_user`). Becomes their Academy login. Not the personal email. |
| `password` | string | `<TEMP_PASSWORD>` | **Always the same temporary password as the rep's Microsoft user**: `rep.m365_temp_password ?? graph.TEMP_PASSWORD` (`worker/connectors/graph.ts`). Decided 2026-11-20. The rep should change it at first sign-in. |
| `role` | string | `trainee` | New reps start as `trainee`. |
| `company` | string | `rnb` | |
| `track` | string | `sales-design-consultant` | Training track for sales reps. |
| `manager` | string \| null | `null` | Manager to assign, or `null`. |

### Example

```bash
curl --location 'https://www.rocknblockacademy.com/api/roster' \
  --header "Authorization: Bearer $ACADEMY_ROSTER_TOKEN" \
  --header 'Content-Type: application/json' \
  --data-raw '{
    "email":    "jdoe@rocknblocklandscape.com",
    "password": "<TEMP_PASSWORD>",
    "role":     "trainee",
    "company":  "rnb",
    "track":    "sales-design-consultant",
    "manager":  null
  }'
```

### Success response

```json
{
  "created": true,
  "id": "<uuid — roster row id>",
  "user_id": "<uuid — Academy auth user id>",
  "email": "jdoe@rocknblocklandscape.com",
  "role": "trainee",
  "company": "rnb"
}
```

- `id`: the roster row created for the rep.
- `user_id`: the rep's Academy auth user. Store it on the rep record (for
  example a future `reps.academy_user_id`) so a second call is not needed.

## When to call it

After the rep's Microsoft user exists (`reps.rnb_email` is set), because that
email is the Academy login. Same temporary password as Microsoft, so the rep has
one password to change for both.

## Open questions (confirm with the Academy owner before automating)

- What happens when the email already exists: error, or `created: false` with the existing ids?
- Error format and status codes (bad token, missing field, invalid track).
- Allowed values for `role`, `track` and `manager` (is `manager` an email, a user id?).
- Does Academy email the rep, or must we send the login and temporary password ourselves?
- Can Academy force the rep to change the temporary password on first sign-in? Recommended: every rep starts with the same known password.
