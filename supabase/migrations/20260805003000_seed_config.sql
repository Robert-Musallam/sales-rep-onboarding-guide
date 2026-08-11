-- ============================================================================
-- RNB Onboarding — seed config, extracted from Make scenario 4777508
-- ("Add new sales reps in Teams", captured 2026-08-04)
-- ============================================================================
-- Everything here is EDITABLE in Settings — this seed just means day 1 behaves
-- exactly like the Make scenario did. Idempotent (on conflict do nothing/update).
-- ============================================================================

-- ── Territories (chat ids from the Make per-territory routes) ───────────────
insert into onboarding.territories (name, post_sales_chat_ids) values
  ('Las Vegas',   '["19:0128823e01664061a7f1f8b064d2c758@thread.v2"]'),
  ('Utah',        '["19:0128823e01664061a7f1f8b064d2c758@thread.v2"]'),
  ('Arizona',     '["19:e20c83e1328e48c1bc88c1d1b93e85b7@thread.v2"]'),
  ('San Diego',   '["19:e20c83e1328e48c1bc88c1d1b93e85b7@thread.v2"]'),
  ('OC/IE',       '["19:e20c83e1328e48c1bc88c1d1b93e85b7@thread.v2"]'),
  ('Santa Clara', '["19:5141cf5011eb4ec2a28a822f62181a4e@thread.v2"]'),
  ('Tampa',       '["19:fd1bf4c32f06479f8690e3136312b32e@thread.v2"]'),
  ('Colorado',    '[]')
on conflict (name) do nothing;

-- ── People ──────────────────────────────────────────────────────────────────
-- Named territory-conditional Phone Room members (from the Make member-add routes):
insert into onboarding.people (full_name, azure_user_id, roles, territories) values
  ('Mike Reiser',       '77c21aac-d33b-4846-b1a3-269108dc5a85', '{phone_room_roster}', '{Arizona,"San Diego","OC/IE"}'),
  ('Greg Zamora',       '53811199-5db1-439a-9ca7-7a37d1e1a902', '{phone_room_roster}', '{Arizona,"San Diego","OC/IE"}'),
  ('Jason Talmage',     'c925d0bb-f278-4b0e-b1df-a91cc4c6e389', '{phone_room_roster}', '{"OC/IE"}'),
  ('Branden Haire',     '246d1659-5a84-4ffc-a822-3d1ccee63368', '{phone_room_roster}', '{Arizona}'),
  ('Chris Faronea',     '9dfe943d-fc06-442c-a350-2bcefac147ed', '{phone_room_roster}', '{Tampa}'),
  ('Chris Faronea (LV)','6ce04ade-872c-4023-81b2-42b995c06779', '{phone_room_roster}', '{"Las Vegas"}')
on conflict do nothing;

-- Static Phone Room roster (every territory). Azure ids from the Make
-- group-chat creation body; names resolved from public.phone_room_members.
insert into onboarding.people (full_name, azure_user_id, roles) values
  ('Fatima',             '80cef52e-6680-483d-b72c-92b8447d3ce2', '{phone_room_roster}'),
  ('Rubi Pineda',        '3f002dfd-0efa-4725-87f5-ec12d3bccdd6', '{phone_room_roster}'),
  ('Mariana Handal',     '53ad72e4-0705-48fe-9db9-4f522847f8c8', '{phone_room_roster}'),
  ('Alejandra Plata',    '1cd978f0-d8f2-45bd-a553-5604d9ad9538', '{phone_room_roster}'),
  ('Maria Jose Climaco', '45d9f75b-4b4c-44cd-a668-c6e3ffa39917', '{phone_room_roster}'),
  ('Sarah Santos',       'ae6cd0ca-5dd0-4b02-aac4-843e3e7e3fba', '{phone_room_roster}'),
  ('Carmen de Zamora',   '5c511d81-7a57-4b45-8dde-f640137add44', '{phone_room_roster}'),
  ('Diego Guerrero',     'c6c1d617-27f7-4b3c-bc08-0150017c5e9d', '{phone_room_roster}'),
  ('Carlos Caceres',     'a65d1c36-8f2f-43f1-af1c-cd437b135a44', '{phone_room_roster}'),
  ('Ronald',             'bc4fc91a-a213-4199-9f24-1ea404500ff2', '{phone_room_roster}'),
  ('Daniela Belismelis', '5ea5426a-3de5-4392-a566-492f3f42be7c', '{phone_room_roster}')
