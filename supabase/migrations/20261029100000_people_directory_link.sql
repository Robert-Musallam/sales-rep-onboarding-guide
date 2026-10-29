-- Settings → People follows the Company Directory (told 2026-10-29). The hourly
-- directory pass fills email and phone from the workbook and remembers which
-- workbook row each person is, so later passes never guess by name again.
alter table onboarding.people add column if not exists directory_source_key text;

-- Three names were half-typed or differ from the workbook; align them once.
-- The Phone Room roster and the manager lookup key on the azure id and the
-- manager role, not on these strings, so nothing else moves.
update onboarding.people p
   set full_name = v.name
  from (values (7, 'Fatima Zavala'), (16, 'Ronald Rendon'), (6, 'Leo Romero')) as v(id, name)
 where p.id = v.id
   and p.full_name <> v.name;
