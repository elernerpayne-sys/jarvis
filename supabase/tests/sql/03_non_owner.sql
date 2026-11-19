-- Ownership is claimed by the first account; a second signed-in account sees
-- nothing and can change nothing.

-- An anonymous sign-in never claims ownership, even when it comes first.
select test.make_user(null, true);
select test.is((select owner_id from public.settings), null::uuid, 'an anonymous account does not become the owner');

create temp table t_users (who text primary key, id uuid) on commit drop;
grant select on t_users to public;
insert into t_users values ('owner', test.make_user('owner@example.com'));
select test.is((select owner_id from public.settings), (select id from t_users where who = 'owner'),
  'the first real account becomes the owner');
insert into t_users values ('other', test.make_user('other@example.com'));
select test.is((select owner_id from public.settings), (select id from t_users where who = 'owner'),
  'the second account does not become the owner');

-- The owner account cannot be deleted while it is the owner (ownership never goes vacant).
select test.throws(format($$delete from auth.users where id = %L$$, (select id from t_users where who = 'owner')),
  '23503', 'the owner account cannot be deleted while it owns Jarvis');

-- Seed a row of each kind that the non-owner might try to touch.
create temp table t_ids on commit drop as
select (select id from public.alerts where read_at is null limit 1) as alert_id,
       (select id from public.handbook_entries limit 1) as entry_id,
       (select id from public.decisions limit 1) as decision_id,
       (select id from public.tasks limit 1) as task_id;
grant select on t_ids to public;

select test.as_user((select id from t_users where who = 'other'));

select test.is((select private.is_owner()), false, 'is_owner() is false for the second account');
select test.is(test.rows(format('select * from public.%I', t)), 0::bigint, 'the second account reads no ' || t)
from unnest(array['shops', 'calls', 'appointments', 'tasks', 'task_events', 'approvals', 'alerts',
                  'handbook_entries', 'decisions', 'settings']) as t;

select test.is((select row(b.*)::text from public.get_brief('-infinity', 'infinity') b), '(0,0,0,0)',
  'get_brief gives zeros to the second account');
select test.is(test.rows($$select * from public.get_shop_summaries('-infinity', 'infinity')$$), 0::bigint,
  'get_shop_summaries gives no rows to the second account');

-- Writes the role may attempt are refused by the policies.
select test.throws($$insert into public.handbook_entries (title, category, content, tags) values ('x', 'y', 'z', '{}')$$,
  '42501', 'the second account cannot add a handbook entry', '%row-level security%');
select test.throws($$insert into public.decisions (title, decision) values ('x', 'y')$$,
  '42501', 'the second account cannot add a decision', '%row-level security%');
select test.is(test.rows(format($$update public.handbook_entries set title = 'hacked' where id = %L$$, (select entry_id from t_ids))),
  0::bigint, 'the second account cannot edit a handbook entry');
select test.is(test.rows(format($$delete from public.decisions where id = %L$$, (select decision_id from t_ids))),
  0::bigint, 'the second account cannot delete a decision');
select test.is(test.rows($$delete from public.handbook_entries$$), 0::bigint, 'the second account cannot delete handbook entries');
select test.is(test.rows(format($$update public.alerts set read_at = now() where id = %L$$, (select alert_id from t_ids))),
  0::bigint, 'the second account cannot mark an alert read');
select test.is(test.rows($$update public.settings set notify_phone = '+15125550666'$$), 0::bigint,
  'the second account cannot change settings');

-- Writes the role may not even attempt.
select test.throws($$update public.settings set owner_id = auth.uid()$$, '42501', 'the second account cannot take ownership');
select test.throws($$insert into public.settings default values$$, '42501', 'the second account cannot add a settings row');
select test.throws($$delete from public.settings$$, '42501', 'the second account cannot delete settings');
select test.throws($$insert into public.calls (shop_id, caller_phone, started_at, outcome) values (gen_random_uuid(), '+1', now(), 'missed')$$,
  '42501', 'the second account cannot add a call');
select test.throws(format($$update public.tasks set status = 'done' where id = %L$$, (select task_id from t_ids)),
  '42501', 'the second account cannot change a task');
select test.throws($$select public.jarvis_create_task('jarvis-ops/booking-site', 'x')$$, '42501', 'the second account cannot create tasks');
select test.throws($$select public.jarvis_apply_events('[]')$$, '42501', 'the second account cannot push webhook events');
select test.throws($$select jarvis.route_alert('system')$$, '42501', 'the second account cannot reach the jarvis schema');

-- Nothing changed behind the scenes.
select test.as_admin();
select test.is((select owner_id from public.settings), (select id from t_users where who = 'owner'), 'the owner is unchanged');
select test.is((select notify_phone from public.settings), null::text, 'settings are unchanged');
select test.ok((select title from public.handbook_entries where id = (select entry_id from t_ids)) <> 'hacked', 'the entry is unchanged');
select test.is((select read_at from public.alerts where id = (select alert_id from t_ids)), null::timestamptz,
  'the alert is still unread');

-- Signed in but with no "sub" claim at all: still nothing.
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select set_config('role', 'authenticated', true);
select test.is((select private.is_owner()), false, 'is_owner() is false without a user id');
select test.is(test.rows('select * from public.settings'), 0::bigint, 'no user id reads nothing');
select test.as_admin();
