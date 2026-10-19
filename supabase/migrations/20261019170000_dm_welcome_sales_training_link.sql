-- Welcome DM (told 2026-10-19): the 1:1 Teams message Robert sends the new rep
-- (teams.create_dm → template teams.dm_welcome) now ends with the view-only
-- link to the "Sales Training" OneNote notebook (Jorge's OneDrive, 15
-- sections: our process, tools we use, objection handling, holds …). The link
-- is an "anyone with the link" view link Robert created on 2026-10-19, so the
-- rep can open it before their Microsoft sign-in is fully set up.
--
-- The message is sent as HTML, so this is a real anchor. The URL lives in the
-- template on purpose: a new link is a Settings → Message Templates edit, not
-- a deploy. Idempotent on the link id.
update onboarding.message_templates
   set body = body || chr(10) || chr(10)
            || '📘 <b>Sales Training notebook</b> — our process, the tools we use, objection handling and more. '
            || 'Bookmark it: <a href="https://srcspro-my.sharepoint.com/:o:/g/personal/jorge_rocknblocklandscape_com/IgDUQnqWTq0wS5tnvE3_Zcf5AfWTor8sPEPWH9L0UQFNhWA?e=sVQSs0">Open the Sales Training notebook</a>',
       updated_at = now()
 where key = 'teams.dm_welcome'
   and body not like '%IgDUQnqWTq0wS5tnvE3_Zcf5AfWTor8sPEPWH9L0UQFNhWA%';
