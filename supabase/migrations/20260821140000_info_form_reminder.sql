-- One 24h nudge for a rep who was invited but never filled the info form.
-- Enqueued by worker/sweeps.ts (sweepInfoFormReminders) with run_after =
-- invite + info_reminder_after_hours, executed by the rep.info_form_reminder
-- handler. dedupe_key `info_reminder:*` caps it at one reminder per rep, ever.

insert into onboarding.message_templates (key, channel, subject, body, description) values
  ('sms.info_form_reminder', 'sms', null,
   'Hi {{first_name}}, following up on your Rock N Block onboarding. We have not received your information form yet, and we need it to set up your Gusto profile and Teams account. Please complete it here: {{info_form_link}}
Thank you!',
   'Sent 24h after the invite when the rep has not submitted their info form.')
on conflict (key) do update set body = excluded.body, description = excluded.description;

-- Sweep knobs. Defaults live in worker/sweeps.ts too, so a missing row is safe;
-- these exist so the cadence can be tuned (or the sweep switched off) from the
-- database without a deploy.
insert into onboarding.app_settings (key, value) values
  ('info_reminder_enabled', 'true'),          -- false disables the sweep entirely
  ('info_reminder_after_hours', '24'),        -- delay measured from the invite SMS
  ('info_reminder_max_age_hours', '168'),     -- older invites are left alone
  ('info_reminder_window_start', '9'),        -- local send window, inclusive
  ('info_reminder_window_end', '19'),         -- local send window, exclusive
  ('info_reminder_timezone', '"America/Los_Angeles"')
on conflict (key) do nothing;
