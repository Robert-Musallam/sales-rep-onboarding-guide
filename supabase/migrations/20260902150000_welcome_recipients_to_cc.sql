-- The welcome email's standing distribution list moves from bcc to cc, and
-- Jorge Daura comes off it: he is the configured sender, so Exchange already
-- files his copy in Sent Items.
--
-- The key is renamed alongside the behaviour so app_settings stays honest —
-- worker/actions.ts and the Settings help text read 'welcome_email_cc' as of
-- this migration. Everyone on the list is now visible to the rep.
update onboarding.app_settings
   set value = value - 'Jorge@rocknblocklandscape.com'
 where key = 'welcome_email_bcc';

update onboarding.app_settings
   set key = 'welcome_email_cc'
 where key = 'welcome_email_bcc';
