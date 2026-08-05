# RNB Onboarding

Rock N Block's sales-rep onboarding brain: one webapp that owns the pipeline,
runs the automations natively (Dialpad SMS, Microsoft user/Teams/email, Housecall
Pro, Jotform), and gates readiness behind a training curriculum + test. Replaces
the Jotform×3 + Make.com + Google Sheet chain.

> 📖 The original static **Manager's Guide** this repo started as now lives at
> [`public/guide/index.html`](public/guide/index.html) and is served by the app
> at `/guide/index.html` (no login required).

## Architecture (inherited from GCVPM OS / gcv-renewals)

- **Next.js 16 App Router** on Vercel · Tailwind v4 · hand-rolled primitives
  (`components/os/`) · section registry (`lib/os/sections.ts`)
- **Supabase** (RNB account): schemas `onboarding`, `training`, `shared`;
  RLS all-authenticated; `shared.entity_activity` audit timeline
- **Outbox pattern**: API routes never touch external services — they insert
  `onboarding.outbox` rows; the **worker** (`worker/`, launchd on the mac mini,
  60s single-pass) executes them via connectors behind the gate stack
  (dry-run default → kill switch → pilot allowlists)
- **Connectors** (`worker/connectors/`): Graph (app-only + delegated for chat
  sends), Dialpad, HCP (keys resolved from `public.office_configs` per
  territory), Jotform
- **Rep hub** (`/my/<token>`): tokenized page per rep — progress, curriculum,
  readiness test. No login needed.
- **Edge function** `jotform-webhook`: ingests the rep-info form 24/7.

## Flow

```
/intake (manager) ──► rep + checklist created ──► outbox: prefill Jotform + SMS invite
rep submits info form ──► edge fn ──► status=info_submitted ──► Teams notify + Gusto SMS
☑ Gusto           ──► create M365 user (temp password in drawer)
☑ M365 license    ──► 1:1 DM · Phone Room chat+roster · territory chats ·
                      compat employee_teams_chats row · company announcement ·
                      welcome email (configurable sender) · app-download SMS
☑ HCP user        ──► create HCP employee (territory API key)
☑ Business cards  ──► request email to configured contact
rep passes final quiz ──► training item auto-completes
```

## Develop

```bash
npm install
cp .env.example .env.local   # fill (SETUP.md)
npm run dev
npm run worker:once           # one outbox pass, respects gates
```

## Deploy / operate

- Webapp: Vercel (GitHub integration, zero config)
- Migrations: `supabase/migrations/` (CLI: `supabase db push`)
- Worker: `ops/install_worker.sh` (launchd `com.rnb.onboarding-worker`)
- Runbook + credentials checklist: **SETUP.md**
- Portability: everything is env + migrations; new machine = repo + `.env.local`
  + install script; new Supabase account = dump/restore + re-point envs.
