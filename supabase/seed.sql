-- SAMPLE DATA for local development. Not real shops, calls or people.
--
-- `supabase db reset` loads it into the local stack. You can also paste it
-- into the SQL editor of a hosted project to see the app populated before the
-- real Jarvis backend is connected. Running it again refreshes the times (all
-- relative to now(), so "today" always has data) without making duplicates.
--
-- Every sample row has an id starting with 5eed. To remove all of it:
--   delete from public.alerts           where id::text like '5eed%';
--   delete from public.approvals        where id::text like '5eed%';
--   delete from public.tasks            where id::text like '5eed%';  -- and their log
--   delete from public.shops            where id::text like '5eed%';  -- and their calls and appointments
--   delete from public.handbook_entries where id::text like '5eed%';
--   delete from public.decisions        where id::text like '5eed%';
--   update public.settings set allowed_repos = array_remove(array_remove(array_remove(array_remove(
--     allowed_repos, 'jarvis-ops/booking-site'), 'jarvis-ops/receptionist-agent'),
--     'jarvis-ops/shop-dashboard'), 'jarvis-ops/jarvis-backend');

-- Shops
insert into public.shops (id, name, phone, address, timezone, status) values
  ('5eed0001-0000-4000-8000-000000000001', 'Southside Cuts',     '+15125550142', '1801 S Congress Ave, Austin, TX',  'America/Chicago', 'active'),
  ('5eed0001-0000-4000-8000-000000000002', 'Eastside Barber Co', '+15125550178', '1100 E 6th St, Austin, TX',        'America/Chicago', 'active'),
  ('5eed0001-0000-4000-8000-000000000003', 'North Loop Fades',   '+15125550193', '5300 N Lamar Blvd, Austin, TX',    'America/Chicago', 'paused')
on conflict (id) do update set
  name = excluded.name, phone = excluded.phone, address = excluded.address,
  timezone = excluded.timezone, status = excluded.status;

-- Calls: today, every outcome
insert into public.calls (id, shop_id, external_id, caller_name, caller_phone, started_at, duration_seconds, outcome, summary, transcript)
select v.id::uuid, v.shop_id::uuid, v.external_id, v.caller_name, v.caller_phone,
       now() - v.ago, v.duration_seconds, v.outcome, v.summary, v.transcript::jsonb
