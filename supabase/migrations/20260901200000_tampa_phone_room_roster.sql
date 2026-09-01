-- Tampa Phone Room (told 2026-09-01): Fatima, Chris and Rubi out; Marcela,
-- Albert, Jorge and Isabella Vidri in.
--
-- Chris is deactivated rather than territory-stripped, and that difference
-- matters. Tampa was his ONLY territory, and the worker reads an empty
-- territories array as "every room" (actions.ts: !p.territories?.length ||
-- includes(territory)). So array_remove('Tampa') would have emptied his list
-- and put him in all eight rooms — the exact opposite of taking him out.
-- active = false is the honest way to say "off the roster"; it is equivalent to
-- removing him from Tampa because Tampa was all he had. Reinstate by flipping
-- active back and setting a territory list.
--
-- Fatima and Rubi keep other rooms after this, so for them array_remove is
-- right: Fatima -> {Colorado}, Rubi -> {Colorado, Las Vegas, Utah}.
--
-- Both Chris's and Isabella's azure ids were resolved against Graph first
-- (cfaronea@ Design Consultant, pc5@ Project Coordinator) — this Chris row is
-- the sibling of the one renamed to Leonardo Romero on 2026-08-31, so it was
-- worth confirming it points where the name says.

update onboarding.people
   set active = false,
       notes = coalesce(notes || ' ', '') || 'Off the Phone Room roster 2026-09-01 (removed from Tampa, his only room; deactivated rather than emptying territories, which would have meant every room).',
       updated_at = now()
 where full_name = 'Chris Faronea'
   and azure_user_id = '9dfe943d-fc06-442c-a350-2bcefac147ed'
   and 'phone_room_roster' = any (roles);

update onboarding.people
   set territories = array_remove(territories, 'Tampa'),
       notes = coalesce(notes || ' ', '') || 'Removed from the Tampa Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Fatima', 'Rubi Pineda')
   and 'phone_room_roster' = any (roles)
   and 'Tampa' = any (territories)
   and cardinality(territories) > 1;         -- never empty a list: empty = every room

update onboarding.people
   set territories = array_append(territories, 'Tampa'),
       notes = coalesce(notes || ' ', '') || 'Added to the Tampa Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Marcela Chavez', 'Albert Musallam', 'Jorge Daura', 'Isabella Vidri')
   and 'phone_room_roster' = any (roles)
   and cardinality(territories) > 0          -- never narrow an all-rooms row
   and not ('Tampa' = any (territories));
