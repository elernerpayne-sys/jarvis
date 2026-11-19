-- The shape of the lock: RLS, policies, privileges, function settings,
-- default privileges, realtime, and the seed (applied twice, no duplicates).

create temp table t_tables (name text primary key) on commit drop;
insert into t_tables values ('shops'), ('calls'), ('appointments'), ('tasks'), ('task_events'),
  ('approvals'), ('alerts'), ('handbook_entries'), ('decisions'), ('settings');
grant select on t_tables to public;

-- Exactly the ten tables live in public.
select test.is((select string_agg(c.relname, ',' order by c.relname) from pg_class c
                join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')),
               (select string_agg(name, ',' order by name) from t_tables),
               'public holds exactly the ten tables');

-- RLS on everywhere.
select test.ok(c.relrowsecurity, 'RLS is enabled on ' || t.name)
from t_tables t join pg_class c on c.oid = ('public.' || t.name)::regclass;

-- Policies only for authenticated (none for anon or PUBLIC), none permissive "true".
select test.ok(not exists (
  select 1 from pg_policies where schemaname = 'public' and roles <> '{authenticated}'
), 'every policy is for the authenticated role only (none for anon or public)');
select test.ok(not exists (
  select 1 from pg_policies where schemaname = 'public'
    and ((cmd <> 'INSERT' and coalesce(qual, '') not like '%private.is_owner()%')
         or (cmd = 'INSERT' and with_check is null)
         or (with_check is not null and with_check not like '%private.is_owner()%'))
), 'every policy checks private.is_owner()');
select test.ok(not exists (select 1 from pg_policies where schemaname = 'public' and permissive <> 'PERMISSIVE'),
  'no restrictive policies to reason about');

-- Exact table privileges per role.
create temp table t_priv (role text, tbl text, privs text) on commit drop;
insert into t_priv
select r.role, t.name,
       coalesce(string_agg(p.priv, ',' order by p.priv)
                filter (where has_table_privilege(r.role, 'public.' || t.name, p.priv)), '')
from t_tables t
cross join (values ('anon'), ('authenticated'), ('public')) as r (role)
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) as p (priv)
where r.role <> 'public'
group by r.role, t.name;

select test.is(privs, '', 'anon has no privilege on ' || tbl) from t_priv where role = 'anon';
select test.is(privs,
  case when tbl in ('handbook_entries', 'decisions') then 'DELETE,SELECT' else 'SELECT' end,
  'authenticated has only the table-wide privileges it needs on ' || tbl)
from t_priv where role = 'authenticated';

