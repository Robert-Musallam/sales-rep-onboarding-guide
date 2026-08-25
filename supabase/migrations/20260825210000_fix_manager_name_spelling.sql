-- "Robert Mussallam" (double s) never matched his profile, so a rep assigned to
-- him resolved no manager email for the welcome-email bcc. Same spelling as
-- shared.profiles now.
update onboarding.app_settings
   set value = (
     select jsonb_agg(
              case when name = to_jsonb('Robert Mussallam'::text)
                   then to_jsonb('Robert Musallam'::text)
                   else name end
            )
       from jsonb_array_elements(value) as name
   )
 where key = 'managers'
   and value @> '["Robert Mussallam"]'::jsonb;

update onboarding.reps
   set manager_name = 'Robert Musallam'
 where manager_name = 'Robert Mussallam';