from (values
  ('5eed0002-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000001', 'seed-call-01', 'Marcus Reed', '+15125550301', interval '12 minutes', 94, 'booked',
   'Booked a skin fade with Tony tomorrow at 10:00.',
   '[{"role":"agent","text":"Thanks for calling Southside Cuts, this is Jarvis. How can I help?","t":0},{"role":"caller","text":"Can I get a fade tomorrow morning?","t":4},{"role":"agent","text":"Tony has 10:00 open. Want it?","t":9},{"role":"caller","text":"Perfect, book it.","t":14},{"role":"agent","text":"Done. You will get a text confirmation.","t":17}]'),
  ('5eed0002-0000-4000-8000-000000000002', '5eed0001-0000-4000-8000-000000000001', 'seed-call-02', null, '+15125550302', interval '40 minutes', 0, 'missed',
   'Caller hung up before the greeting.', '[]'),
  ('5eed0002-0000-4000-8000-000000000003', '5eed0001-0000-4000-8000-000000000001', 'seed-call-03', 'Dana Lopez', '+15125550303', interval '75 minutes', 51, 'answered',
   'Asked about Sunday hours. Told her 10:00 to 4:00.',
   '[{"role":"agent","text":"Southside Cuts, this is Jarvis.","t":0},{"role":"caller","text":"Are you open Sunday?","t":3},{"role":"agent","text":"Yes, 10 to 4.","t":6},{"role":"caller","text":"Great, thanks.","t":9}]'),
  ('5eed0002-0000-4000-8000-000000000004', '5eed0001-0000-4000-8000-000000000001', 'seed-call-04', 'Chris Patel', '+15125550304', interval '2 hours', 128, 'transferred',
   'Wanted to talk to the owner about a wedding party. Transferred to the shop line.',
   '[{"role":"agent","text":"Southside Cuts, this is Jarvis.","t":0},{"role":"caller","text":"I need cuts for six groomsmen on Saturday.","t":4},{"role":"agent","text":"Let me connect you with the shop.","t":11}]'),
  ('5eed0002-0000-4000-8000-000000000005', '5eed0001-0000-4000-8000-000000000002', 'seed-call-05', 'Jordan Kim', '+15125550305', interval '20 minutes', 77, 'booked',
   'Booked a beard trim with Sam today at 4:30.',
   '[{"role":"agent","text":"Eastside Barber Co, Jarvis speaking.","t":0},{"role":"caller","text":"Any beard trims this afternoon?","t":3},{"role":"agent","text":"Sam is free at 4:30.","t":8},{"role":"caller","text":"Take it.","t":11}]'),
  ('5eed0002-0000-4000-8000-000000000006', '5eed0001-0000-4000-8000-000000000002', 'seed-call-06', 'Alex Moore', '+15125550306', interval '55 minutes', 63, 'message',
   'Left a message for Sam: running 15 minutes late for his 2:00.',
   '[{"role":"agent","text":"Eastside Barber Co, Jarvis speaking.","t":0},{"role":"caller","text":"Tell Sam I will be 15 late.","t":3},{"role":"agent","text":"I will pass that on.","t":7}]'),
  ('5eed0002-0000-4000-8000-000000000007', '5eed0001-0000-4000-8000-000000000002', 'seed-call-07', null, '+15125550307', interval '95 minutes', 22, 'failed',
   'The call dropped while the agent was answering.',
   '[{"role":"agent","text":"Eastside Barber Co, Jarvis speaking.","t":0},{"role":"caller","text":"Hi, do you take","t":3}]'),
  ('5eed0002-0000-4000-8000-000000000008', '5eed0001-0000-4000-8000-000000000002', 'seed-call-08', 'Priya Shah', '+15125550308', interval '3 hours', 88, 'booked',
   'Booked a kids cut on Saturday at 11:00.',
   '[{"role":"agent","text":"Eastside Barber Co, Jarvis speaking.","t":0},{"role":"caller","text":"A kids cut Saturday?","t":3},{"role":"agent","text":"11:00 with Rico works.","t":7}]'),
  ('5eed0002-0000-4000-8000-000000000009', '5eed0001-0000-4000-8000-000000000003', 'seed-call-09', 'Sam Turner', '+15125550309', interval '30 minutes', 45, 'answered',
   'Asked whether the shop is open. Told him it is closed for renovation until Monday.',
   '[{"role":"agent","text":"North Loop Fades, Jarvis speaking.","t":0},{"role":"caller","text":"You guys open?","t":2},{"role":"agent","text":"Closed for renovation until Monday.","t":5}]'),
  ('5eed0002-0000-4000-8000-000000000010', '5eed0001-0000-4000-8000-000000000003', 'seed-call-10', null, '+15125550310', interval '4 hours', 0, 'missed',
   'Rang out: the line was not forwarded.', '[]')
) as v (id, shop_id, external_id, caller_name, caller_phone, ago, duration_seconds, outcome, summary, transcript)
on conflict (id) do update set
  shop_id = excluded.shop_id, external_id = excluded.external_id, caller_name = excluded.caller_name,
  caller_phone = excluded.caller_phone, started_at = excluded.started_at,
  duration_seconds = excluded.duration_seconds, outcome = excluded.outcome,
  summary = excluded.summary, transcript = excluded.transcript;

-- Appointments: mostly upcoming
insert into public.appointments (id, shop_id, external_id, call_id, customer_name, customer_phone, service, barber, starts_at, duration_minutes, status, source, notes)
select v.id::uuid, v.shop_id::uuid, v.external_id, v.call_id::uuid, v.customer_name, v.customer_phone,
       v.service, v.barber, date_trunc('minute', now()) + v.from_now, v.duration_minutes, v.status, v.source, v.notes
