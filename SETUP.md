# SETUP — Phase 0 runbook (Robert's ~30 minutes)

Everything in the repo is built and waiting on these credentials/clicks. Work top to
bottom; each section says exactly what to hand over and what I do with it.

> ⚠️ **Rotate at CUTOVER, not before.** The Make scenario embeds the Dialpad key,
> Jotform key, and Azure client secret in plaintext blueprints — they should be
> rotated because anyone with Make access can read them. BUT the live scenario uses
> those same credentials, so rotating early breaks onboarding mid-parallel-run.
> The app uses the existing Dialpad/Jotform keys for now (already in `.env.local`);
> rotate all three the day scenario 4777508 is deactivated. For Azure, ADD a second
> client secret now (both stay valid) and delete Make's old one at cutover.

## 1. Supabase (the account behind the Make automations)

1. Log into that Supabase account → account icon → **Access Tokens** → generate
   (name: `rnb-onboarding-cli`).
2. Hand me the token. I will: find the project holding `public.employee_teams_chats`
   (Make connection 4756051 writes it), apply the four migrations in
   `supabase/migrations/`, deploy the `jotform-webhook` edge function, and set its
   `JOTFORM_WEBHOOK_SECRET`.
3. Dashboard step (I'll walk you through it if the CLI can't): Project → Settings →
   **Data API** → Exposed schemas → add `onboarding, training, shared`.
4. Auth → Users → create logins for you + the sales managers (email+password).
   First user created: set `role='admin'` in `shared.profiles`.

*Account may move later by design: schema is 100% in migrations; move = new project +
`supabase db dump | psql` + re-point env vars.*

## 2. Microsoft (Azure app + delegated consent + sender mailbox)

App registration `1f877804-7bc1-446a-a8ea-b68ffab2c97c` (tenant `b3cd6f2e-…`) already
exists and already has admin consent for what Make was doing.

1. Azure Portal → App registrations → that app → **Certificates & secrets** →
   delete the old client secret, create a new one → hand me the value (`MS_CLIENT_SECRET`).
2. **API permissions** — confirm/add (Application type): `User.ReadWrite.All`,
   `Mail.Send`, `Chat.Create`, `ChatMember.ReadWrite.All`. Add (Delegated):
   `Chat.ReadWrite`, `offline_access`. Click **Grant admin consent**.
3. **Authentication** → Add platform → Web → redirect URI:
   `https://<your-vercel-domain>/api/oauth/microsoft/callback`
4. Tell me the **welcome-email sender mailbox** (NOT info.colorado — your call which
   mailbox). It goes in Settings → App Settings → `welcome_email_sender`.
5. After the app deploys: Settings → Connections & Health → **Connect Microsoft
   account** → sign in as the account Teams messages should come from (the same one
   Make's Teams connection uses — messages will look identical). One click, one time.

## 3. Dialpad + Jotform + HCP keys — ✅ DONE (nothing to hand over)

- **Dialpad + Jotform**: the existing keys from the Make scenario are in `.env.local`;
  rotate both at cutover (see the warning at the top).
- **HCP**: keys already live in this Supabase project (`public.office_configs`, one per
  territory) — the worker reads them directly. Env vars are only an optional override.

## 4. GitHub + Vercel

1. Create empty GitHub repo `rnb-onboarding` under your account; I push this code.
2. Vercel dashboard → Add New Project → import the repo (same flow as gcv-renewals).
3. Paste the env vars from `.env.example` (webapp needs: the two `NEXT_PUBLIC_*`,
   `SUPABASE_SERVICE_ROLE_KEY`, `APP_BASE_URL`, `MS_*`, `TOKEN_ENCRYPTION_KEY`).
   Vercel account can change later: transfer the project or re-import + re-paste envs.

## 5. Mac mini worker

I run: `cp .env.example .env.local` (filled), `npm install`, `ops/install_worker.sh`.
Worker starts in **dry_run** — every automation lands in the outbox with a preview of
what it WOULD send, visible in each rep's drawer. Nothing sends yet.

## Go-live sequence (Phase 6 — we do this together)

1. `npm run verify:graph / verify:dialpad / verify:jotform / verify:hcp` — all green.
2. `npm run test:rep -- --phone <your cell> --email <your email>` → walk the whole
   checklist in the webapp with `PILOT_SEND_ONLY=1` + `send_enabled`: every SMS/email
   goes only to you; Teams/provisioning stay off until `PILOT_ALLOW_TEAMS=1` /
   `PILOT_ALLOW_PROVISION=1` for the final rehearsal.
3. Point the Jotform info-form webhook at the edge function URL (§1) — Make keeps
   running in parallel; its manager-form branch is now unused because intake moved to /intake.
4. Next real hire runs through the app. When clean: deactivate Make scenario 4777508.
5. Flip the worker plist to `RNB_AUTOMATION_MODE=send_enabled`, remove `PILOT_SEND_ONLY`,
   re-run `ops/install_worker.sh`.

## What stays manual (by design, v1)

Gusto add+contract (checklist deep-link records it), M365 license purchase, GreenSky
(rep-driven, tracked on their hub). Browser agents can take these over later — they'll
plug into the same outbox.
