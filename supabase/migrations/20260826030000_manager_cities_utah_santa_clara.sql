-- Utah is Wade Draper, Santa Clara is Robert Musallam (told 2026-08-26).
-- Colorado is still unmapped: its link offers the full manager list.
insert into onboarding.people (full_name, email, roles, territories, notes)
select 'Wade Draper', 'wdraper@rocknblocklandscape.com', '{manager}'::text[], '{Utah}'::text[], 'Utah manager.'
 where not exists (
   select 1 from onboarding.people where full_name = 'Wade Draper' and 'manager' = any (roles)
 );

insert into onboarding.people (full_name, email, roles, territories, notes)
select 'Robert Musallam', 'rmusallam@rocknblocklandscape.com', '{manager}'::text[], '{Santa Clara}'::text[],
       'Santa Clara manager.'
 where not exists (
   select 1 from onboarding.people where full_name = 'Robert Musallam' and 'manager' = any (roles)
 );