from (values
  ('5eed0003-0000-4000-8000-000000000001', '5eed0001-0000-4000-8000-000000000001', 'seed-appt-01', '5eed0002-0000-4000-8000-000000000001', 'Marcus Reed', '+15125550301', 'Skin fade', 'Tony', interval '20 hours', 45, 'booked', 'jarvis', null),
  ('5eed0003-0000-4000-8000-000000000002', '5eed0001-0000-4000-8000-000000000001', 'seed-appt-02', null, 'Luis Garcia', '+15125550311', 'Haircut', 'Tony', interval '90 minutes', 30, 'confirmed', 'online', null),
  ('5eed0003-0000-4000-8000-000000000003', '5eed0001-0000-4000-8000-000000000001', 'seed-appt-03', null, 'Ben Carter', null, 'Line up', 'Mia', interval '-2 hours', 15, 'completed', 'walk_in', null),
  ('5eed0003-0000-4000-8000-000000000004', '5eed0001-0000-4000-8000-000000000002', 'seed-appt-04', '5eed0002-0000-4000-8000-000000000005', 'Jordan Kim', '+15125550305', 'Beard trim', 'Sam', interval '3 hours', 20, 'booked', 'jarvis', null),
  ('5eed0003-0000-4000-8000-000000000005', '5eed0001-0000-4000-8000-000000000002', 'seed-appt-05', '5eed0002-0000-4000-8000-000000000008', 'Priya Shah', '+15125550308', 'Kids cut', 'Rico', interval '2 days', 30, 'booked', 'jarvis', 'Ask for the dinosaur cape.'),
  ('5eed0003-0000-4000-8000-000000000006', '5eed0001-0000-4000-8000-000000000002', 'seed-appt-06', null, 'Eli Brooks', '+15125550312', 'Haircut and beard', 'Sam', interval '5 hours', 60, 'cancelled', 'online', 'Cancelled by text.'),
  ('5eed0003-0000-4000-8000-000000000007', '5eed0001-0000-4000-8000-000000000003', 'seed-appt-07', null, 'Omar Haddad', '+15125550313', 'Haircut', null, interval '4 days', 30, 'confirmed', 'online', 'First visit after the reopening.')
) as v (id, shop_id, external_id, call_id, customer_name, customer_phone, service, barber, from_now, duration_minutes, status, source, notes)
on conflict (id) do update set
  shop_id = excluded.shop_id, external_id = excluded.external_id, call_id = excluded.call_id,
  customer_name = excluded.customer_name, customer_phone = excluded.customer_phone,
  service = excluded.service, barber = excluded.barber, starts_at = excluded.starts_at,
  duration_minutes = excluded.duration_minutes, status = excluded.status,
  source = excluded.source, notes = excluded.notes;

-- Tasks: one in every status
insert into public.tasks (id, external_id, title, repo, instructions, status, branch, result_summary, pr_url, error, created_at, started_at, finished_at)
select v.id::uuid, v.external_id, v.title, v.repo, v.instructions, v.status, v.branch, v.result_summary, v.pr_url, v.error,
       now() - v.created_ago, now() - v.started_ago, now() - v.finished_ago
