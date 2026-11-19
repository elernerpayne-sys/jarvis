-- The owner reads everything and writes only what the contract allows.

create temp table t_ctx on commit drop as
select test.make_user('owner@example.com') as owner_id,
       (select id from public.alerts where read_at is null order by created_at limit 1) as alert_id,
       (select id from public.tasks limit 1) as task_id,
       (select id from public.shops limit 1) as shop_id;
grant select on t_ctx to public;

select test.as_user((select owner_id from t_ctx));
select test.is((select private.is_owner()), true, 'is_owner() is true for the owner');

-- Reads.
select test.ok(test.rows(format('select * from public.%I', t)) > 0, 'the owner reads ' || t)
from unnest(array['shops', 'calls', 'appointments', 'tasks', 'task_events', 'approvals', 'alerts',
                  'handbook_entries', 'decisions', 'settings']) as t;
select test.is(test.rows('select * from public.get_shop_summaries(''-infinity'', ''infinity'')'), 3::bigint,
  'the owner gets one summary per shop');

-- Alerts: mark read (and unread), nothing else.
select test.is(test.rows(format($$update public.alerts set read_at = now() where id = %L and read_at is null$$, (select alert_id from t_ctx))),
  1::bigint, 'the owner marks an alert read');
select test.is(test.rows(format($$update public.alerts set read_at = null where id = %L$$, (select alert_id from t_ctx))),
  1::bigint, 'the owner marks an alert unread');
select test.throws(format($$update public.alerts set title = 'changed' where id = %L$$, (select alert_id from t_ctx)),
  '42501', 'the owner cannot change an alert''s title');
select test.throws($$update public.alerts set channel = 'call'$$, '42501', 'the owner cannot change an alert''s channel');
select test.throws($$insert into public.alerts (type, title) values ('system', 'fake')$$, '42501', 'the owner cannot create alerts');
select test.throws($$delete from public.alerts$$, '42501', 'the owner cannot delete alerts');

-- Handbook and decisions: add, edit, delete.
create temp table t_new (kind text, id uuid) on commit drop;
grant select, insert on t_new to authenticated;
with x as (
  insert into public.handbook_entries (title, category, content, tags) values ('Parking', 'Policies', 'Lot behind the shop.', '{parking}')
  returning id)
insert into t_new select 'entry', id from x;
with x as (
  insert into public.decisions (title, decision, rationale, decided_on, tags) values ('Open Mondays', 'Yes', null, '2026-11-01', '{}')
  returning id)
insert into t_new select 'decision', id from x;
select test.is((select count(*) from t_new), 2::bigint, 'the owner adds a handbook entry and a decision');
select test.is(test.rows(format($$update public.handbook_entries set content = 'Street parking only.', tags = '{parking,street}' where id = %L$$,
  (select id from t_new where kind = 'entry'))), 1::bigint, 'the owner edits a handbook entry');
select test.is(test.rows(format($$update public.decisions set decision = 'No', rationale = 'Too quiet' where id = %L$$,
  (select id from t_new where kind = 'decision'))), 1::bigint, 'the owner edits a decision');
select test.throws(format($$update public.handbook_entries set notion_page_id = 'x' where id = %L$$, (select id from t_new where kind = 'entry')),
  '42501', 'the owner cannot set notion_page_id (the sync does)');
select test.throws($$insert into public.decisions (id, title, decision) values (gen_random_uuid(), 'x', 'y')$$,
  '42501', 'the owner cannot choose ids');
select test.throws($$insert into public.handbook_entries (title, created_at) values ('x', '2000-01-01')$$,
  '42501', 'the owner cannot back-date created_at');
select test.throws($$update public.decisions set updated_at = '2000-01-01'$$, '42501', 'the owner cannot set updated_at');
select test.throws($$insert into public.handbook_entries (title) values ('  ')$$, '23514', 'a blank title is refused');
select test.is(test.rows(format($$delete from public.handbook_entries where id = %L$$, (select id from t_new where kind = 'entry'))),
  1::bigint, 'the owner deletes a handbook entry');
select test.is(test.rows(format($$delete from public.decisions where id = %L$$, (select id from t_new where kind = 'decision'))),
  1::bigint, 'the owner deletes a decision');

