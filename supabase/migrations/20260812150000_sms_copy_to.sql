-- Ops copy of EVERY outbound SMS (invite, gusto contract, app download, …).
-- Supersedes the gusto-only gusto_sms_copy_to; the worker's sendSmsCopy reads
-- sms_copy_to first and falls back to gusto_sms_copy_to.
insert into onboarding.app_settings (key, value) values
  ('sms_copy_to', '"+14084105938"')
on conflict (key) do update set value = excluded.value;