on conflict do nothing;

-- ── App settings ────────────────────────────────────────────────────────────
insert into onboarding.app_settings (key, value) values
  ('admin_upn',                 '"rmusallam@rocknblocklandscape.com"'),
  ('rnb_email_domain',          '"rocknblocklandscape.com"'),
  ('company_wide_chat_id',      '"19:4678713ea9514c688202de5cccaa905d@thread.v2"'),
  ('notify_chat_id',            '"19:meeting_MGRkMGViMzYtNjExOC00MjE1LThiMzUtN2MwN2QwNTMyODYw@thread.v2"'),
  ('dialpad_from_number',       '"+17027448078"'),
  ('welcome_email_sender',      '""'),   -- REQUIRED before go-live (SETUP.md §2) — deliberately NOT info.colorado
  ('welcome_email_bcc',         '["josebrest25@gmail.com", "Rmusallam@rocknblocklandscape.com"]'),
  ('business_card_contact_email', '""'), -- fill in Settings before enabling that step
  ('jotform_info_form_id',      '"261665616138664"'),
  ('jotform_manager_form_id',   '"261604930668664"'),  -- legacy (replaced by /intake)
  ('jotform_checklist_form_id', '"261607668684673"')   -- legacy (replaced by rep drawer)
on conflict (key) do nothing;

-- ── Checklist template ──────────────────────────────────────────────────────
-- automation_key names the action bundle enqueued when the item is checked
-- (resolved in lib/onboarding/automations.ts). auto=true items are completed by
-- the system when their bundle finishes, matching today's Make behavior.
insert into onboarding.checklist_templates (key, label, sort_order, automation_key, auto, description) values
  ('gusto',            'Gusto: rep added + contract sent',        10, 'gusto_done',    false, 'Manual in Gusto (pick territory, add rep, send contract). Checking creates the Microsoft user.'),
  ('m365_license',     'Microsoft license assigned',              30, 'license_done',  false, 'Manual purchase/assign in M365 admin. Checking fires DM, Phone Room, territory chats + app SMS.'),
  ('welcome_message',  'Welcome message sent',                    40, 'welcome_done',  false, 'Checking posts the company-wide announcement and sends the welcome email.'),
  ('team_channel',     'Team channels created',                   50, null,            true,  'Completed automatically by the welcome bundle.'),
  ('hcp_user',         'Housecall Pro user created',              60, 'hcp_done',      false, 'Create the employee manually in the HCP UI; checking verifies it via API and records the employee id.'),
  ('greensky',         'GreenSky approval submitted',             70, null,            false, 'Rep-driven; instructions surface on the rep''s onboarding hub.'),
  ('business_cards',   'Business cards ordered',                  80, 'cards_done',    false, 'Checking emails the business-card contact with the rep''s details.'),
  ('training',         'Training curriculum passed',              90, null,            true,  'Completed automatically when the rep passes the final quiz.')
on conflict (key) do nothing;

