-- Business name (told 2026-10-28): the rep info form now reveals a "Business
-- name" input when the rep picks "Contractor (Business)". Ops needs it to add
-- the rep in Gusto, so it lives on the rep next to contractor_type and is shown
-- in the ops Teams notice right after the type.
alter table onboarding.reps add column if not exists business_name text;

-- "Contractor type: Business (EIN) — Acme Turf LLC". {{business_suffix}} renders
-- empty for individuals and for a business that gave no name.
update onboarding.message_templates
   set body = replace(body, '<b>Contractor type:</b> {{contractor_type}}<br>',
                            '<b>Contractor type:</b> {{contractor_type}}{{business_suffix}}<br>'),
       updated_at = now()
 where key = 'teams.notify_info_submitted'
   and body like '%{{contractor_type}}<br>%'
   and body not like '%{{business_suffix}}%';