from (values
  ('5eed0004-0000-4000-8000-000000000001', null, 'Add Sunday hours to the booking site footer', 'jarvis-ops/booking-site',
   'Add Sunday hours to the booking site footer: 10:00 to 4:00 for Southside, closed for the others.',
   'queued', null, null, null, null, interval '3 minutes', null::interval, null::interval),
  ('5eed0004-0000-4000-8000-000000000002', 'seed-task-02', 'Make the receptionist read back the appointment time', 'jarvis-ops/receptionist-agent',
   'Make the receptionist read back the appointment time before hanging up, in the shop''s timezone.',
   'running', 'jarvis/read-back-time', null, null, null, interval '25 minutes', interval '24 minutes', null),
  ('5eed0004-0000-4000-8000-000000000003', 'seed-task-03', 'Show no-shows on the shop dashboard', 'jarvis-ops/shop-dashboard',
   'Show no-shows on the shop dashboard as a weekly count per barber.',
   'needs_approval', 'jarvis/no-show-count', null, null, null, interval '50 minutes', interval '48 minutes', null),
  ('5eed0004-0000-4000-8000-000000000004', 'seed-task-04', 'Retry webhook deliveries with backoff', 'jarvis-ops/jarvis-backend',
   'Retry webhook deliveries with exponential backoff, up to five times.',
   'done', 'jarvis/webhook-retry', 'Added retries with backoff (1, 2, 4, 8, 16 s) and a test for it.',
   'https://github.com/jarvis-ops/jarvis-backend/pull/42', null, interval '3 hours', interval '179 minutes', interval '2 hours'),
  ('5eed0004-0000-4000-8000-000000000005', 'seed-task-05', 'Upgrade the booking site to the new calendar widget', 'jarvis-ops/booking-site',
   'Upgrade the booking site to the new calendar widget.',
   'failed', 'jarvis/calendar-widget', null, null, 'The build failed: the widget needs Node 22 and CI runs Node 18.',
   interval '5 hours', interval '299 minutes', interval '280 minutes'),
  ('5eed0004-0000-4000-8000-000000000006', 'seed-task-06', 'Rename "stylist" to "barber" everywhere', 'jarvis-ops/shop-dashboard',
   'Rename "stylist" to "barber" everywhere in the dashboard.',
   'cancelled', null, null, null, null, interval '1 day', interval '1439 minutes', interval '1430 minutes')
) as v (id, external_id, title, repo, instructions, status, branch, result_summary, pr_url, error, created_ago, started_ago, finished_ago)
on conflict (id) do update set
  external_id = excluded.external_id, title = excluded.title, repo = excluded.repo,
  instructions = excluded.instructions, status = excluded.status, branch = excluded.branch,
  result_summary = excluded.result_summary, pr_url = excluded.pr_url, error = excluded.error,
  created_at = excluded.created_at, started_at = excluded.started_at, finished_at = excluded.finished_at;

-- Task progress logs
insert into public.task_events (id, task_id, kind, message, created_at)
select v.id::uuid, v.task_id::uuid, v.kind, v.message, now() - v.ago
from (values
  ('5eed0005-0000-4000-8000-000000000001', '5eed0004-0000-4000-8000-000000000001', 'status',  'Queued', interval '3 minutes'),
  ('5eed0005-0000-4000-8000-000000000002', '5eed0004-0000-4000-8000-000000000001', 'log',     'Jarvis backend isn''t connected yet. This task will wait in the queue.', interval '179 seconds'),
  ('5eed0005-0000-4000-8000-000000000003', '5eed0004-0000-4000-8000-000000000002', 'status',  'Queued', interval '25 minutes'),
  ('5eed0005-0000-4000-8000-000000000004', '5eed0004-0000-4000-8000-000000000002', 'status',  'Started', interval '24 minutes'),
  ('5eed0005-0000-4000-8000-000000000005', '5eed0004-0000-4000-8000-000000000002', 'command', 'git checkout -b jarvis/read-back-time', interval '23 minutes'),
  ('5eed0005-0000-4000-8000-000000000006', '5eed0004-0000-4000-8000-000000000002', 'log',     'Found the confirmation prompt in prompts/booking.md.', interval '20 minutes'),
  ('5eed0005-0000-4000-8000-000000000007', '5eed0004-0000-4000-8000-000000000002', 'command', 'npm test', interval '6 minutes'),
  ('5eed0005-0000-4000-8000-000000000008', '5eed0004-0000-4000-8000-000000000003', 'status',  'Queued', interval '50 minutes'),
  ('5eed0005-0000-4000-8000-000000000009', '5eed0004-0000-4000-8000-000000000003', 'status',  'Started', interval '48 minutes'),
  ('5eed0005-0000-4000-8000-000000000010', '5eed0004-0000-4000-8000-000000000003', 'log',     'Added a no_show count query and a chart.', interval '30 minutes'),
  ('5eed0005-0000-4000-8000-000000000011', '5eed0004-0000-4000-8000-000000000003', 'status',  'Waiting for approval', interval '29 minutes'),
  ('5eed0005-0000-4000-8000-000000000012', '5eed0004-0000-4000-8000-000000000004', 'status',  'Queued', interval '3 hours'),
  ('5eed0005-0000-4000-8000-000000000013', '5eed0004-0000-4000-8000-000000000004', 'command', 'npm test -- webhook', interval '150 minutes'),
  ('5eed0005-0000-4000-8000-000000000014', '5eed0004-0000-4000-8000-000000000004', 'status',  'Opened pull request #42', interval '2 hours'),
  ('5eed0005-0000-4000-8000-000000000015', '5eed0004-0000-4000-8000-000000000005', 'status',  'Started', interval '299 minutes'),
  ('5eed0005-0000-4000-8000-000000000016', '5eed0004-0000-4000-8000-000000000005', 'error',   'The build failed: the widget needs Node 22 and CI runs Node 18.', interval '280 minutes'),
  ('5eed0005-0000-4000-8000-000000000017', '5eed0004-0000-4000-8000-000000000006', 'status',  'Cancelled by you', interval '1430 minutes')
) as v (id, task_id, kind, message, ago)
on conflict (id) do update set
  task_id = excluded.task_id, kind = excluded.kind, message = excluded.message, created_at = excluded.created_at;

