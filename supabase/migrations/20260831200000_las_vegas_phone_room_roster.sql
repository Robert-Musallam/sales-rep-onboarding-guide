-- Las Vegas Phone Room (told 2026-08-31): Marcela, Albert and Jorge join,
-- Fatima leaves. Same shape as the Arizona round earlier today — every one of
-- these rows already carries an explicit territory list, so this is add/remove
-- on that list rather than a scope change.
update onboarding.people
   set territories = array_remove(territories, 'Las Vegas'),
       notes = coalesce(notes || ' ', '') || 'Removed from the Las Vegas Phone Room 2026-08-31.',
       updated_at = now()
 where full_name = 'Fatima'
   and 'phone_room_roster' = any (roles)
   and 'Las Vegas' = any (territories);

update onboarding.people
   set territories = array_append(territories, 'Las Vegas'),
       notes = coalesce(notes || ' ', '') || 'Added to the Las Vegas Phone Room 2026-08-31.',
       updated_at = now()
 where full_name in ('Marcela Chavez', 'Albert Musallam', 'Jorge Daura')
   and 'phone_room_roster' = any (roles)
   and not ('Las Vegas' = any (territories));
