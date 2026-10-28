-- Business cards (told 2026-10-28): "Business cards ordered" has had an action,
-- a template and a Holding OS mapping since August, but the checklist template
-- lost its automation_key, nothing was configured and the email never went out.
-- This wires it up: the order goes to Robert for now, from his own mailbox, and
-- names the office it ships to.

-- Where the cards ship. Seeded from each office's Housecall Pro company profile
-- (read 2026-10-28). OC/IE's HCP key answers 401, so it stays empty until it is
-- filled in Holding OS → RNB → Settings → Territories; the action refuses to
-- send a request without an address.
alter table onboarding.territories add column if not exists shipping_address text;

update onboarding.territories t
   set shipping_address = v.addr
  from (values
    ('Arizona',     '2942 N 24th St Suite 115, Phoenix, AZ 85016'),
    ('Colorado',    '220 S Wilcox St #626, Castle Rock, CO 80104'),
    ('Las Vegas',   '3267 N Torrey Pines Dr, Las Vegas, NV 89108'),
    ('San Diego',   '3517 Camino del Rio S Suite 215, San Diego, CA 92108'),
    ('Santa Clara', '1177 Branham Ln #1023, San Jose, CA 95118'),
    ('Tampa',       '4005 Ohio Ave, Tampa, FL 33616'),
    ('Utah',        '1324 Sandhill Dr #4, Washington, UT 84780')
  ) as v(name, addr)
 where t.name = v.name
   and t.shipping_address is null;

-- Ticking the item queues email.business_cards (Holding OS maps cards_done to
-- it). Items already instantiated on reps copied the empty key, so fix those
-- too; done items are left alone.
update onboarding.checklist_templates
   set automation_key = 'cards_done'
 where key = 'business_cards'
   and automation_key is null;

update onboarding.checklist_items
   set automation_key = 'cards_done'
 where template_key = 'business_cards'
   and automation_key is null;

-- Recipient (only if still unset) and the mailbox the request is sent from.
insert into onboarding.app_settings (key, value)
values ('business_card_contact_email', '"Rmusallam@rocknblocklandscape.com"')
on conflict (key) do update
   set value = excluded.value
 where onboarding.app_settings.value in ('""', 'null');

insert into onboarding.app_settings (key, value)
values ('business_card_sender_email', '"Rmusallam@rocknblocklandscape.com"')
on conflict (key) do nothing;

-- The order, in the exact wording ops asked for. Plain text; the action turns
-- line breaks into <br>.
update onboarding.message_templates
   set body = E'Hi Shiela,\n\nPlease order 500 business cards for the following new Rock N Block Design Consultant:\n\n* {{first_name}} {{last_name}}\n* {{phone_display}}\n\nIt will be sent to the {{territory}} office located at {{shipping_address}}.\n\nThank you,\nRock N Block',
       updated_at = now()
 where key = 'email.business_cards';