-- Approvals: three waiting
insert into public.approvals (id, kind, title, detail, task_id, shop_id, status, requested_at, expires_at, created_at)
select v.id::uuid, v.kind, v.title, v.detail, v.task_id::uuid, v.shop_id::uuid, 'pending',
       now() - v.ago, now() + v.expires_in, now() - v.ago
from (values
  ('5eed0006-0000-4000-8000-000000000001', 'code', 'Merge the no-show chart into the shop dashboard?',
   'Adds one query and one chart. All tests pass.', '5eed0004-0000-4000-8000-000000000003', null, interval '29 minutes', null::interval),
  ('5eed0006-0000-4000-8000-000000000002', 'receptionist', 'Offer walk-in wait times on the phone at Eastside?',
   'Callers keep asking how long the wait is. Jarvis would read it from the queue board.', null, '5eed0001-0000-4000-8000-000000000002', interval '2 hours', interval '1 day'),
  ('5eed0006-0000-4000-8000-000000000003', 'spend', 'Buy a second phone number for North Loop ($1.15/month)?',
   'So the shop can keep its old number for the landline.', null, '5eed0001-0000-4000-8000-000000000003', interval '4 hours', null)
) as v (id, kind, title, detail, task_id, shop_id, ago, expires_in)
on conflict (id) do update set
  kind = excluded.kind, title = excluded.title, detail = excluded.detail, task_id = excluded.task_id,
  shop_id = excluded.shop_id, status = 'pending', decided_at = null, requested_at = excluded.requested_at,
  expires_at = excluded.expires_at, created_at = excluded.created_at;

-- Alerts
insert into public.alerts (id, type, title, body, shop_id, call_id, task_id, approval_id, channel, read_at, created_at)
select v.id::uuid, v.type, v.title, v.body, v.shop_id::uuid, v.call_id::uuid, v.task_id::uuid, v.approval_id::uuid,
       v.channel, now() - v.read_ago, now() - v.ago
