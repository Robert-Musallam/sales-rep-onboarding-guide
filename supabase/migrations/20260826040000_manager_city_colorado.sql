-- Colorado is Travis Limbocker (told 2026-08-26). Every city is now mapped.
insert into onboarding.people (full_name, email, roles, territories, notes)
select 'Travis Limbocker', 'tlimbocker@rocknblocklandscape.com', '{manager}'::text[], '{Colorado}'::text[],
       'Colorado manager.'
 where not exists (
   select 1 from onboarding.people where full_name = 'Travis Limbocker' and 'manager' = any (roles)
 );
