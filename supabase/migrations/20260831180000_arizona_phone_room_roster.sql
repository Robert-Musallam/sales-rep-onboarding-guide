-- Arizona Phone Room roster change (told 2026-08-31).
--
-- Adds five people to the Arizona room only, and takes Fatima out of Arizona.
-- Fatima was an all-territories roster member (territories = null), so removing
-- her from one city means naming the other seven explicitly. Consequence worth
-- knowing: if a new territory is ever added, she will NOT be picked up
-- automatically — add it to her row then.
insert into onboarding.people (full_name, email, azure_user_id, roles, territories, notes)
select v.full_name, v.email, v.azure_user_id, '{phone_room_roster}'::text[], '{Arizona}'::text[],
       'Arizona Phone Room (added 2026-08-31).'
  from (values
    ('Albert Musallam',  'Albert@rocknblocklandscape.com', 'b23fd503-0284-40f8-aa25-498f7f2b5ba6'),
    ('Jorge Daura',      'Jorge@rocknblocklandscape.com',  'e39a8081-fc5c-4e8a-83a3-9459969acf4a'),
    ('Isabella Vidri',   'pc5@rocknblocklandscape.com',    '1a684e81-f95a-42b6-9f40-6c2d1534eb02'),
    ('CJ Millenbah',     'CJM@rocknblocklandscape.com',    '5f0bda3d-656f-4137-81d2-17644a3cecdd'),
    ('Marcela Chavez',   'pm3@rocknblocklandscape.com',    '51b8ea02-6438-4c35-8063-8c08a3d52556')
  ) as v(full_name, email, azure_user_id)
 where not exists (
   select 1 from onboarding.people p
    where p.azure_user_id = v.azure_user_id and 'phone_room_roster' = any (p.roles)
 );

update onboarding.people
   set territories = (select array_agg(name order by name) from onboarding.territories where name <> 'Arizona'),
       notes = coalesce(notes || ' ', '') || 'Removed from the Arizona Phone Room 2026-08-31.',
       updated_at = now()
 where full_name = 'Fatima'
   and 'phone_room_roster' = any (roles);
