-- Company directory (told 2026-10-19): once a rep is welcomed, the worker adds
-- them to "Rock N Block Company Directory.xlsx" (SharePoint site SRC,
-- 1 - Rock N Block Corporate / 2 - Admin / Company Directory) at the end of
-- their office's "<City> - Sales & Production" block.
--
-- The workbook is addressed by Graph ids, not by path, so a rename does not
-- break it; a re-created file is a settings change here. The worksheet id is
-- the first sheet ("Rock N Block Company Directory"). All three resolved
-- against Graph on 2026-10-19.
insert into onboarding.app_settings (key, value) values
  ('company_directory_drive_id',     '"b!YUMh3gEp7UiBqAiRNFH0BiGGkw25tzZKrCLM5lIbnXyTSbF6djC8Rr9OWeu2TSHt"'),
  ('company_directory_item_id',      '"01VLF6EZ5XJZ5KP52OTBAYLZSOGZ4AOYEI"'),
  ('company_directory_worksheet_id', '"{00000000-0001-0000-0000-000000000000}"')
on conflict (key) do nothing;
