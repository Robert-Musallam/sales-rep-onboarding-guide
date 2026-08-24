-- ============================================================================
-- M365 contact card settings + Gusto SMS spam note
-- ============================================================================
-- Companion to the worker change that (a) gives new Microsoft users their full
-- name as display name instead of initial+lastname, and (b) fills in the
-- "Manage contact information" fields in the M365 admin center from the rep's
-- info form. Job title and company are settings so they can change without a
-- deploy; office comes from the rep's territory and the address from the form.
-- ============================================================================

insert into onboarding.app_settings (key, value) values
  ('m365_job_title',    '"Design Consultant"'),
  ('m365_company_name', '"Rock N Block"')
on conflict (key) do nothing;

-- Reps kept missing the Gusto contract email because it landed in spam. Point
-- them at the junk folder and give them a person to ask.
update onboarding.message_templates
   set body = 'Hi {{first_name}}! We''ll be sending you an email shortly with your Gusto contract. Please sign it at your earliest convenience so we can officially begin your onboarding. If you don''t see it in your inbox, please check your spam or junk folder. If you have any questions, reach out to rmusallam@rocknblocklandscape.com. Thank you!'
 where key = 'sms.gusto_contract';
