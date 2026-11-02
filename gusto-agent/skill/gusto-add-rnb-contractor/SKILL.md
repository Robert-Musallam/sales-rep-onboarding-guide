---
name: gusto-add-rnb-contractor
description: Add a new Rock N Block sales rep to the correct Gusto company as a contractor (Sales / Design Consultant) and send the Gusto invite. Runs in the dedicated Gusto Chrome (port 9336) through the gusto-browser Playwright tools.
---

# Add a new RNB contractor to Gusto

Source of truth for the flow: Robert's screen recording of 2026-10-29 (Vince Nocero, Arizona).
Browser: the dedicated Gusto Chrome started by `gusto-agent/chrome-gusto.sh start`
(profile `~/chrome-gusto`, CDP port 9336). Use only the `gusto-browser` tools. Read pages as
text/accessibility snapshot and target controls by their visible label. Never use screen
coordinates. Never type a password, SSN, EIN, bank number or verification code.

## Arguments

`rep_id=<id> | rep_name="<First Last>"`, `mode=<dry_run|send>`, optional `first_name= last_name= email= territory= contractor_type=individual|business business_name=`

- If the rep fields are passed (Phase 3+, from Supabase), use them and do not open Holding OS.
- If only `rep_id` or `rep_name` is passed (Phase 1–2), read the rep from Holding OS (step 1).
- `mode=dry_run` (default if missing): go up to — but never click — the first **Save and continue**. Nothing is created in Gusto.
- `mode=send`: complete the flow.
- `approved_recipient=<email>` (optional, attended tests): in `mode=send` the rep's personal email must equal it exactly, otherwise STOP `recipient_mismatch` before anything is saved.

## Step 0: Session check
1. Open `https://app.gusto.com/u/companies`.
2. If a sign-in, "verify it's you", 2-step, passkey or CAPTCHA screen appears → STOP with `stop_reason=gusto_signin_required`. Do not try to sign in.

## Step 1: Rep data (only when fields were not passed)
1. Open `https://gcv-renewals.vercel.app/rnb/reps`. If a login screen appears → STOP `holding_os_signin_required`.
2. Open the rep's card in **Info Submitted**. Capture Name (split first / last), Location,
   Contractor type (`Individual (1099)` or `Business (EIN) — <Business name>`), Personal email.
3. A card tagged **TEST**: allowed in `mode=dry_run`. In `mode=send` only when its personal email is one of the approved test inboxes: `Rmusallam@rocknblocklandscape.com`, `josebrest25@gmail.com` (approved by Robert 2026-10-30). Otherwise STOP `test_card_wrong_email`.
4. Any of the four fields blank → STOP `missing_field:<name>`.
5. No matching card in **Info Submitted** → STOP `rep_not_found:<name>`.

## Step 2: Gusto company from location

| Location | Gusto company (exact row title on /u/companies) |
|---|---|
| Arizona | Rock n block arizona |
| Colorado | Rock N Block CO LLC |
| Tampa | Rock n block florida llc |
| Las Vegas, Utah | Rock N Block llc |
| San Diego, OC/IE | Rock n block San Diego llc |
| Santa Clara or anything else | STOP `unmapped_location:<loc>` |

Gusto signs in to the Florida company by default. Always click **Sign in** on the mapped row,
then confirm the company name shown under the user name (top right) equals the mapped company.
Mismatch → STOP `wrong_company`.

## Step 3: Duplicate check
People → search the rep's email and last name in **Active**, **Onboarding** and **Dismissed**.
Any match → STOP `already_in_gusto:<tab>` (report the name found). Never add a second record.
Gusto's People search may not match email addresses, so also open every person in **Onboarding**
and any name match, and compare their personal email with the rep's. Same email → STOP `already_in_gusto:<tab>`.

## Step 4: Basics (Step 1 of 3)
People → **Add** → **Add a person**.
- First name = rep first name · Last name = rep last name · Preferred first name = first name · Middle initial blank
- Worker type: Individual → **Contractor (Individual)**; Business → **Contractor (Business)** and fill the business-name field with `business_name`
- Country: United States · Personal email = rep personal email
- Onboarding options: leave **Send a contractor agreement** unchecked; do not open background checks
- `mode=dry_run`: snapshot the filled form and STOP with `outcome=dry_run_ok`. Do NOT click Save.
- `mode=send`: click **Save and continue**.

## Step 5: Employment info (Step 2 of 3)
- Contract start date = today (America/New_York) · Department = **Sales** · Job title = **Design Consultant**
- Leave tips, manager and hourly rate empty. Click **Save and continue**.
- If a details confirmation screen appears, check it against the rep data, then **Save and continue**.

## Step 6: Send invitation, then documents (Step 3 of 3) — confirmed live 2026-10-30
1. Page **Send invitation** shows "Send invite to <email>". The email must equal the rep's personal email
   (and `approved_recipient` if given). Mismatch → STOP `recipient_mismatch`. Click **Send and continue**.
   **This click emails the invite** (`invite_button=send_invitation`).
2. Page **Set up Gusto features** (Contact details · Documents · New hire check-ins).
   Documents → **Edit**. Apply the document rule below: W-9 + the company's contractor agreement,
   uncheck everything else, **Save**. Report every document seen and which were unchecked.
3. Leave **New hire check-ins** at the default. Click **Save and continue**.

### Document rule (Robert, 2026-10-30): send exactly TWO documents
1. **Taxpayer Identification (Form W-9)** — automatic.
2. The company's **independent contractor agreement**. Uncheck every other team document
   (handbooks, employee info, non-competes, commission agreements, employment agreements…).

| Gusto company | Contractor agreement to keep |
|---|---|
| Rock n block arizona | DESIGN CONSULTANT AZ |
| Rock N Block llc (Las Vegas, Utah) | Sales independant contractor 2025 |
| Rock N Block CO LLC · Rock n block florida llc · Rock n block San Diego llc | not confirmed yet: keep the ONE document whose name contains "contractor"; if there are none or several → STOP `contractor_agreement_unclear:<names>` and report the list |

## Step 7: Verify
The rep's onboarding checklist must show **Invite <name> to Gusto — Invitation sent**, where <name> is the
rep's first name for an individual and the **business name** for a business contractor (Gusto lists business
contractors by business name). Report `outcome=added`.
Anything else → `outcome=needs_review`.

## Pop-ups
Gusto marketing / promo / "what's new" dialogs (e.g. "Showcase Fall 2026") may cover the page.
Close them with their **Close**, **X**, **Not now** or **Dismiss** control only. Never click a
promotional call-to-action. A dialog that asks to confirm, sign, accept terms, or pay is NOT a
promo → STOP `unexpected_dialog:<title>`.

## Stop rules
Stop (do not improvise) on: sign-in/2FA/CAPTCHA, unmapped location, missing field, duplicate,
wrong company, unexpected document, any screen or field not described here, any error banner.
Never go back and retry a send step.

## Output (last message, JSON only)
```json
{"rep_id": 0, "mode": "dry_run|send", "outcome": "dry_run_ok|added|needs_review|stopped",
 "stop_reason": null, "gusto_company": "", "worker_type": "individual|business",
 "business_name": null, "documents": [], "employment_agreement_removed": false,
 "invite_button": "send_invitation|save_and_continue|null", "invite_sent": false,
 "notes": ""}
```