from (values
  ('5eed0007-0000-4000-8000-000000000001', 'missed_call', 'Missed call at Southside Cuts', 'The caller hung up before the greeting.',
   '5eed0001-0000-4000-8000-000000000001', '5eed0002-0000-4000-8000-000000000002', null, null, 'text', null::interval, interval '40 minutes'),
  ('5eed0007-0000-4000-8000-000000000002', 'failed_call', 'A call dropped at Eastside Barber Co', 'The audio cut out while Jarvis was answering.',
   '5eed0001-0000-4000-8000-000000000002', '5eed0002-0000-4000-8000-000000000007', null, null, 'text', null, interval '95 minutes'),
  ('5eed0007-0000-4000-8000-000000000003', 'approval_needed', 'Jarvis needs your OK to merge the no-show chart', null,
   null, null, '5eed0004-0000-4000-8000-000000000003', '5eed0006-0000-4000-8000-000000000001', 'text', null, interval '29 minutes'),
  ('5eed0007-0000-4000-8000-000000000004', 'task_done', 'Webhook retries are done', 'Pull request #42 is ready.',
   null, null, '5eed0004-0000-4000-8000-000000000004', null, 'in_app', interval '90 minutes', interval '2 hours'),
  ('5eed0007-0000-4000-8000-000000000005', 'task_failed', 'The calendar widget upgrade failed', 'CI runs Node 18; the widget needs Node 22.',
   null, null, '5eed0004-0000-4000-8000-000000000005', null, 'in_app', null, interval '280 minutes'),
  ('5eed0007-0000-4000-8000-000000000006', 'system', 'North Loop Fades is paused', 'Calls are answered with the renovation message until Monday.',
   '5eed0001-0000-4000-8000-000000000003', null, null, null, 'in_app', interval '5 hours', interval '6 hours')
) as v (id, type, title, body, shop_id, call_id, task_id, approval_id, channel, read_ago, ago)
on conflict (id) do update set
  type = excluded.type, title = excluded.title, body = excluded.body, shop_id = excluded.shop_id,
  call_id = excluded.call_id, task_id = excluded.task_id, approval_id = excluded.approval_id,
  channel = excluded.channel, read_at = excluded.read_at, created_at = excluded.created_at;

-- Business Handbook
insert into public.handbook_entries (id, title, category, content, tags) values
  ('5eed0008-0000-4000-8000-000000000001', 'Prices', 'Pricing',
   E'Haircut $35\nSkin fade $40\nBeard trim $20\nHaircut and beard $50\nKids cut (under 12) $25', array['prices', 'all shops']),
  ('5eed0008-0000-4000-8000-000000000002', 'Opening hours', 'Policies',
   E'Mon to Sat 9:00 to 7:00\nSun 10:00 to 4:00 (Southside only)', array['hours']),
  ('5eed0008-0000-4000-8000-000000000003', 'Late arrivals', 'Policies',
   'More than 15 minutes late: offer the next open slot instead. Never double-book a barber.', array['booking']),
  ('5eed0008-0000-4000-8000-000000000004', 'Greeting', 'Phone scripts',
   'Thanks for calling {shop}, this is Jarvis. How can I help?', array['phone', 'receptionist']),
  ('5eed0008-0000-4000-8000-000000000005', 'Wedding parties', 'Phone scripts',
   'Groups of four or more: take a name and number and transfer to the shop line.', array['phone', 'groups'])
on conflict (id) do update set
  title = excluded.title, category = excluded.category, content = excluded.content, tags = excluded.tags;

-- Decisions Log
insert into public.decisions (id, title, decision, rationale, decided_on, tags) values
  ('5eed0009-0000-4000-8000-000000000001', 'No phone bookings more than 4 weeks out',
   'Jarvis only books up to 28 days ahead.', 'Barbers'' schedules change too often beyond that.', current_date - 30, array['booking']),
  ('5eed0009-0000-4000-8000-000000000002', 'Text, do not call, for missed calls',
   'Missed calls notify by text.', 'A call for every hang-up was too much.', current_date - 12, array['alerts']),
  ('5eed0009-0000-4000-8000-000000000003', 'Pause North Loop during the renovation',
   'North Loop Fades answers with a closed message until it reopens.', null, current_date - 3, array['north loop']),
  ('5eed0009-0000-4000-8000-000000000004', 'Coding tasks need approval before merging',
   'Jarvis opens pull requests but asks before merging.', 'Keeps a person in the loop for anything customers see.', current_date - 1, array['code', 'approvals'])
on conflict (id) do update set
  title = excluded.title, decision = excluded.decision, rationale = excluded.rationale,
  decided_on = excluded.decided_on, tags = excluded.tags;

-- The four sample repos Jarvis may work in (added to whatever is there)
update public.settings
set allowed_repos = array(
  select distinct r
  from unnest(allowed_repos || array[
    'jarvis-ops/booking-site', 'jarvis-ops/receptionist-agent',
    'jarvis-ops/shop-dashboard', 'jarvis-ops/jarvis-backend']) as r
  order by r
);
