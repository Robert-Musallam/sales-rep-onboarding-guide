-- Utah Phone Room (told 2026-09-01): Fatima out; Marcela, Albert, Jorge and
-- Wade Draper in.
--
-- Note the asymmetry with the other rooms done today: Rubi STAYS in Utah. Only
-- Fatima was named, so only Fatima leaves.
--
-- Wade resolved against Graph first: wdraper@, Sales Lead, the tenant's only
-- Wade.

update onboarding.people
   set territories = array_remove(territories, 'Utah'),
       notes = coalesce(notes || ' ', '') || 'Removed from the Utah Phone Room 2026-09-01.',
       updated_at = now()
 where full_name = 'Fatima'
   and 'phone_room_roster' = any (roles)
   and 'Utah' = any (territories);

update onboarding.people
   set territories = array_append(territories, 'Utah'),
       notes = coalesce(notes || ' ', '') || 'Added to the Utah Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Marcela Chavez', 'Albert Musallam', 'Jorge Daura')
   and 'phone_room_roster' = any (roles)
   and cardinality(territories) > 0          -- never narrow an all-rooms row
   and not ('Utah' = any (territories));

insert into onboarding.people (full_name, email, azure_user_id, roles, territories, notes)
select v.full_name, v.email, v.azure_user_id, '{phone_room_roster}'::text[], '{Utah}'::text[],
       'Utah Phone Room (added 2026-09-01).'
  from (values
    ('Wade Draper', 'wdraper@rocknblocklandscape.com', 'f5a355d1-ea1a-432e-9cfd-7d2010155367')
  ) as v(full_name, email, azure_user_id)
 where not exists (
   select 1 from onboarding.people p
    where p.azure_user_id = v.azure_user_id and 'phone_room_roster' = any (p.roles)
 );