-- Settings: preferences only.
select test.is(test.rows($$update public.settings set
    notify_phone = '+15125550100',
    notification_prefs = '{"missed_call":"call","failed_call":"text","approval_needed":"text","task_done":"in_app","task_failed":"text","system":"in_app"}',
    quiet_hours_enabled = true, quiet_hours_start = '21:30', quiet_hours_end = '06:45',
    timezone = 'America/Chicago', allowed_repos = '{acme/website}'
  where id is not null$$), 1::bigint, 'the owner edits every preference');
select test.is((select format('%s %s %s-%s %s %s', notify_phone, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone, allowed_repos)
                from public.settings), '+15125550100 t 21:30-06:45 America/Chicago {acme/website}', 'the preferences were stored');
select test.ok((select updated_at = now() from public.settings), 'settings.updated_at is maintained');
select test.throws($$update public.settings set owner_id = gen_random_uuid()$$, '42501', 'the owner cannot change owner_id');
select test.throws($$update public.settings set owner_id = null$$, '42501', 'the owner cannot give up owner_id');
select test.throws($$update public.settings set id = gen_random_uuid()$$, '42501', 'the owner cannot change the settings id');
select test.throws($$update public.settings set updated_at = '2000-01-01'$$, '42501', 'the owner cannot set settings.updated_at');
select test.throws($$insert into public.settings default values$$, '42501', 'the owner cannot add a settings row');
select test.throws($$delete from public.settings$$, '42501', 'the owner cannot delete settings');
select test.throws($$update public.settings set timezone = 'Mars/Olympus'$$, 'JV400', 'an unknown timezone is refused');
select test.throws($$update public.settings set quiet_hours_start = '25:00'$$, 'JV400', 'a bad quiet-hours time is refused');
select test.throws($$update public.settings set notify_phone = '512 555 0100'$$, 'JV400', 'a phone without country code is refused');
select test.throws($$update public.settings set allowed_repos = '{"not a repo"}'$$, 'JV400', 'a malformed repo is refused');
select test.throws($$update public.settings set notification_prefs = '{"missed_call":"pager"}'$$, '23514', 'bad notification prefs are refused');
select test.throws($$update public.settings set notification_prefs = '[]'$$, '23514', 'notification prefs must be an object');

-- Tables Jarvis writes are read-only for the owner.
select test.throws($$insert into public.calls (shop_id, caller_phone, started_at, outcome) select id, '+1', now(), 'missed' from public.shops limit 1$$,
  '42501', 'the owner cannot insert a call');
select test.throws(format($$update public.tasks set status = 'done' where id = %L$$, (select task_id from t_ctx)),
  '42501', 'the owner cannot update a task');
select test.throws($$delete from public.tasks$$, '42501', 'the owner cannot delete tasks');
select test.throws($$insert into public.task_events (task_id, kind, message) select id, 'log', 'x' from public.tasks limit 1$$,
  '42501', 'the owner cannot write task events');
select test.throws($$update public.approvals set status = 'approved'$$, '42501', 'the owner cannot answer approvals directly');
select test.throws(format($$update public.shops set status = 'paused' where id = %L$$, (select shop_id from t_ctx)),
  '42501', 'the owner cannot change a shop');
select test.throws($$delete from public.shops$$, '42501', 'the owner cannot delete shops');
select test.throws($$update public.appointments set status = 'cancelled'$$, '42501', 'the owner cannot change appointments');
select test.throws($$truncate public.handbook_entries$$, '42501', 'the owner cannot truncate');

-- Internal functions are for the service role, not the owner's token.
select test.throws($$select public.jarvis_create_task('jarvis-ops/booking-site', 'x')$$, '42501', 'the owner cannot run jarvis_create_task');
select test.throws($$select public.jarvis_record_dispatch(gen_random_uuid(), 'accepted', null, null)$$, '42501', 'the owner cannot run jarvis_record_dispatch');
select test.throws($$select public.jarvis_cancel_task(gen_random_uuid())$$, '42501', 'the owner cannot run jarvis_cancel_task');
select test.throws($$select public.jarvis_decide_approval(gen_random_uuid(), 'approved')$$, '42501', 'the owner cannot run jarvis_decide_approval');
select test.throws($$select public.jarvis_apply_events('[]')$$, '42501', 'the owner cannot run jarvis_apply_events');
select test.throws($$select jarvis.route_alert('system')$$, '42501', 'the owner cannot reach the jarvis schema');
select test.throws($$select private.claim_owner()$$, '42501', 'the owner cannot run the owner-claim trigger function');
select test.throws($$create table public.sneaky (id int)$$, '42501', 'the owner cannot create tables');

select test.as_admin();
