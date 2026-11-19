-- get_brief and get_shop_summaries against fixture rows counted by hand.
-- "Today" is 2030-01-15 in America/Chicago: [06:00Z, next day 06:00Z).
-- The seed's rows are all near now(), so none fall inside this window.

create temp table t_fx on commit drop as
select test.make_user('owner@example.com') as owner_id,
       '2030-01-15T06:00:00Z'::timestamptz as p_from,
       '2030-01-16T06:00:00Z'::timestamptz as p_to;
grant select on t_fx to public;

insert into public.shops (id, name, phone) values
  ('00000000-0000-4000-8000-00000000000a', 'Fixture A', '+15550000001'),
  ('00000000-0000-4000-8000-00000000000b', 'Fixture B', '+15550000002'),
  ('00000000-0000-4000-8000-00000000000c', 'Fixture C', '+15550000003');

insert into public.calls (shop_id, caller_phone, started_at, outcome)
select ('00000000-0000-4000-8000-00000000000' || v.shop)::uuid, '+15125550000', v.at, v.outcome
from (values
  ('a', '2030-01-15T06:00:00Z'::timestamptz,       'booked'),       -- exactly p_from: in
  ('a', '2030-01-15T05:59:59.999999Z',             'answered'),     -- just before: out
  ('a', '2030-01-16T05:59:59.999Z',                'missed'),       -- just before p_to: in
  ('a', '2030-01-16T06:00:00Z',                    'booked'),       -- exactly p_to: out
  ('a', '2030-01-15T15:00:00Z',                    'answered'),
  ('a', '2030-01-15T16:00:00Z',                    'message'),
  ('a', '2030-01-15T17:00:00Z',                    'transferred'),
  ('a', '2030-01-15T18:00:00Z',                    'failed'),
  ('b', '2030-01-15T19:00:00Z',                    'booked'),
  ('b', '2030-01-15T20:00:00Z',                    'booked'),
  ('b', '2030-01-14T20:00:00Z',                    'missed')        -- yesterday: out
) as v (shop, at, outcome);

insert into public.tasks (title, repo, instructions, status, finished_at)
values
  ('t1', 'acme/site', 'x', 'done',      '2030-01-15T06:00:00Z'),   -- in
  ('t2', 'acme/site', 'x', 'done',      '2030-01-16T06:00:00Z'),   -- out (p_to)
  ('t3', 'acme/site', 'x', 'done',      '2030-01-15T23:00:00Z'),   -- in
  ('t4', 'acme/site', 'x', 'failed',    '2030-01-15T23:00:00Z'),   -- not done
  ('t5', 'acme/site', 'x', 'cancelled', '2030-01-15T23:00:00Z'),   -- not done
  ('t6', 'acme/site', 'x', 'done',      '2030-01-15T05:00:00Z');   -- before

insert into public.appointments (shop_id, customer_name, service, starts_at, status)
select ('00000000-0000-4000-8000-00000000000' || v.shop)::uuid, 'Customer', 'Haircut', now() + v.offs, v.status
from (values
  ('a', interval '-1 hour', 'booked'),     -- past
  ('a', interval '1 hour',  'cancelled'),  -- not booked/confirmed
  ('a', interval '2 hours', 'completed'),  -- not booked/confirmed
  ('a', interval '3 hours', 'confirmed'),  -- next for A
  ('a', interval '1 day',   'booked'),
  ('b', interval '-2 hours','confirmed'),  -- B has nothing ahead
  ('c', interval '5 hours', 'booked')      -- next for C
) as v (shop, offs, status);

select test.as_user((select owner_id from t_fx));

select test.is((select row(b.*)::text from public.get_brief((select p_from from t_fx), (select p_to from t_fx)) b),
  '(6,3,2,2)', 'get_brief: 6 answered, 3 booked, 2 missed or failed, 2 tasks finished');
select test.is((select row(b.*)::text from public.get_brief('2030-01-14T06:00:00Z', '2030-01-15T06:00:00Z') b),
  '(1,0,1,1)', 'get_brief for the day before (edges belong to one day only)');
select test.is((select row(b.*)::text from public.get_brief('2040-01-01', '2040-01-02') b),
  '(0,0,0,0)', 'get_brief for an empty day is one row of zeros');
select test.is(test.rows($$select * from public.get_brief('2040-01-01', '2040-01-02')$$), 1::bigint,
  'get_brief always returns exactly one row');

create temp table t_sum on commit drop as
select * from public.get_shop_summaries((select p_from from t_fx), (select p_to from t_fx))
where phone like '+1555000000%';

select test.is((select format('%s/%s/%s', calls_today, bookings_today, missed_today) from t_sum where name = 'Fixture A'),
  '6/1/2', 'Fixture A: 6 calls, 1 booking, 2 missed today');
select test.is((select format('%s/%s/%s', calls_today, bookings_today, missed_today) from t_sum where name = 'Fixture B'),
  '2/2/0', 'Fixture B: 2 calls, 2 bookings, 0 missed today');
select test.is((select format('%s/%s/%s', calls_today, bookings_today, missed_today) from t_sum where name = 'Fixture C'),
  '0/0/0', 'Fixture C: no calls is zeros, not null');
select test.is((select next_appointment_at from t_sum where name = 'Fixture A'), now() + interval '3 hours',
  'Fixture A: next appointment is the earliest future booked/confirmed one');
select test.is((select next_appointment_at from t_sum where name = 'Fixture B'), null::timestamptz,
  'Fixture B: no upcoming appointment gives null');
select test.is((select next_appointment_at from t_sum where name = 'Fixture C'), now() + interval '5 hours',
  'Fixture C: next appointment');
select test.is((select format('%s|%s|%s|%s', phone, address, timezone, status) from t_sum where name = 'Fixture A'),
  '+15550000001||UTC|active', 'summaries carry every shops column');
select test.is((select string_agg(p.parameter_name, ',' order by p.ordinal_position) from information_schema.routines r
                join information_schema.parameters p on p.specific_name = r.specific_name
                where r.routine_name = 'get_shop_summaries' and p.parameter_mode = 'OUT'),
  'id,name,phone,address,timezone,status,created_at,calls_today,bookings_today,missed_today,next_appointment_at',
  'get_shop_summaries columns match ShopSummary');

select test.as_admin();
