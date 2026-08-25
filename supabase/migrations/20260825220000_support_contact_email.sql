-- Contact shown in the welcome email's closing block: questions go to Robert,
-- not to the sender (Jorge). Settings-editable so the contact can change
-- without touching worker/templates/welcome_email.html.
insert into onboarding.app_settings (key, value)
values ('support_contact_email', '"rmusallam@rocknblocklandscape.com"')
on conflict (key) do nothing;
