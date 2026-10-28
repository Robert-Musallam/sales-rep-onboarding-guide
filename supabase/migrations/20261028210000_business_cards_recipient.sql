-- Business-card orders go to Sheila (told 2026-10-28); Robert keeps a blind copy.
update onboarding.app_settings
   set value = '"sheilaroadrunner@gmail.com"'
 where key = 'business_card_contact_email';

insert into onboarding.app_settings (key, value)
values ('business_card_bcc', '["Rmusallam@rocknblocklandscape.com"]')
on conflict (key) do update set value = excluded.value;
