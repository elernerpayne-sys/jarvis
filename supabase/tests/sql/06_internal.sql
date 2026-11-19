-- The four internal functions behind jarvis-command, run as the service role.
-- Seed repos are allowed (jarvis-ops/booking-site, …).

create temp table t_k (k text primary key, id uuid) on commit drop;
grant select, insert, update on t_k to service_role;

select test.as_service();

-- jarvis_create_task ------------------------------------------------------
insert into t_k select 'a', (public.jarvis_create_task('jarvis-ops/booking-site',
  E'  Fix the footer links\nThey point at the old domain.  ')).id;
select test.is((select format('%s|%s|%s|%s', status, title, repo, instructions) from public.tasks where id = (select id from t_k where k = 'a')),
  E'queued|Fix the footer links|jarvis-ops/booking-site|Fix the footer links\nThey point at the old domain.',
  'create_task: queued, title from the first line, instructions trimmed');
select test.is((select string_agg(kind || ':' || message, ',') from public.task_events where task_id = (select id from t_k where k = 'a')),
  'status:Queued', 'create_task logs a "Queued" status event');
select test.is((select title from public.jarvis_create_task('jarvis-ops/booking-site',
  'Refactor the booking widget so that it loads the calendar lazily and stops blocking the first paint')),
  'Refactor the booking widget so that it loads the calendar lazily and…',
  'a long first line is cut at a word boundary with an ellipsis');
select test.ok((select char_length(title) <= 73 from public.jarvis_create_task('jarvis-ops/booking-site', repeat('x', 200))),
  'a first line with no spaces is cut at 72 characters plus the ellipsis');
select test.is((select char_length(instructions) from public.jarvis_create_task('jarvis-ops/booking-site', repeat('y', 8000))),
  8000, '8000 characters are accepted');
select test.throws($$select public.jarvis_create_task('evil/repo', 'do it')$$, 'JV400', 'a repo not on the list is refused', '%not on your list%');
select test.throws($$select public.jarvis_create_task('', 'do it')$$, 'JV400', 'an empty repo is refused');
select test.throws($$select public.jarvis_create_task(null, 'do it')$$, 'JV400', 'a null repo is refused');
select test.throws($$select public.jarvis_create_task('jarvis-ops/booking-site', E'  \n\t ')$$, 'JV400', 'blank instructions are refused');
select test.throws($$select public.jarvis_create_task('jarvis-ops/booking-site', null)$$, 'JV400', 'null instructions are refused');
select test.throws($$select public.jarvis_create_task('jarvis-ops/booking-site', repeat('z', 8001))$$, 'JV400', '8001 characters are refused', '%8000%');

-- jarvis_record_dispatch --------------------------------------------------
select test.is((select external_id from public.jarvis_record_dispatch((select id from t_k where k = 'a'), 'accepted', 'ext-a', null)),
  'ext-a', 'dispatch accepted stores the external id');
select test.is((select message from public.task_events where task_id = (select id from t_k where k = 'a') and kind = 'log'),
  'Sent to Jarvis.', 'dispatch accepted logs "Sent to Jarvis."');
insert into t_k select 'b', (public.jarvis_create_task('jarvis-ops/booking-site', 'Second task')).id;
select test.is((select status from public.jarvis_record_dispatch((select id from t_k where k = 'b'), 'accepted', null, null)),
  'queued', 'dispatch accepted without an id keeps the task queued');
select test.throws(format($$select public.jarvis_record_dispatch(%L, 'accepted', 'ext-a', null)$$, (select id from t_k where k = 'b')),
  'JV400', 'an external id already used by another task is refused');
insert into t_k select 'c', (public.jarvis_create_task('jarvis-ops/booking-site', 'Third task')).id;
select test.is((select status from public.jarvis_record_dispatch((select id from t_k where k = 'c'), 'not_configured', null, null)),
  'queued', 'dispatch not_configured keeps the task queued');
select test.is((select message from public.task_events where task_id = (select id from t_k where k = 'c') and kind = 'log'),
  'Jarvis backend isn''t connected yet. This task will wait in the queue.', 'dispatch not_configured logs the waiting message');
insert into t_k select 'd', (public.jarvis_create_task('jarvis-ops/booking-site', 'Fourth task')).id;
select test.is((select format('%s|%s|%s', status, error, finished_at = now())
                from public.jarvis_record_dispatch((select id from t_k where k = 'd'), 'rejected', null, 'Repo not cloned.')),
  'failed|Repo not cloned.|t', 'dispatch rejected fails the task with the reason and finished_at');
select test.is((select message from public.task_events where task_id = (select id from t_k where k = 'd') and kind = 'error'),
  'Repo not cloned.', 'dispatch rejected logs an error event');
select test.throws($$select public.jarvis_record_dispatch(gen_random_uuid(), 'accepted', null, null)$$, 'JV404', 'dispatch for a missing task');
select test.throws(format($$select public.jarvis_record_dispatch(%L, 'maybe', null, null)$$, (select id from t_k where k = 'c')),
  'JV400', 'an unknown dispatch outcome is refused');

