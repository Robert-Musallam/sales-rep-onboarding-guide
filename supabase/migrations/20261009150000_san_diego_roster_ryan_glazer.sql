-- San Diego Phone Room (told 2026-10-09): Ryan Glazer in.
--
-- Resolved against Graph before writing, same rule as the 2026-09-01 round:
-- a26ab816-7e6a-4c31-88f6-2e50dd488554 is rglazer@rocknblocklandscape.com,
-- "Sales Manager", office San Diego. Scoped to San Diego only — he was named
-- for this room, and an empty territory list would put him in every room.
-- Idempotent: a second run finds the roster row and inserts nothing.

insert into onboarding.people (full_name, email, azure_user_id, roles, territories, notes)
select 'Ryan Glazer', 'rglazer@rocknblocklandscape.com', 'a26ab816-7e6a-4c31-88f6-2e50dd488554',
       '{phone_room_roster}'::text[], '{San Diego}'::text[],
       'San Diego Phone Room (added 2026-10-09).'
 where not exists (
   select 1 from onboarding.people p
    where p.azure_user_id = 'a26ab816-7e6a-4c31-88f6-2e50dd488554'
      and 'phone_room_roster' = any (p.roles)
 );
