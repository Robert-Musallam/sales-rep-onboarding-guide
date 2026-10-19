-- Sales Training link in the 1:1 chat (told 2026-10-19, revised the same
-- day): not inside the welcome DM but as its own message, pinned in the chat
-- by teams.create_dm. The welcome template goes back to what it was before
-- 20261019170000, and the link moves to a setting the action reads.
update onboarding.message_templates
   set body = regexp_replace(body, E'\n\n📘 <b>Sales Training notebook</b>.*$', ''),
       updated_at = now()
 where key = 'teams.dm_welcome'
   and body like '%IgDUQnqWTq0wS5tnvE3_Zcf5AfWTor8sPEPWH9L0UQFNhWA%';

insert into onboarding.app_settings (key, value) values
  ('sales_training_notebook_url',
   '"https://srcspro-my.sharepoint.com/:o:/g/personal/jorge_rocknblocklandscape_com/IgDUQnqWTq0wS5tnvE3_Zcf5AfWTor8sPEPWH9L0UQFNhWA?e=sVQSs0"')
on conflict (key) do update set value = excluded.value, updated_at = now();