-- jarvis_cancel_task ------------------------------------------------------
insert into public.approvals (kind, title, task_id) select 'code', 'Merge?', id from t_k where k = 'c';
update public.tasks set status = 'needs_approval' where id = (select id from t_k where k = 'c');
select test.is((select format('%s|%s', status, finished_at = now()) from public.jarvis_cancel_task((select id from t_k where k = 'c'))),
  'cancelled|t', 'cancel sets cancelled and finished_at');
select test.is((select string_agg(status, ',') from public.approvals where task_id = (select id from t_k where k = 'c')),
  'expired', 'cancel expires the task''s pending approvals');
select test.is((select message from public.task_events where task_id = (select id from t_k where k = 'c') order by created_at desc limit 1),
  'Cancelled by you', 'cancel logs "Cancelled by you"');
select test.throws(format($$select public.jarvis_cancel_task(%L)$$, (select id from t_k where k = 'c')), 'JV409', 'cancelling a cancelled task');
select test.throws(format($$select public.jarvis_cancel_task(%L)$$, (select id from t_k where k = 'd')), 'JV409', 'cancelling a failed task');
update public.tasks set status = 'done' where id = (select id from t_k where k = 'b');
select test.throws(format($$select public.jarvis_cancel_task(%L)$$, (select id from t_k where k = 'b')), 'JV409', 'cancelling a done task');
select test.throws($$select public.jarvis_cancel_task(gen_random_uuid())$$, 'JV404', 'cancelling a missing task');
update public.tasks set status = 'running' where id = (select id from t_k where k = 'a');
select test.is((select status from public.jarvis_cancel_task((select id from t_k where k = 'a'))), 'cancelled', 'a running task can be cancelled');
select test.is((select status from public.jarvis_record_dispatch((select id from t_k where k = 'a'), 'rejected', null, 'late')),
  'cancelled', 'a late rejection does not reopen a cancelled task');

-- jarvis_decide_approval --------------------------------------------------
insert into t_k select 'e', (public.jarvis_create_task('jarvis-ops/booking-site', 'Fifth task')).id;
update public.tasks set status = 'needs_approval', started_at = null where id = (select id from t_k where k = 'e');
with y as (insert into public.approvals (kind, title, task_id) select 'code', 'Merge it?', id from t_k where k = 'e' returning id)
insert into t_k select 'ap1', id from y;
select test.is((select format('%s|%s', status, decided_at = now()) from public.jarvis_decide_approval((select id from t_k where k = 'ap1'), 'approved')),
  'approved|t', 'approving sets the status and decided_at');
select test.is((select format('%s|%s', status, started_at is not null) from public.tasks where id = (select id from t_k where k = 'e')),
  'running|t', 'approving a waiting task sets it running');
select test.is((select message from public.task_events where task_id = (select id from t_k where k = 'e') order by created_at desc limit 1),
  'Approved by you', 'approving logs "Approved by you"');
select test.throws(format($$select public.jarvis_decide_approval(%L, 'denied')$$, (select id from t_k where k = 'ap1')),
  'JV409', 'an approval cannot be decided twice', '%already approved%');

update public.tasks set status = 'needs_approval' where id = (select id from t_k where k = 'e');
insert into public.approvals (kind, title, task_id) select 'code', 'Deploy?', id from t_k where k = 'e';
insert into public.approvals (kind, title, task_id) select 'spend', 'Pay?', id from t_k where k = 'e';
select test.is((select status from public.jarvis_decide_approval(
                  (select id from public.approvals where title = 'Deploy?'), 'denied')),
  'denied', 'denying sets the status');
select test.is((select format('%s|%s', status, finished_at = now()) from public.tasks where id = (select id from t_k where k = 'e')),
  'cancelled|t', 'denying a waiting task cancels it with finished_at');
select test.is((select status from public.approvals where title = 'Pay?'), 'expired', 'denying expires the task''s other pending approvals');
select test.is((select message from public.task_events where task_id = (select id from t_k where k = 'e') order by created_at desc limit 1),
  'Denied by you', 'denying logs "Denied by you"');
select test.throws(format($$select public.jarvis_decide_approval(%L, 'approved')$$, (select id from public.approvals where title = 'Pay?')),
  'JV409', 'an expired approval cannot be decided', '%expired%');

-- An approval with no task, and one whose task is not waiting.
insert into public.approvals (kind, title) values ('other', 'Standalone?');
select test.is((select status from public.jarvis_decide_approval((select id from public.approvals where title = 'Standalone?'), 'approved')),
  'approved', 'an approval without a task can be approved');
insert into public.approvals (kind, title, task_id) select 'code', 'Late?', id from t_k where k = 'd';
select test.is((select status from public.jarvis_decide_approval((select id from public.approvals where title = 'Late?'), 'approved')),
  'approved', 'approving for a finished task records the answer');
select test.is((select status from public.tasks where id = (select id from t_k where k = 'd')), 'failed', '…and leaves the finished task alone');
select test.throws($$select public.jarvis_decide_approval(gen_random_uuid(), 'approved')$$, 'JV404', 'deciding a missing approval');
select test.throws(format($$select public.jarvis_decide_approval(%L, 'maybe')$$, (select id from public.approvals where title = 'Merge?')),
  'JV400', 'a decision other than approved/denied is refused');

select test.as_admin();
