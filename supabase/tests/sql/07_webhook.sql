-- jarvis_apply_events: every event type, both reference styles, idempotent
-- re-sends, sticky terminal status, a bad event mid-batch, alert routing.

-- One event in, its result out.
create function pg_temp.ev(p_type text, p_data jsonb) returns jsonb language sql as $$
  select public.jarvis_apply_events(jsonb_build_array(jsonb_build_object('type', p_type, 'data', p_data))) -> 0
$$;
grant execute on function pg_temp.ev(text, jsonb) to service_role;
create temp table t_r (k text primary key, v jsonb) on commit drop;
grant select, insert on t_r to service_role;

select test.as_service();

-- shop.upsert --------------------------------------------------------------
insert into t_r values ('shop', pg_temp.ev('shop.upsert', '{"name":"Hook Shop","phone":"+15127770001","timezone":"America/Chicago"}'));
select test.is((select v ->> 'ok' from t_r where k = 'shop'), 'true', 'shop.upsert creates a shop');
select test.is(pg_temp.ev('shop.upsert', '{"name":"Hook Shop II","phone":"+15127770001","status":"paused"}') ->> 'id',
  (select v ->> 'id' from t_r where k = 'shop'), 'shop.upsert with the same phone updates the same shop');
select test.is((select format('%s|%s|%s', name, status, timezone) from public.shops where phone = '+15127770001'),
  'Hook Shop II|paused|America/Chicago', 'shop.upsert updated name and status and kept the timezone');
select test.is((select count(*) from public.shops where phone = '+15127770001'), 1::bigint, 'still one shop with that phone');
select test.is(pg_temp.ev('shop.upsert', '{"name":"X","phone":"5551234"}') ->> 'error',
  '"phone" must be the full number with country code and digits only, like +15125550142.', 'a bad phone is explained');
select test.is(pg_temp.ev('shop.upsert', '{"name":"X","phone":"+15127770009","timezone":"Nowhere/Here"}') ->> 'ok',
  'false', 'an unknown shop timezone is refused');