-- ── Message templates (verbatim from the Make scenario; vars = {{snake_case}}) ─
insert into onboarding.message_templates (key, channel, subject, body, description) values
  ('sms.invite', 'sms', null,
   'Hi {{first_name}}, Welcome to Rock N Block! Over the next few days, we''ll collect your information, set up your employee profile in Gusto, create your Microsoft Teams account, and complete the required onboarding steps. To help us prepare, please complete the following form: {{info_form_link}}. Once we receive your information, we''ll continue with the remaining setup and keep you updated. Welcome to the team!',
   'Sent when a manager submits the intake form.'),
  ('sms.gusto_contract', 'sms', null,
   'Hi {{first_name}}! We''ll be sending you an email shortly with your Gusto contract. Please sign it at your earliest convenience so we can officially begin your onboarding. Thank you!',
   'Sent when the rep''s info form is received.'),
  ('sms.app_download_ios', 'sms', null,
   E'Hi {{first_name}}, as part your onboarding, you are required to download Microsoft Teams and WhatsApp to your phone. I am providing the links to the App Store for you to download them.\n\nPlease let us know if you have any questions.\n\nMicrosoft Teams: https://apps.apple.com/us/app/microsoft-teams/id1113153706\n\nWhatsApp: https://apps.apple.com/us/app/whatsapp-messenger/id310633997',
   'Part of the welcome bundle — iOS phones.'),
  ('sms.app_download_android', 'sms', null,
   E'Hi {{first_name}}, as part your onboarding, you are required to download Microsoft Teams and WhatsApp to your phone. I am providing the links to the App Store for you to download them.\n\nPlease let us know if you have any questions.\n\nMicrosoft Teams: https://play.google.com/store/apps/details?id=com.microsoft.teams\n\nWhatsApp: https://play.google.com/store/apps/details?id=com.whatsapp',
   'Part of the welcome bundle — Android phones.'),
  ('teams.dm_welcome', 'teams', null,
   E'Hey {{first_name}}, welcome aboard. I''m going to walk you through how we report to the team about your sales. Basically, for every sale, you will fill out a form with key details about the sale. Once you submit, the form will post those details to the sales channel on your behalf but also populate the data into the production team system. This way the back end staff is able to more rapidly process your transactions. For any change orders to that sale, you will need to post the details of the change order manually in the chat. Typically, that means just reporting how much was added or subtracted from the initial sale.\n\nOnce you make a sale and copy an estimate to a job, you''ll get a message from me with a link to where you can enter the data from your sales. The form is fairly straightforward but you are always welcome to reach out f you have any questions. I''m here to help.',
   '1:1 DM sent after the Microsoft license is assigned.'),
  ('teams.phone_room_welcome', 'teams', null,
   'Hey {{first_name}}, this is your official communication chanel with the office and our phone room. Any questions or comments we are happy to help you out through here! Welcome!!',
   'First message in the rep''s new Phone Room group chat.'),
  ('teams.company_announcement', 'teams', null,
   E'🎉 <strong>Please join me in welcoming {{first_name}} {{last_name}} to the team!</strong> 🎉<br>\n{{first_name}} is joining us as our newest <strong>Design Consultant</strong> and will be based out of our <strong>{{territory}}</strong> office.<br><br>\nFeel free to drop a comment below or send a quick message to say hello and welcome them aboard! 👋 ✨',
   'Posted in the company-wide chat.'),
  ('teams.notify_info_submitted', 'teams', null,
   E'<div style="font-family: Arial, sans-serif; padding: 15px; border-left: 4px solid #3b82f6; background-color: #f8fafc; line-height: 1.5;">\n  <b style="color: #1e3a8a; font-size: 16px;">📝 New form registration submitted</b><br>\n  <b>Manager:</b> {{manager_name}}<br>\n  <b>Location:</b> {{territory}}<br>\n  <b>Rep:</b> {{first_name}} {{last_name}}<br>\n<b>Open in Onboarding:</b> <a href="{{rep_url}}">{{first_name}} {{last_name}}</a></div>',
   'Posted to the notify chat when a rep submits their info form.'),
  ('email.welcome', 'email', 'Welcome to the Rock N Block Family!',
   '@file:welcome_email.html',
   'Welcome email. Body loads from worker/templates/welcome_email.html (full captured HTML); replace via Settings to inline-edit.'),
  ('email.business_cards', 'email', 'Business card request — {{first_name}} {{last_name}}',
   E'Hi,\n\nPlease order business cards for our new Design Consultant:\n\nName: {{first_name}} {{last_name}}\nEmail: {{rnb_email}}\nPhone: {{phone}}\nTerritory: {{territory}}\n\nThank you!',
   'Sent to the business-card contact when that checklist item is checked.')
on conflict (key) do nothing;
