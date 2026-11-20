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
| `email` | string | `newrep@example.com` | The rep's email; becomes their Academy login. |
| `password` | string | `<TEMP_PASSWORD>` | Temporary password. Generate one per rep; the rep should change it. Never reuse a fixed password. |
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
    "email":    "newrep@example.com",
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
  "email": "newrep@example.com",
  "role": "trainee",
  "company": "rnb"
}
```

- `id`: the roster row created for the rep.
- `user_id`: the rep's Academy auth user. Store it on the rep record (for
  example a future `reps.academy_user_id`) so a second call is not needed.

## Open questions (confirm with the Academy owner before automating)

- What happens when the email already exists: error, or `created: false` with the existing ids?
- Error format and status codes (bad token, missing field, invalid track).
- Allowed values for `role`, `track` and `manager` (is `manager` an email, a user id?).
- Does Academy email the rep, or must we send the login and temporary password ourselves?
- Can the rep be forced to change the temporary password on first sign-in?
