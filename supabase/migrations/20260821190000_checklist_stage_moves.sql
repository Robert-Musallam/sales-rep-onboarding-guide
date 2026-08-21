-- The checklist owns the board: checking an item moves the card (see
-- STATUS_ON_COMPLETE in lib/onboarding/automations.ts). Gusto -> Contract Sent,
-- Microsoft license -> Provisioning. Says so on the items themselves, since the
-- description is what the manager reads before clicking.

update onboarding.checklist_templates
   set description = 'Manual in Gusto (pick territory, add rep, send contract). Checking moves the rep to Contract Sent and creates the Microsoft user in the background.'
 where key = 'gusto';

update onboarding.checklist_templates
   set description = 'Manual purchase/assign in M365 admin. Checking moves the rep to Provisioning and fires DM, Phone Room, territory chats + app SMS.'
 where key = 'm365_license';
