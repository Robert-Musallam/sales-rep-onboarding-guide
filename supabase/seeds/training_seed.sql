-- ============================================================================
-- Training curriculum seed — first-draft proposal (2026-08-07)
-- ============================================================================
-- 5 courses → lessons → 1 final readiness quiz (80% pass, gates the checklist).
-- Content drafted from the manager's guide + captured onboarding flow; every
-- word is editable in the webapp (/training). Idempotent-ish: skips if courses
-- already exist.
do $$
declare
  c1 bigint; c2 bigint; c3 bigint; c4 bigint; c5 bigint; qz bigint;
begin
  if (select count(*) from training.courses) > 0 then
    raise notice 'training.courses not empty — seed skipped';
    return;
  end if;

  -- ── Course 1 ──────────────────────────────────────────────────────────────
  insert into training.courses (title, description, sort_order) values
    ('Welcome to Rock N Block', 'Who we are, how your first week works, and getting your accounts and apps ready.', 10)
    returning id into c1;
  insert into training.lessons (course_id, title, content_md, sort_order) values
  (c1, 'Who we are', E'Rock N Block is a fast-growing outdoor-living company operating across multiple markets: Las Vegas, Arizona, San Diego, OC/IE, Santa Clara, Utah, Tampa and Colorado.\n\nAs a Design Consultant you are the face of the company: you meet homeowners, design their project, price it, and close the sale. The back office (phone room, production, and payments teams) supports you at every step — but the customer relationship is yours.\n\nWhat we value:\n- Show up on time, every time. Leads are expensive and homeowners talk.\n- Communicate in the channels we give you — that is how the office backs you up fast.\n- Sell projects we can build profitably and proudly.', 10),
  (c1, 'Your first week', E'Here is what happens after you sign your Gusto contract:\n\n1. Your Microsoft account is created (email + Teams). You will receive a temporary password — sign in and change it right away.\n2. You are added to three Teams spaces: a 1:1 chat with the office, your "Phone Room" group (your direct line to the people who book and confirm your appointments), and your region''s sales channel.\n3. You receive a welcome email at your new company address with your first-week steps.\n4. Your Housecall Pro user is created — that is where your appointments, estimates and jobs live.\n5. You complete this training and pass the readiness test. After that, you run leads.', 20),
  (c1, 'Apps you must install', E'Install these on your phone before your first lead:\n\n- **Microsoft Teams** — all internal communication. Check it daily.\n- **WhatsApp** — used by several regional teams for quick coordination.\n- **Housecall Pro** — your schedule, customer details, estimates, and jobs.\n\nSign into each with your new company email. If anything will not let you in, say so in your Phone Room chat — do not wait until the day of a lead.', 30);

  -- ── Course 2 ──────────────────────────────────────────────────────────────
  insert into training.courses (title, description, sort_order) values
    ('Your Tools: Housecall Pro & Teams', 'The two systems you will live in: HCP for appointments/estimates/jobs, Teams for communication.', 20)
    returning id into c2;
  insert into training.lessons (course_id, title, content_md, sort_order) values
  (c2, 'Housecall Pro basics', E'Housecall Pro (HCP) is your operating system in the field:\n\n- **Schedule**: your appointments appear on your HCP calendar. Review it every evening for the next day.\n- **Customer record**: address, phone, notes from the phone room. Read it BEFORE you arrive.\n- **Estimates**: you build and present your quote in HCP at the kitchen table.\n- **Jobs**: when a customer signs, the estimate is copied to a job — that is what production builds from.\n\nRule of thumb: if it is not in HCP, it did not happen.', 10),
  (c2, 'Teams: your three chats', E'You have three Teams spaces, each with a purpose:\n\n1. **1:1 chat with the office** — official communication line. Sales-reporting links arrive here.\n2. **Your Phone Room group** — the people who book, confirm, and reschedule your appointments. Running late? Customer no-show? Say it here immediately.\n3. **Regional sales channel** — your market''s sales team: announcements, results, and change-order posts.\n\nResponse expectation: during work hours, minutes — not hours. Your appointments depend on it.', 20),
  (c2, 'Phone room etiquette', E'The phone room fills your calendar. Help them help you:\n\n- Confirm your schedule for the next day in your Phone Room chat every evening.\n- If a customer calls you directly to reschedule, tell the phone room right away so the calendar stays true.\n- After each appointment, report the outcome (sold / follow-up / no-sale + reason). That feeds rehash and follow-up work that often turns into more sales for you.', 30);

  -- ── Course 3 ──────────────────────────────────────────────────────────────
  insert into training.courses (title, description, sort_order) values
    ('The RNB Sales Process', 'From lead to signed job: preparation, the in-home consultation, pricing, and closing.', 30)
    returning id into c3;
  insert into training.lessons (course_id, title, content_md, sort_order) values
  (c3, 'Before the appointment', E'Winners are made before the doorbell rings:\n\n- Review the customer record in HCP: what they asked for, lot details, any photos or notes from the phone room.\n- Look at the property on satellite view — know the approximate yard size and access before you arrive.\n- Arrive 5 minutes early, clean truck, RNB shirt. First impressions price the job.', 10),
  (c3, 'The in-home consultation', E'A proven consultation has a shape:\n\n1. **Build rapport** — a few genuine minutes; find out who lives here and how they want to use the space.\n2. **Discover** — walk the yard WITH them. Ask what they love, what frustrates them, what they have seen and liked. Budget conversation happens here, naturally.\n3. **Design** — sketch the vision together. They should feel it is THEIR design.\n4. **Price with confidence** — build the estimate in HCP on site. Present the full-value option first.\n5. **Ask for the business** — every time, at the table. "If the numbers work, is there any reason we would not get you on the schedule today?"', 20),
  (c3, 'Handling objections & closing', E'The big four objections and honest answers:\n\n- **"It''s too expensive"** — rebuild value before touching price: materials, warranty, licensed crews, timeline certainty. Then explore scope options and financing.\n- **"We need to think about it"** — surface the real concern: "Totally fair — is it the design, the timing, or the investment?"\n- **"We''re getting other bids"** — welcome it, then anchor: what to compare (scope detail, materials, license/insurance, start date). Leave them a reason to call you back.\n- **"We can''t afford it right now"** — this is the financing conversation (next course).\n\nClose the day you are there whenever possible. Signed today beats promised tomorrow.', 30),
  (c3, 'Change orders', E'Projects evolve. When scope changes after signing:\n\n- Any addition or reduction to a sold job is a **change order**.\n- Post the change order details in your regional sales channel: job name, what changed, and the amount added or subtracted.\n- Production will not build what has not been documented — and you will not be paid commission on undocumented extras.', 40);

  -- ── Course 4 ──────────────────────────────────────────────────────────────
  insert into training.courses (title, description, sort_order) values
    ('Reporting Your Sales', 'What to do the moment you close — so production starts fast and your commission is right.', 40)
    returning id into c4;
  insert into training.lessons (course_id, title, content_md, sort_order) values
  (c4, 'When you close a sale', E'The moment a customer signs:\n\n1. In HCP, **copy the estimate to a job**. This is the trigger the whole company works from.\n2. You will receive a message from the office with a link to the **sales report form**. Fill it out the same day — key details of the sale.\n3. The form posts your sale to the sales channel automatically and feeds the production system, so the back office can process your transaction quickly.\n\nSame-day reporting is the difference between a fast build (and a fast commission) and a stuck one.', 10),
  (c4, 'Commissions 101', E'How you get paid, in plain terms:\n\n- Commission is earned on **sold, documented, collectible** work — the job in HCP plus your sales report is the record.\n- Change orders adjust your commission up or down — which is why posting them is non-negotiable.\n- Questions about a specific payout? Ask in your 1:1 office chat with the job name — not in the public channels.', 20);

  -- ── Course 5 ──────────────────────────────────────────────────────────────
  insert into training.courses (title, description, sort_order) values
    ('Financing with GreenSky', 'Your approval, and how offering payments wins jobs that cash quotes lose.', 50)
    returning id into c5;
  insert into training.lessons (course_id, title, content_md, sort_order) values
  (c5, 'Get yourself approved first', E'GreenSky is the financing platform our customers use to pay over time.\n\nBefore you can offer it, YOU must submit your own GreenSky merchant approval — it is one of your onboarding checklist items and it is on you to complete. Instructions and the link are provided during onboarding; if you are stuck, ask in your 1:1 office chat.\n\nYou are not fully field-ready until your GreenSky approval is done.', 10),
  (c5, 'Offering financing to customers', E'Most homeowners think in monthly payments, not totals:\n\n- Introduce financing DURING discovery, not as a rescue at the end: "Most of our clients put this on a monthly plan — I''ll show you both numbers."\n- Present the payment next to the cash price on every estimate over a few thousand dollars.\n- The application takes minutes on the customer''s phone; approvals are typically fast. Walk them through it at the table.\n- A financed yes today beats a cash maybe next month — for the customer, for you, and for the company.', 20);

  -- ── Final quiz ────────────────────────────────────────────────────────────
  insert into training.quizzes (course_id, title, pass_pct, is_final) values
    (c5, 'Sales Rep Readiness Test', 80, true)
    returning id into qz;

  insert into training.questions (quiz_id, prompt, options, correct_index, sort_order) values
  (qz, 'Which apps must be installed on your phone before your first lead?',
    '["Slack and Gmail", "Only Housecall Pro", "Zoom and Outlook", "Microsoft Teams, WhatsApp, and Housecall Pro"]', 3, 10),
  (qz, 'Where do your appointments, customer records, estimates, and jobs live?',
    '["Email", "Your personal calendar", "Housecall Pro", "A shared spreadsheet"]', 2, 20),
  (qz, 'What is the purpose of your "Phone Room" Teams group?',
    '["Company-wide announcements", "Submitting change orders", "Talking to customers", "Direct line to the people who book, confirm, and reschedule your appointments"]', 3, 30),
  (qz, 'You are running 20 minutes late to an appointment. What do you do?',
    '["Nothing \u2014 just drive faster", "Text the customer after you arrive", "Tell your Phone Room chat immediately so they can inform the customer", "Cancel the appointment"]', 2, 40),
  (qz, 'What should you review BEFORE arriving at a lead?',
    '["Nothing \u2014 improvise", "Only the address", "The company handbook", "The HCP customer record and the property on satellite view"]', 3, 50),
  (qz, 'During the consultation, when should the budget conversation happen?',
    '["Never \u2014 avoid talking money", "In a follow-up email", "Only after they sign", "Naturally during discovery, while walking the project with the customer"]', 3, 60),
  (qz, 'A customer says "it''s too expensive." What is your FIRST move?',
    '["Leave and follow up next week", "Immediately offer a discount", "Rebuild value (materials, warranty, licensed crews) before discussing price or options", "Tell them to get other bids"]', 2, 70),
  (qz, 'What is the trigger that starts everything after you close a sale?',
    '["Posting on social media", "Waiting for production to call you", "Copying the estimate to a job in HCP", "Calling the owner"]', 2, 80),
  (qz, 'After copying the estimate to a job, what must you complete the same day?',
    '["The sales report form from the link the office sends you", "A handwritten note", "Nothing else", "An invoice to the customer"]', 0, 90),
  (qz, 'A sold job''s scope changed and added $3,000. What do you do?',
    '["Only mention it to production verbally", "Wait until the job is finished", "Post the change order (job, what changed, amount) in your regional sales channel", "Tell the customer it''s included"]', 2, 100),
  (qz, 'When should you introduce financing to a customer?',
    '["Never \u2014 financing is the office''s job", "Only if they say they can''t pay", "After they reject the cash price twice", "During discovery \u2014 present the monthly payment next to the cash price"]', 3, 110),
  (qz, 'What must YOU do with GreenSky before you are field-ready?',
    '["Open a personal loan", "Memorize the interest rates", "Nothing, it''s automatic", "Submit your own merchant approval \u2014 it''s your onboarding checklist item"]', 3, 120);

  raise notice 'seeded: 5 courses, 14 lessons, 1 final quiz (12 questions)';
end $$;
