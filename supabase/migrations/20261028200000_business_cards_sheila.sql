-- The business-card contact is Sheila, not "Shiela" (told 2026-10-28).
update onboarding.message_templates
   set body = replace(body, 'Hi Shiela,', 'Hi Sheila,'),
       updated_at = now()
 where key = 'email.business_cards'
   and body like 'Hi Shiela,%';
