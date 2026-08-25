-- Who the city intake form offers: Las Vegas is Leo Romero, San Diego is Mike
-- Reiser (told 2026-08-26).
--
-- Mike Reiser gets his OWN row rather than the "manager" role added to the one
-- he already has. That row is a Phone Room roster entry whose territories are
-- the chats he joins (Arizona, San Diego, OC/IE); narrowing it to San Diego to
-- express "manages San Diego" would quietly drop him out of two Phone Rooms.
-- One row per meaning, so the roster and the manager mapping can differ.
insert into onboarding.people (full_name, email, roles, territories, notes)
select 'Leo Romero', 'lromero@rocknblocklandscape.com', '{manager}'::text[], '{Las Vegas}'::text[],
       'Las Vegas manager.'
 where not exists (
   select 1 from onboarding.people where full_name = 'Leo Romero' and 'manager' = any (roles)
 );

insert into onboarding.people (full_name, email, roles, territories, notes)
select 'Mike Reiser', 'mreiser@rocknblocklandscape.com', '{manager}'::text[], '{San Diego}'::text[],
       'San Diego manager. Separate from his Phone Room roster row, which covers Arizona, San Diego and OC/IE.'
 where not exists (
   select 1 from onboarding.people where full_name = 'Mike Reiser' and 'manager' = any (roles)
 );