-- call.upsert: by shop_phone and by shop_id, re-sent ------------------------
insert into t_r values ('call', pg_temp.ev('call.upsert', '{"external_id":"CA1","shop_phone":"+15127770001","caller_phone":"+15125551111",
  "started_at":"2030-02-01T15:00:00Z","outcome":"answered","transcript":[{"role":"agent","text":"Hi","t":0}]}'));
select test.is((select v ->> 'ok' from t_r where k = 'call'), 'true', 'call.upsert by shop_phone creates a call');
select test.is(pg_temp.ev('call.upsert', jsonb_build_object('external_id', 'CA1', 'shop_id', (select v ->> 'id' from t_r where k = 'shop'),
  'caller_phone', '+15125551111', 'started_at', '2030-02-01T15:00:00Z', 'outcome', 'booked', 'duration_seconds', 95, 'summary', 'Booked.')) ->> 'id',
  (select v ->> 'id' from t_r where k = 'call'), 'call.upsert by shop_id with the same external_id updates the same call');
select test.is((select format('%s|%s|%s|%s', count(*), max(outcome), max(duration_seconds), max(jsonb_array_length(transcript)))
                from public.calls where external_id = 'CA1'), '1|booked|95|1', 'one row; outcome updated; transcript kept');
select test.is(pg_temp.ev('call.upsert', '{"external_id":"CA2","shop_phone":"+19999999999","caller_phone":"+1","started_at":"2030-02-01T15:00:00Z","outcome":"missed"}') ->> 'error',
  'No shop with that phone number. Send shop.upsert first.', 'an unknown shop phone is explained');
select test.is(pg_temp.ev('call.upsert', '{"external_id":"CA2","shop_phone":"+15127770001","caller_phone":"+1","started_at":"2030-02-01 15:00","outcome":"missed"}') ->> 'error',
  '"started_at" must be an ISO-8601 time with its timezone, like 2026-11-19T15:04:05Z.', 'a time without a zone is refused');
select test.is(pg_temp.ev('call.upsert', '{"external_id":"CA2","shop_phone":"+15127770001","caller_phone":"+1","started_at":"2030-02-01T15:00:00Z","outcome":"hung_up"}') ->> 'error',
  '"hung_up" is not a valid outcome. Use one of: booked, answered, message, transferred, missed, failed.', 'a bad outcome is explained');
select test.is(pg_temp.ev('call.upsert', '{"external_id":"CA2","shop_phone":"+15127770001","caller_phone":"+1","started_at":"2030-02-01T15:00:00Z","outcome":"missed","transcript":[{"role":"bot","text":"x","t":0}]}') ->> 'ok',
  'false', 'a bad transcript turn is refused');
select test.ok(pg_temp.ev('call.upsert', '{"external_id":"CA2","shop_phone":"+15127770001","caller_phone":"+1","started_at":"2030-02-01T15:00:00Z","outcome":"missed","colour":"red"}') ->> 'error'
  like 'Unknown field "colour" in call.upsert.%', 'an unknown field is refused by name');
select test.is(pg_temp.ev('call.upsert', '{"external_id":"CA2","caller_phone":"+1","started_at":"2030-02-01T15:00:00Z","outcome":"missed"}') ->> 'error',
  'Say which shop this is for: send "shop_id" or "shop_phone".', 'a missing shop ref is explained');

-- appointment.upsert, with a call ref by external id ------------------------
insert into t_r values ('appt', pg_temp.ev('appointment.upsert', '{"external_id":"AP1","shop_phone":"+15127770001","customer_name":"Ana",
  "service":"Fade","starts_at":"2030-02-02T16:00:00-06:00","call_external_id":"CA1"}'));
select test.is((select format('%s|%s|%s|%s', status, source, duration_minutes, call_id = (select (v ->> 'id')::uuid from t_r where k = 'call'))
                from public.appointments where external_id = 'AP1'), 'booked|jarvis|30|t', 'appointment.upsert creates with defaults and links the call');
select test.is(pg_temp.ev('appointment.upsert', jsonb_build_object('external_id', 'AP1', 'shop_id', (select v ->> 'id' from t_r where k = 'shop'),
  'customer_name', 'Ana', 'service', 'Fade', 'starts_at', '2030-02-02T17:00:00Z', 'status', 'confirmed',
  'call_id', (select v ->> 'id' from t_r where k = 'call'))) ->> 'id',
  (select v ->> 'id' from t_r where k = 'appt'), 'appointment.upsert re-sent updates the same row (by shop_id / call_id)');
select test.is((select format('%s|%s', count(*), max(status)) from public.appointments where external_id = 'AP1'), '1|confirmed', 'one appointment, status updated');
select test.is(pg_temp.ev('appointment.upsert', '{"external_id":"AP2","shop_phone":"+15127770001","customer_name":"B","service":"Cut","starts_at":"2030-02-02T16:00:00Z","call_external_id":"nope"}') ->> 'error',
  'No call with that external id.', 'an unknown call ref is explained');

-- task.update: both refs, stamping, sticky terminal status ------------------
insert into public.tasks (id, title, repo, instructions, status)
values ('00000000-0000-4000-8000-0000000000f1', 'Hook task', 'acme/site', 'x', 'queued');
select test.is(pg_temp.ev('task.update', '{"task_id":"00000000-0000-4000-8000-0000000000f1","external_id":"JT1","status":"running","branch":"b1"}') ->> 'ok',
  'true', 'task.update by task_id');
select test.is((select format('%s|%s|%s|%s', status, external_id, branch, started_at = now()) from public.tasks where external_id = 'JT1'),
  'running|JT1|b1|t', 'running stamps started_at');
select test.is(pg_temp.ev('task.update', '{"task_external_id":"JT1","status":"done","pr_url":"https://example.com/pr/1","result_summary":"Done."}') ->> 'id',
  '00000000-0000-4000-8000-0000000000f1', 'task.update by task_external_id');
select test.is((select format('%s|%s', status, finished_at = now()) from public.tasks where external_id = 'JT1'), 'done|t', 'done stamps finished_at');
update public.tasks set finished_at = '2030-01-01T00:00:00Z' where external_id = 'JT1';
select test.is(pg_temp.ev('task.update', '{"task_external_id":"JT1","status":"running","result_summary":"Late note."}') ->> 'ok',
  'true', 'an update to a finished task is accepted');
select test.is((select format('%s|%s|%s', status, result_summary, finished_at) from public.tasks where external_id = 'JT1'),
  'done|Late note.|2030-01-01 00:00:00+00', 'a finished task keeps its status and finished_at; other fields still update');
select test.is(pg_temp.ev('task.update', '{"task_id":"00000000-0000-4000-8000-0000000000f9","status":"done"}') ->> 'error',
  'No task with that id.', 'an unknown task id is explained');
select test.is(pg_temp.ev('task.update', '{"task_external_id":"JT1"}') ->> 'ok', 'false', 'task.update with nothing to change is refused');
select test.is(pg_temp.ev('task.update', '{"task_id":"00000000-0000-4000-8000-0000000000f1","task_external_id":"JT-other"}') ->> 'ok',
  'false', 'mismatched refs are refused');

-- task.event ---------------------------------------------------------------
select test.is(pg_temp.ev('task.event', '{"task_external_id":"JT1","kind":"command","message":"npm test"}') ->> 'ok', 'true', 'task.event by external id');
select test.is(pg_temp.ev('task.event', '{"task_id":"00000000-0000-4000-8000-0000000000f1","kind":"log","message":"hi","created_at":"2020-01-01T00:00:05Z"}') ->> 'ok',
  'true', 'task.event by id with created_at');
select test.is((select string_agg(kind || ':' || message, ',' order by created_at) from public.task_events where task_id = '00000000-0000-4000-8000-0000000000f1'),
  'log:hi,command:npm test', 'both lines were logged with their times');
select test.is(pg_temp.ev('task.event', '{"task_external_id":"JT1","kind":"shout","message":"x"}') ->> 'ok', 'false', 'a bad kind is refused');

-- approval.request / approval.expire ---------------------------------------
insert into public.tasks (id, external_id, title, repo, instructions, status)
values ('00000000-0000-4000-8000-0000000000f2', 'JT2', 'Waits', 'acme/site', 'x', 'running');
insert into t_r values ('ap', pg_temp.ev('approval.request', '{"kind":"code","title":"Merge?","task_external_id":"JT2","shop_phone":"+15127770001","expires_at":"2030-03-01T00:00:00Z"}'));
select test.is((select format('%s|%s|%s', a.status, a.shop_id is not null, t.status) from public.approvals a join public.tasks t on t.id = a.task_id
                where a.id = (select (v ->> 'id')::uuid from t_r where k = 'ap')),
  'pending|t|needs_approval', 'approval.request creates a pending approval and the running task waits');
select test.is(pg_temp.ev('approval.request', '{"kind":"code","title":"Too late?","task_id":"00000000-0000-4000-8000-0000000000f1"}') ->> 'ok', 'true',
  'an approval for a finished task is still recorded');
select test.is((select status from public.tasks where id = '00000000-0000-4000-8000-0000000000f1'), 'done', '…and the finished task stays done');
select test.is(pg_temp.ev('approval.expire', jsonb_build_object('id', (select v ->> 'id' from t_r where k = 'ap'))) ->> 'ok', 'true', 'approval.expire');
select test.is((select status from public.approvals where id = (select (v ->> 'id')::uuid from t_r where k = 'ap')), 'expired', 'the approval expired');
select test.is(pg_temp.ev('approval.expire', jsonb_build_object('id', (select v ->> 'id' from t_r where k = 'ap'))) ->> 'ok', 'true', 'expiring twice is fine');
select test.is(pg_temp.ev('approval.expire', '{"id":"00000000-0000-4000-8000-0000000000e9"}') ->> 'error', 'No approval with that id.', 'expiring a missing approval');
update public.approvals set status = 'approved' where id = (select (v ->> 'id')::uuid from t_r where k = 'ap');
select test.is(pg_temp.ev('approval.expire', jsonb_build_object('id', (select v ->> 'id' from t_r where k = 'ap'))) ->> 'error',
  'That approval was already approved, so it cannot expire.', 'an answered approval cannot expire');

-- alert.create (routing with the default settings: no phone → in_app) -------
insert into t_r values ('al', pg_temp.ev('alert.create', '{"type":"missed_call","title":"Missed call","call_external_id":"CA1","task_external_id":"JT1"}'));
select test.is((select v -> 'notify' from t_r where k = 'al'), '{"channel":"in_app","phone":null,"quiet_hours":false}'::jsonb,
  'without a phone on file a text becomes in_app');
select test.is((select format('%s|%s|%s', channel, shop_id = (select (v ->> 'id')::uuid from t_r where k = 'shop'), task_id is not null)
                from public.alerts where id = (select (v ->> 'id')::uuid from t_r where k = 'al')),
  'in_app|t|t', 'the alert stores its channel and takes the call''s shop');
select test.is(pg_temp.ev('alert.create', '{"type":"system","title":"x","approval_id":"00000000-0000-4000-8000-0000000000e9"}') ->> 'error',
  'No approval with that id.', 'an unknown approval_id is explained');

-- A batch with a bad event in the middle -----------------------------------
insert into t_r values ('batch', public.jarvis_apply_events('[
  {"type":"task.event","data":{"task_external_id":"JT2","kind":"log","message":"first"}},
  {"type":"task.update","data":{"task_external_id":"nope","status":"done"}},
  {"type":"nonsense.event","data":{}},
  {"type":"task.event","data":{"task_external_id":"JT2","kind":"log","message":"last"}}
]'));
select test.is((select string_agg(e ->> 'index' || ':' || (e ->> 'ok'), ',') from t_r, jsonb_array_elements(v) e where k = 'batch'),
  '0:true,1:false,2:false,3:true', 'bad events fail alone; the rest apply');
select test.is((select v -> 1 from t_r where k = 'batch'),
  '{"index":1,"type":"task.update","ok":false,"error":"No task with that external id."}'::jsonb, 'the failed entry has the documented shape');
select test.is((select v -> 2 ->> 'error' from t_r where k = 'batch'), 'Unknown event type "nonsense.event".', 'an unknown type is named');
select test.is((select string_agg(message, ',' order by created_at) from public.task_events where task_id = '00000000-0000-4000-8000-0000000000f2'),
  'first,last', 'the good events around the bad one were applied');
select test.is(public.jarvis_apply_events('{"type":"task.event","data":{"task_external_id":"JT2","kind":"log","message":"single"}}') -> 0 ->> 'ok',
  'true', 'a single event object is accepted');
select test.is(public.jarvis_apply_events('[{"type":"task.event"}]') -> 0 ->> 'error', '"data" must be an object.', 'missing data is explained');
select test.is(public.jarvis_apply_events('[{"type":"task.event","data":{},"extra":1}]') -> 0 ->> 'ok', 'false', 'an unknown top-level key is refused');
select test.throws($$select public.jarvis_apply_events((select jsonb_agg('{}'::jsonb) from generate_series(1, 101)))$$,
  'JV400', 'more than 100 events are refused');

-- Alert routing: preferences, quiet hours in a non-UTC timezone -------------
select test.as_admin();
update public.settings set notify_phone = '+15125550100', timezone = 'America/Chicago',
  quiet_hours_enabled = true, quiet_hours_start = '22:00', quiet_hours_end = '07:00',
  notification_prefs = '{"missed_call":"call","failed_call":"text","approval_needed":"text","task_done":"in_app","task_failed":"text","system":"in_app"}';
select test.as_service();
-- January: Chicago is UTC-6.
select test.is(jarvis.route_alert('missed_call', '2030-01-15T04:30:00Z'), '{"channel":"in_app","phone":"+15125550100","quiet_hours":true}'::jsonb,
  '22:30 Chicago is inside an overnight window: call becomes in_app');
select test.is(jarvis.route_alert('missed_call', '2030-01-15T04:00:00Z') ->> 'quiet_hours', 'true', '22:00 (start) is inside');
select test.is(jarvis.route_alert('missed_call', '2030-01-15T12:59:00Z') ->> 'quiet_hours', 'true', '06:59 is inside (after midnight)');
select test.is(jarvis.route_alert('missed_call', '2030-01-15T13:00:00Z'), '{"channel":"call","phone":"+15125550100","quiet_hours":false}'::jsonb,
  '07:00 (end) is outside: the call goes through');
select test.is(jarvis.route_alert('failed_call', '2030-01-15T20:00:00Z') ->> 'channel', 'text', '14:00: text stays text');
select test.is(jarvis.route_alert('failed_call', '2030-01-15T03:59:00Z') ->> 'channel', 'text', '21:59 is outside');
select test.is(jarvis.route_alert('task_done', '2030-01-15T20:00:00Z') ->> 'channel', 'in_app', 'an in_app preference stays in_app');
select test.is(jarvis.route_alert('task_done', '2030-01-15T04:30:00Z'), '{"channel":"in_app","phone":"+15125550100","quiet_hours":true}'::jsonb,
  'in_app during quiet hours still reports quiet_hours true');
-- July: Chicago is UTC-5 (daylight time is respected).
select test.is(jarvis.route_alert('missed_call', '2030-07-15T03:30:00Z') ->> 'quiet_hours', 'true', 'July 22:30 CDT is inside');
select test.is(jarvis.route_alert('missed_call', '2030-07-15T12:30:00Z') ->> 'quiet_hours', 'false', 'July 07:30 CDT is outside');
-- A same-day window and switched off.
select test.as_admin();
update public.settings set quiet_hours_start = '09:00', quiet_hours_end = '17:00';
select test.as_service();
select test.is(jarvis.route_alert('missed_call', '2030-01-15T18:00:00Z') ->> 'channel', 'in_app', 'same-day window: 12:00 is inside');
select test.is(jarvis.route_alert('missed_call', '2030-01-15T04:30:00Z') ->> 'channel', 'call', 'same-day window: 22:30 is outside');
select test.as_admin();
update public.settings set quiet_hours_enabled = false;
select test.as_service();
select test.is(jarvis.route_alert('missed_call', '2030-01-15T18:00:00Z'), '{"channel":"call","phone":"+15125550100","quiet_hours":false}'::jsonb,
  'quiet hours off: never quiet');
-- Through the webhook, with a window around the current time.
select test.as_admin();
update public.settings set quiet_hours_enabled = true,
  quiet_hours_start = to_char((now() at time zone 'America/Chicago') - interval '1 hour', 'HH24:MI'),
  quiet_hours_end   = to_char((now() at time zone 'America/Chicago') + interval '1 hour', 'HH24:MI');
select test.as_service();
insert into t_r values ('quiet', pg_temp.ev('alert.create', '{"type":"failed_call","title":"Dropped call","shop_phone":"+15127770001"}'));
select test.is((select v -> 'notify' from t_r where k = 'quiet'), '{"channel":"in_app","phone":"+15125550100","quiet_hours":true}'::jsonb,
  'alert.create during quiet hours returns in_app with quiet_hours true');
select test.is((select channel from public.alerts where id = (select (v ->> 'id')::uuid from t_r where k = 'quiet')), 'in_app',
  'the alert row records the routed channel');
select test.as_admin();
update public.settings set quiet_hours_enabled = false;
select test.as_service();
select test.is(pg_temp.ev('alert.create', '{"type":"failed_call","title":"Dropped call"}') -> 'notify',
  '{"channel":"text","phone":"+15125550100","quiet_hours":false}'::jsonb, 'alert.create outside quiet hours returns the preference');

select test.as_admin();
