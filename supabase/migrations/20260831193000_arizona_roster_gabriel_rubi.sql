-- Arizona Phone Room, round 2 (told 2026-08-31).
--
-- Data-truth first: two roster rows carried stale names. Resolving every roster
-- azure_user_id against Graph showed the mailbox behind "Carmen de Zamora"
-- (sc6@) is now Gabriel Loucel, and the one behind "Chris Faronea (LV)" is
-- actually Leonardo Romero. The chats never noticed — membership is by azure id
-- — but the names people read were wrong. Renaming, not re-adding: "add Gabriel,
-- drop Carmen" is one and the same account.
update onboarding.people
   set full_name = 'Gabriel Loucel',
       email = 'sc6@rocknblocklandscape.com',
       notes = coalesce(notes || ' ', '') || 'Renamed from "Carmen de Zamora" 2026-08-31: the sc6@ mailbox belongs to Gabriel Loucel in M365.',
       updated_at = now()
 where full_name = 'Carmen de Zamora'
   and azure_user_id = '5c511d81-7a57-4b45-8dde-f640137add44';

update onboarding.people
   set full_name = 'Leonardo Romero',
       email = 'lromero@rocknblocklandscape.com',
       notes = coalesce(notes || ' ', '') || 'Renamed from "Chris Faronea (LV)" 2026-08-31: that azure id is Leo Romero, the Las Vegas manager.',
       updated_at = now()
 where full_name = 'Chris Faronea (LV)'
   and azure_user_id = '6ce04ade-872c-4023-81b2-42b995c06779';

-- Rubi Pineda out of Arizona only (she stays in the other seven rooms). Same
-- caveat as Fatima: her territories are now explicit, so a brand-new territory
-- will not include her automatically.
update onboarding.people
   set territories = (select array_agg(name order by name) from onboarding.territories where name <> 'Arizona'),
       notes = coalesce(notes || ' ', '') || 'Removed from the Arizona Phone Room 2026-08-31.',
       updated_at = now()
 where full_name = 'Rubi Pineda'
   and 'phone_room_roster' = any (roles);
