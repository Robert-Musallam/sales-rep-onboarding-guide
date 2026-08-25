-- Diego Guerrero joins the standing welcome-email bcc list.
update onboarding.app_settings
   set value = value || '["diego@rocknblocklandscape.com"]'::jsonb
 where key = 'welcome_email_bcc'
   and not (value @> '["diego@rocknblocklandscape.com"]'::jsonb);
