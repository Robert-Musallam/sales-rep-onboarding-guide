-- San Diego Phone Room (told 2026-09-01): Fatima and Rubi out; Marcela, Jorge,
-- Albert, Alejandro Apostolo and Jose Viveros in.
--
-- Fatima and Rubi already carry explicit territory lists (made explicit during
-- the Arizona round on 2026-08-31), so dropping San Diego is a list edit, not a
-- scope change. Marcela/Jorge/Albert likewise — they were seeded explicit.
--
-- Alejandro and Jose are new roster rows. Both resolved against Graph before
-- writing (pc3@ / jviveros@, accounts enabled) rather than trusting a typed
-- name — the 2026-08-31 round found two roster rows whose names no longer
-- matched the mailbox behind the azure id. Scoped to San Diego only: they were
-- named for this room, so an empty list (= every room) would over-add them.

update onboarding.people
   set territories = array_remove(territories, 'San Diego'),
       notes = coalesce(notes || ' ', '') || 'Removed from the San Diego Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Fatima', 'Rubi Pineda')
   and 'phone_room_roster' = any (roles)
   and 'San Diego' = any (territories);

update onboarding.people
   set territories = array_append(territories, 'San Diego'),
       notes = coalesce(notes || ' ', '') || 'Added to the San Diego Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Marcela Chavez', 'Albert Musallam', 'Jorge Daura')
   and 'phone_room_roster' = any (roles)
   and cardinality(territories) > 0          -- never narrow an all-rooms row
   and not ('San Diego' = any (territories));

insert into onboarding.people (full_name, email, azure_user_id, roles, territories, notes)
select v.full_name, v.email, v.azure_user_id, '{phone_room_roster}'::text[], '{San Diego}'::text[],
       'San Diego Phone Room (added 2026-09-01).'
  from (values
    ('Alejandro Apostolo', 'pc3@rocknblocklandscape.com',       '3b3f41bb-e2b1-4004-97df-8d28c6370e33'),
    ('Jose Viveros',       'jviveros@rocknblocklandscape.com',  'dfbf9f2a-5499-41af-9d36-99f5e2a6f890')
  ) as v(full_name, email, azure_user_id)
 where not exists (
   select 1 from onboarding.people p
    where p.azure_user_id = v.azure_user_id and 'phone_room_roster' = any (p.roles)
 );
