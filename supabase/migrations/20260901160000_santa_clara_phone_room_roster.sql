-- Santa Clara Phone Room (told 2026-09-01): Fatima and Rubi out; Marcela,
-- Albert, Jorge, Isabella Vidri and Travis Limbocker in.
--
-- Robert was named too but is deliberately NOT added: the worker builds the
-- chat as [admin_upn, rep, ...roster], and admin_upn is rmusallam@ — he is in
-- every Phone Room already. A roster row would put him in the member list
-- twice (UPN + azure id), which Graph can reject and would break chat creation
-- for every new rep.
--
-- Travis resolved against Graph first: tlimbocker@, the tenant's only Travis.
-- His M365 displayName carries a double space ("Travis  Limbocker"); stored
-- single-spaced here, since this table feeds the names people read.

update onboarding.people
   set territories = array_remove(territories, 'Santa Clara'),
       notes = coalesce(notes || ' ', '') || 'Removed from the Santa Clara Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Fatima', 'Rubi Pineda')
   and 'phone_room_roster' = any (roles)
   and 'Santa Clara' = any (territories);

update onboarding.people
   set territories = array_append(territories, 'Santa Clara'),
       notes = coalesce(notes || ' ', '') || 'Added to the Santa Clara Phone Room 2026-09-01.',
       updated_at = now()
 where full_name in ('Marcela Chavez', 'Albert Musallam', 'Jorge Daura', 'Isabella Vidri')
   and 'phone_room_roster' = any (roles)
   and cardinality(territories) > 0          -- never narrow an all-rooms row
   and not ('Santa Clara' = any (territories));

insert into onboarding.people (full_name, email, azure_user_id, roles, territories, notes)
select v.full_name, v.email, v.azure_user_id, '{phone_room_roster}'::text[], '{Santa Clara}'::text[],
       'Santa Clara Phone Room (added 2026-09-01).'
  from (values
    ('Travis Limbocker', 'tlimbocker@rocknblocklandscape.com', 'f68c1613-4978-4bd0-89a4-d4e54ff2ae04')
  ) as v(full_name, email, azure_user_id)
 where not exists (
   select 1 from onboarding.people p
    where p.azure_user_id = v.azure_user_id and 'phone_room_roster' = any (p.roles)
 );
