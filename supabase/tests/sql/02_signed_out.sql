-- Signed out (anon): every table and every function is refused.

-- Give the database an owner first, so "nobody owns it yet" is not why anon sees nothing.
select test.make_user('owner@example.com');

select test.as_anon();

select test.throws(format('select * from public.%I', t), '42501', 'anon cannot read ' || t)
from unnest(array['shops', 'calls', 'appointments', 'tasks', 'task_events', 'approvals', 'alerts',
                  'handbook_entries', 'decisions', 'settings']) as t;

select test.throws($$insert into public.handbook_entries (title) values ('x')$$, '42501', 'anon cannot add a handbook entry');
select test.throws($$insert into public.decisions (title, decision) values ('x', 'y')$$, '42501', 'anon cannot add a decision');
select test.throws($$insert into public.calls (shop_id, caller_phone, started_at, outcome)
                     select id, '+1', now(), 'missed' from public.shops limit 1$$, '42501', 'anon cannot add a call');
select test.throws($$update public.alerts set read_at = now()$$, '42501', 'anon cannot mark alerts read');
select test.throws($$update public.settings set notify_phone = '+15125550100'$$, '42501', 'anon cannot edit settings');
select test.throws($$delete from public.decisions$$, '42501', 'anon cannot delete decisions');
select test.throws($$truncate public.alerts$$, '42501', 'anon cannot truncate');

select test.throws($$select * from public.get_brief(now() - interval '1 day', now())$$, '42501', 'anon cannot run get_brief');
select test.throws($$select * from public.get_shop_summaries(now() - interval '1 day', now())$$, '42501', 'anon cannot run get_shop_summaries');
select test.throws($$select public.jarvis_create_task('jarvis-ops/booking-site', 'x')$$, '42501', 'anon cannot run jarvis_create_task');
select test.throws($$select public.jarvis_record_dispatch(gen_random_uuid(), 'accepted', null, null)$$, '42501', 'anon cannot run jarvis_record_dispatch');
select test.throws($$select public.jarvis_cancel_task(gen_random_uuid())$$, '42501', 'anon cannot run jarvis_cancel_task');
select test.throws($$select public.jarvis_decide_approval(gen_random_uuid(), 'approved')$$, '42501', 'anon cannot run jarvis_decide_approval');
select test.throws($$select public.jarvis_apply_events('[]')$$, '42501', 'anon cannot run jarvis_apply_events');
select test.throws($$select private.is_owner()$$, '42501', 'anon cannot reach private.is_owner');
select test.throws($$select jarvis.route_alert('system')$$, '42501', 'anon cannot reach the jarvis schema');

-- Even with a forged "sub" claim, the anon role has no privileges at all.
select test.as_admin();
select set_config('request.jwt.claims',
  json_build_object('sub', (select owner_id from public.settings), 'role', 'anon')::text, true);
select set_config('role', 'anon', true);
select test.throws($$select * from public.calls$$, '42501', 'anon with the owner''s sub claim still cannot read');

select test.as_admin();
