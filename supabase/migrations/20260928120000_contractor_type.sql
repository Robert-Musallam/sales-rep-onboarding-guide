-- The rep info form (Jotform 261665616138664) now asks "Contractor type":
-- whether Gusto should add them as an individual contractor (1099, paid on
-- their SSN) or as a business (paid on an EIN). Ops needs the answer at the
-- moment they add the rep in Gusto, which is the info-submitted notice.
--
-- Stored on the rep as a plain column so the notice, the drawer and reports
-- can read it without digging through reps.info (the raw answer stays there
-- too). Nullable: every rep who answered the form before 2026-09-28 has no
-- value, and the worker renders that as "not answered".
alter table onboarding.reps
  add column if not exists contractor_type text
  check (contractor_type in ('individual', 'business'));

-- The ops Teams notice shows it right under the rep's name. Idempotent: a
-- template that already carries the token is left alone.
update onboarding.message_templates
   set body = replace(
         body,
         '<b>Rep:</b> {{first_name}} {{last_name}}<br>',
         '<b>Rep:</b> {{first_name}} {{last_name}}<br>' || chr(10) || '  <b>Contractor type:</b> {{contractor_type}}<br>'
       ),
       updated_at = now()
 where key = 'teams.notify_info_submitted'
   and body not like '%{{contractor_type}}%';
