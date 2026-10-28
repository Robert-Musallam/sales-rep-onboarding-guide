-- The order shows the card as it prints (told 2026-10-28): name in bold, the
-- title, the RNB email and the cell with dots. Plain text; the action turns
-- line breaks into <br> and sends HTML, so the <b> renders.
update onboarding.message_templates
   set body = E'Hi Sheila,\n\nPlease order 500 business cards for the following new Rock N Block Design Consultant:\n\n<b>{{first_name}} {{last_name}}</b>\nDesign Consultant\n{{rnb_email}}\n{{phone_dots}}\n\nIt will be sent to the {{territory}} office located at {{shipping_address}}.\n\nThank you,\nRock N Block',
       updated_at = now()
 where key = 'email.business_cards';