-- Column privileges for authenticated beyond SELECT: exactly the contract.
select test.is(
  (select string_agg(table_name || '.' || column_name || ':' || privilege_type, ',' order by table_name || '.' || column_name || ':' || privilege_type collate "C")
   from information_schema.column_privileges
   where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'),
  'alerts.read_at:UPDATE,decisions.decided_on:INSERT,decisions.decided_on:UPDATE,decisions.decision:INSERT,decisions.decision:UPDATE,decisions.rationale:INSERT,decisions.rationale:UPDATE,decisions.tags:INSERT,decisions.tags:UPDATE,decisions.title:INSERT,decisions.title:UPDATE,handbook_entries.category:INSERT,handbook_entries.category:UPDATE,handbook_entries.content:INSERT,handbook_entries.content:UPDATE,handbook_entries.tags:INSERT,handbook_entries.tags:UPDATE,handbook_entries.title:INSERT,handbook_entries.title:UPDATE,settings.allowed_repos:UPDATE,settings.notification_prefs:UPDATE,settings.notify_phone:UPDATE,settings.quiet_hours_enabled:UPDATE,settings.quiet_hours_end:UPDATE,settings.quiet_hours_start:UPDATE,settings.timezone:UPDATE',
  'authenticated may write exactly the contract''s columns');
select test.ok(not has_column_privilege('authenticated', 'public.settings', 'owner_id', 'UPDATE'),
  'authenticated cannot update settings.owner_id');
select test.ok(has_table_privilege('service_role', 'public.' || name, 'SELECT,INSERT,UPDATE,DELETE'),
  'service_role keeps full access to ' || name) from t_tables;

-- Schemas: nobody but the admin creates objects; private / jarvis stay closed.
select test.ok(not has_schema_privilege(r, 'public', 'CREATE'), r || ' cannot create objects in public')
from unnest(array['anon', 'authenticated']) as r;
select test.ok(not has_schema_privilege('anon', 'private', 'USAGE'), 'anon cannot use schema private');
select test.ok(has_schema_privilege('authenticated', 'private', 'USAGE'), 'authenticated can use schema private (for is_owner)');
select test.ok(not has_schema_privilege(r, 'jarvis', 'USAGE'), r || ' cannot use schema jarvis')
from unnest(array['anon', 'authenticated']) as r;

-- Functions: who may run what.
create temp table t_fn on commit drop as
select p.oid, n.nspname || '.' || p.proname as name, p.prosecdef, p.proconfig, p.prokind
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private', 'jarvis');
grant select on t_fn to public;

select test.ok(count(*) >= 30, 'found the migration''s functions') from t_fn;
select test.ok(not has_function_privilege('anon', oid, 'EXECUTE'), 'anon cannot run ' || name) from t_fn;
select test.ok(not has_function_privilege('public', oid, 'EXECUTE'), 'PUBLIC cannot run ' || name) from t_fn;
select test.is(
  (select string_agg(name, ',' order by name) from t_fn where has_function_privilege('authenticated', oid, 'EXECUTE')),
  'private.is_owner,public.get_brief,public.get_shop_summaries',
  'authenticated can run only is_owner, get_brief and get_shop_summaries');
select test.ok(has_function_privilege('service_role', ('public.' || f)::regproc, 'EXECUTE')
               and not has_function_privilege('authenticated', ('public.' || f)::regproc, 'EXECUTE'),
               f || ' is service-role only')
from unnest(array['jarvis_create_task', 'jarvis_record_dispatch', 'jarvis_cancel_task',
                  'jarvis_decide_approval', 'jarvis_apply_events']) as f;
select test.ok(proconfig @> array['search_path=""'], name || ' pins an empty search_path') from t_fn;
select test.is(
  (select string_agg(name, ',' order by name) from t_fn where prosecdef),
  'private.claim_owner,private.is_owner',
  'only is_owner and the owner-claim trigger are SECURITY DEFINER');
select test.ok(not p.prosecdef, 'RPC ' || p.proname || ' is SECURITY INVOKER')
from pg_proc p where p.oid in ('public.get_brief'::regproc, 'public.get_shop_summaries'::regproc);
select test.is(provolatile::text, 's', 'private.is_owner is STABLE') from pg_proc where oid = 'private.is_owner'::regproc;

-- Anything created later is closed by default (default privileges).
create table public.later_table (id int);
create function public.later_function() returns int language sql as 'select 1';
select test.ok(not has_table_privilege(r, 'public.later_table', 'SELECT')
               and not has_table_privilege(r, 'public.later_table', 'INSERT'),
               'a table created later is not open to ' || r)
from unnest(array['anon', 'authenticated']) as r;
select test.ok(not has_function_privilege(r, 'public.later_function()', 'EXECUTE'),
               'a function created later is not runnable by ' || r)
from unnest(array['anon', 'authenticated', 'public']) as r;

-- updated_at triggers.
select test.ok(exists (select 1 from pg_trigger where tgrelid = ('public.' || t)::regclass
                       and tgname = t || '_set_updated_at'), 'updated_at is maintained on ' || t)
from unnest(array['tasks', 'handbook_entries', 'decisions', 'settings']) as t;

-- Settings: one row, defaults as in src/lib/types.ts, a second row impossible.
select test.is((select count(*) from public.settings), 1::bigint, 'settings has exactly one row');
select test.is((select notification_prefs from public.settings),
  '{"missed_call":"text","failed_call":"text","approval_needed":"text","task_done":"in_app","task_failed":"text","system":"in_app"}'::jsonb,
  'default notification preferences');
select test.is((select format('%s %s-%s %s', quiet_hours_enabled, quiet_hours_start, quiet_hours_end, timezone) from public.settings),
  'f 22:00-07:00 UTC', 'default quiet hours and timezone');
select test.is((select owner_id from public.settings), null::uuid, 'no owner before the first account exists');
select test.throws($$insert into public.settings default values$$, '23505', 'a second settings row is refused');
select test.throws($$insert into public.settings (quiet_hours_start) values ('7:00')$$, 'JV400', 'quiet hours must be HH:MM');

-- Foreign keys behave as designed.
select test.is(
  (select string_agg(conrelid::regclass::text || '.' || a.attname || ':' || confdeltype::text, ',' order by conrelid::regclass::text || '.' || a.attname collate "C")
   from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.contype = 'f' and c.connamespace = 'public'::regnamespace),
  'alerts.approval_id:n,alerts.call_id:n,alerts.shop_id:n,alerts.task_id:n,appointments.call_id:n,appointments.shop_id:c,approvals.shop_id:n,approvals.task_id:n,calls.shop_id:c,settings.owner_id:r,task_events.task_id:c',
  'ON DELETE rules: shop -> calls/appointments cascade, task -> events cascade, links set null');

-- Realtime.
select test.is(
  (select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime'),
  'alerts,appointments,approvals,calls,task_events,tasks', 'the six realtime tables are published');
select test.is(c.relreplident::text, 'f', c.relname || ' has replica identity full')
from pg_class c where c.oid in ('public.tasks'::regclass, 'public.task_events'::regclass, 'public.approvals'::regclass,
                                'public.alerts'::regclass, 'public.calls'::regclass, 'public.appointments'::regclass);

-- The seed ran twice without duplicates and covers what the app shows.
select test.is((select count(*) from public.shops), 3::bigint, 'seed: three shops (after two runs)');
select test.is((select count(distinct outcome) from public.calls), 6::bigint, 'seed: calls cover all six outcomes');
select test.is((select count(distinct status) from public.tasks), 6::bigint, 'seed: tasks in every status');
select test.is((select count(*) from public.approvals where status = 'pending'), 3::bigint, 'seed: three pending approvals');
select test.is((select count(*) from public.task_events), 17::bigint, 'seed: task events not duplicated');
select test.is((select allowed_repos from public.settings),
  '{jarvis-ops/booking-site,jarvis-ops/jarvis-backend,jarvis-ops/receptionist-agent,jarvis-ops/shop-dashboard}'::text[],
  'seed: four allowed repos, no duplicates');
