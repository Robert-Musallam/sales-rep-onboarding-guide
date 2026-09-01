-- OC/IE Phone Room (told 2026-09-01): Fatima and Rubi out; Marcela, Jorge,
-- Albert, Alejandro Apostolo and Jose Viveros in. Same five-in/two-out shape as
-- the San Diego round earlier today.
--
-- Alejandro and Jose already exist on the roster as of 20260901120000 (scoped
-- {San Diego}), so this appends OC/IE to their list rather than inserting —
-- inserting again would create a second row for the same azure id and put them
-- in the chat twice.

update onboarding.people
   set territories = array_remove(territories, 'OC/IE'),
       notes = coalesce(notes || ' ', '') || 'Removed from the OC/IE Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Fatima', 'Rubi Pineda')
   and 'phone_room_roster' = any (roles)
   and 'OC/IE' = any (territories);

update onboarding.people
   set territories = array_append(territories, 'OC/IE'),
       notes = coalesce(notes || ' ', '') || 'Added to the OC/IE Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Marcela Chavez', 'Albert Musallam', 'Jorge Daura',
                     'Alejandro Apostolo', 'Jose Viveros')
   and 'phone_room_roster' = any (roles)
   and cardinality(territories) > 0          -- never narrow an all-rooms row
   and not ('OC/IE' = any (territories));
