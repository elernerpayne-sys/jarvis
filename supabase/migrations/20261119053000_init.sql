-- Jarvis: the whole database, in one file. Contract: docs/backend.md.
--
-- The rule behind everything here: exactly ONE account, the owner, may read
-- anything, and the owner's own session can only write what the app needs.
-- Everything Jarvis writes goes through edge functions using the service role.
--
--   who             may do what
--   --------------  ---------------------------------------------------------
--   signed out      nothing (no privileges at all)
--   signed in,      nothing (row-level security hides every row and refuses
--   not the owner   every write)
--   the owner       read all ten tables; mark alerts read; add, edit and
--                   delete handbook entries and decisions; edit preferences
--   service role    everything (edge functions only; never in the browser)
--
-- Contents
--    1. Default deny for anything created later
--    2. Schemas: private (policy helper), jarvis (workings of the internal functions)
--    3. The ten tables
--    4. updated_at
--    5. Write guards (belt and braces behind the grants)
--    6. The owner: who it is and how the first account claims it
--    7. Row-level security: privileges and policies
--    8. RPCs the app calls: get_brief, get_shop_summaries
--    9. Reading a webhook payload safely (helpers)
--   10. Alert routing: preferences and quiet hours
--   11. Internal functions for jarvis-command
--   12. The webhook: one function per event type, then jarvis_apply_events
--   13. Who may run the functions
--   14. Realtime


-- ════════════════════════════════════════════════════════════════════════
-- 1. Default deny for anything created later
-- ════════════════════════════════════════════════════════════════════════
-- A Supabase project normally grants every NEW table, sequence and function
-- in "public" to the signed-out and signed-in roles automatically. Turn that
-- off for whoever runs this migration, so a table added later is invisible to
-- the app until someone grants it on purpose. (Per-schema defaults cannot
-- take away PUBLIC's built-in right to run new functions, hence the last
-- line, which is not limited to one schema.)
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;
-- And nobody but the admin may create objects in "public".
revoke create on schema public from public, anon, authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- 2. Schemas
-- ════════════════════════════════════════════════════════════════════════
-- Neither schema is exposed by the Data API (only "public" is), so nothing in
-- them can be called from the browser.

-- private: the helper every policy calls, plus trigger functions.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- jarvis: the workings behind the service-role functions in section 11 and 12.
create schema if not exists jarvis;
revoke all on schema jarvis from public;
grant usage on schema jarvis to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 3. The ten tables
-- ════════════════════════════════════════════════════════════════════════
-- Columns are exactly the fields in src/lib/types.ts. Value sets are text +
-- CHECK (not enum types) so a new value is a one-line change later.

-- A barbershop whose phone Jarvis answers. The webhook finds a shop by phone.
create table public.shops (
  id         uuid primary key default gen_random_uuid(),
  name       text not null constraint shops_name_check check (btrim(name) <> ''),
  phone      text not null constraint shops_phone_key unique
             constraint shops_phone_check check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  address    text not null default '',
  timezone   text not null default 'UTC',
  status     text not null default 'active'
             constraint shops_status_check check (status in ('active', 'paused')),
  created_at timestamptz not null default now()
);

-- One phone call. Deleting a shop deletes its calls.
create table public.calls (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shops (id) on delete cascade,
  external_id      text constraint calls_external_id_key unique
                   constraint calls_external_id_check check (btrim(external_id) <> ''),
  caller_name      text,
  caller_phone     text not null,
  started_at       timestamptz not null,
  duration_seconds integer not null default 0
                   constraint calls_duration_seconds_check check (duration_seconds >= 0),
  outcome          text not null
                   constraint calls_outcome_check
                   check (outcome in ('booked', 'answered', 'message', 'transferred', 'missed', 'failed')),
  summary          text,
  transcript       jsonb not null default '[]'::jsonb
                   constraint calls_transcript_check check (jsonb_typeof(transcript) = 'array'),
  created_at       timestamptz not null default now()
);
create index calls_shop_started_idx on public.calls (shop_id, started_at desc);
create index calls_started_idx on public.calls (started_at desc);

-- A booking. Deleting a shop deletes its appointments; deleting the call that
-- produced a booking only clears the link.
create table public.appointments (
  id               uuid primary key default gen_random_uuid(),
  shop_id          uuid not null references public.shops (id) on delete cascade,
  external_id      text constraint appointments_external_id_key unique
                   constraint appointments_external_id_check check (btrim(external_id) <> ''),
  call_id          uuid references public.calls (id) on delete set null,
  customer_name    text not null constraint appointments_customer_name_check check (btrim(customer_name) <> ''),
  customer_phone   text,
  service          text not null constraint appointments_service_check check (btrim(service) <> ''),
  barber           text,
  starts_at        timestamptz not null,
  duration_minutes integer not null default 30
                   constraint appointments_duration_minutes_check check (duration_minutes between 1 and 1440),
  status           text not null default 'booked'
                   constraint appointments_status_check
                   check (status in ('booked', 'confirmed', 'completed', 'cancelled', 'no_show')),
  source           text not null default 'jarvis'
                   constraint appointments_source_check check (source in ('jarvis', 'online', 'walk_in')),
  notes            text,
  created_at       timestamptz not null default now()
);
create index appointments_shop_starts_idx on public.appointments (shop_id, starts_at);
create index appointments_call_idx on public.appointments (call_id);

-- A coding task for the Jarvis backend.
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  external_id    text constraint tasks_external_id_key unique
                 constraint tasks_external_id_check check (btrim(external_id) <> ''),
  title          text not null constraint tasks_title_check check (btrim(title) <> ''),
  repo           text not null
                 constraint tasks_repo_check check (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$'),
  instructions   text not null
                 constraint tasks_instructions_check check (char_length(btrim(instructions)) between 1 and 8000),
  status         text not null default 'queued'
                 constraint tasks_status_check
                 check (status in ('queued', 'running', 'needs_approval', 'done', 'failed', 'cancelled')),
  branch         text,
  result_summary text,
  pr_url         text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz
);
create index tasks_created_idx on public.tasks (created_at desc);
create index tasks_done_finished_idx on public.tasks (finished_at) where status = 'done';

-- One line in a task's progress log. Deleting a task deletes its log.
-- created_at uses the wall clock (not the transaction's start time) so lines
-- written in one webhook request still sort in the order they were sent.
create table public.task_events (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  kind       text not null
             constraint task_events_kind_check check (kind in ('status', 'log', 'command', 'error')),
  message    text not null constraint task_events_message_check check (btrim(message) <> ''),
  created_at timestamptz not null default clock_timestamp()
);
create index task_events_task_created_idx on public.task_events (task_id, created_at);

-- Something Jarvis will not do without a yes from the owner.
create table public.approvals (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null
               constraint approvals_kind_check check (kind in ('code', 'receptionist', 'spend', 'other')),
  title        text not null constraint approvals_title_check check (btrim(title) <> ''),
  detail       text,
  task_id      uuid references public.tasks (id) on delete set null,
  shop_id      uuid references public.shops (id) on delete set null,
  status       text not null default 'pending'
               constraint approvals_status_check check (status in ('pending', 'approved', 'denied', 'expired')),
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index approvals_status_requested_idx on public.approvals (status, requested_at desc);
create index approvals_task_idx on public.approvals (task_id);
create index approvals_shop_idx on public.approvals (shop_id);

-- Something the owner should know about. "channel" is where it was routed
-- after preferences and quiet hours were applied.
create table public.alerts (
  id          uuid primary key default gen_random_uuid(),
  type        text not null
              constraint alerts_type_check
              check (type in ('missed_call', 'failed_call', 'approval_needed', 'task_done', 'task_failed', 'system')),
  title       text not null constraint alerts_title_check check (btrim(title) <> ''),
  body        text,
  shop_id     uuid references public.shops (id) on delete set null,
  call_id     uuid references public.calls (id) on delete set null,
  task_id     uuid references public.tasks (id) on delete set null,
  approval_id uuid references public.approvals (id) on delete set null,
  channel     text not null default 'in_app'
              constraint alerts_channel_check check (channel in ('call', 'text', 'in_app')),
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index alerts_created_idx on public.alerts (created_at desc);
create index alerts_unread_idx on public.alerts (created_at desc) where read_at is null;
create index alerts_shop_idx on public.alerts (shop_id);
create index alerts_call_idx on public.alerts (call_id);
create index alerts_task_idx on public.alerts (task_id);
create index alerts_approval_idx on public.alerts (approval_id);

-- Memory: the Business Handbook. notion_page_id is for the later Notion sync.
create table public.handbook_entries (
  id             uuid primary key default gen_random_uuid(),
  title          text not null constraint handbook_entries_title_check check (btrim(title) <> ''),
  category       text not null default 'General',
  content        text not null default '',
  tags           text[] not null default '{}'
                 constraint handbook_entries_tags_check check (array_position(tags, null) is null),
  notion_page_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index handbook_entries_updated_idx on public.handbook_entries (updated_at desc);

-- Memory: the Decisions Log.
create table public.decisions (
  id             uuid primary key default gen_random_uuid(),
  title          text not null constraint decisions_title_check check (btrim(title) <> ''),
  decision       text not null,
  rationale      text,
  decided_on     date not null default current_date,
  tags           text[] not null default '{}'
                 constraint decisions_tags_check check (array_position(tags, null) is null),
  notion_page_id text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index decisions_decided_on_idx on public.decisions (decided_on desc);

-- Settings: exactly one row. owner_id is THE owner (section 6). While an
-- account is the owner it cannot be deleted from Supabase Auth; hand over
-- first with supabase/snippets/set_owner.sql. That keeps ownership from ever
-- becoming vacant and being claimed by whoever signs up next.
create table public.settings (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid references auth.users (id) on delete restrict,
  notify_phone        text constraint settings_notify_phone_check check (notify_phone ~ '^\+[1-9][0-9]{6,14}$'),
  notification_prefs  jsonb not null default '{
                        "missed_call": "text",
                        "failed_call": "text",
                        "approval_needed": "text",
                        "task_done": "in_app",
                        "task_failed": "text",
                        "system": "in_app"
                      }'::jsonb
                      constraint settings_notification_prefs_check check (
                        jsonb_typeof(notification_prefs) = 'object'
                        and notification_prefs ?& array['missed_call', 'failed_call', 'approval_needed', 'task_done', 'task_failed', 'system']
                        and notification_prefs - array['missed_call', 'failed_call', 'approval_needed', 'task_done', 'task_failed', 'system'] = '{}'::jsonb
                        and notification_prefs ->> 'missed_call'     in ('call', 'text', 'in_app')
                        and notification_prefs ->> 'failed_call'     in ('call', 'text', 'in_app')
                        and notification_prefs ->> 'approval_needed' in ('call', 'text', 'in_app')
                        and notification_prefs ->> 'task_done'       in ('call', 'text', 'in_app')
                        and notification_prefs ->> 'task_failed'     in ('call', 'text', 'in_app')
                        and notification_prefs ->> 'system'          in ('call', 'text', 'in_app')
                      ),
  quiet_hours_enabled boolean not null default false,
  quiet_hours_start   text not null default '22:00'
                      constraint settings_quiet_hours_start_check check (quiet_hours_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  quiet_hours_end     text not null default '07:00'
                      constraint settings_quiet_hours_end_check check (quiet_hours_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  timezone            text not null default 'UTC',
  allowed_repos       text[] not null default '{}'
                      constraint settings_allowed_repos_check check (array_position(allowed_repos, null) is null),
  updated_at          timestamptz not null default now()
);
-- Every row has the same value for this index, so a second row cannot exist.
create unique index settings_single_row_idx on public.settings ((true));


-- ════════════════════════════════════════════════════════════════════════
-- 4. updated_at
-- ════════════════════════════════════════════════════════════════════════
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function private.set_updated_at();
create trigger handbook_entries_set_updated_at before update on public.handbook_entries
  for each row execute function private.set_updated_at();
create trigger decisions_set_updated_at before update on public.decisions
  for each row execute function private.set_updated_at();
create trigger settings_set_updated_at before update on public.settings
  for each row execute function private.set_updated_at();


-- ════════════════════════════════════════════════════════════════════════
-- 5. Write guards (belt and braces behind the grants in section 7)
-- ════════════════════════════════════════════════════════════════════════
-- Errors a person may see use SQLSTATE JV400 and a plain sentence.

-- A time zone must be one Postgres can convert to, or quiet hours and shop
-- times could not be worked out.
create function private.check_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.timezone is not distinct from old.timezone then
    return new;
  end if;
  begin
    perform now() at time zone new.timezone;
  exception when others then
    raise exception using
      errcode = 'JV400',
      message = format('"%s" is not a time zone Jarvis knows. Use a name like America/Chicago.', new.timezone);
  end;
  return new;
end;
$$;

create trigger shops_check_timezone before insert or update on public.shops
  for each row execute function private.check_timezone();
create trigger settings_check_timezone before insert or update on public.settings
  for each row execute function private.check_timezone();

-- Settings: friendly messages for bad values, and a second lock on owner_id.
-- The app's roles have no privilege to change owner_id (section 7); this
-- trigger still refuses if such a privilege is ever granted by mistake.
create function private.guard_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = 'JV400', message = 'The settings row cannot be deleted.';
  end if;

  if tg_op = 'UPDATE'
     and new.owner_id is distinct from old.owner_id
     and current_user in ('anon', 'authenticated') then
    raise exception using
      errcode = '42501',
      message = 'The owner can only be changed by a project admin (see supabase/snippets/set_owner.sql).';
  end if;

  if new.notify_phone is not null and new.notify_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception using
      errcode = 'JV400',
      message = 'Write the phone number with its country code and digits only, like +15125550142.';
  end if;

  if new.quiet_hours_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or new.quiet_hours_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception using errcode = 'JV400', message = 'Quiet hours must be 24-hour times like 22:00.';
  end if;

  if cardinality(new.allowed_repos) > 100 then
    raise exception using errcode = 'JV400', message = 'That is too many repos. The limit is 100.';
  end if;
  if exists (
    select 1
    from unnest(new.allowed_repos) as r (repo)
    where r.repo is null or r.repo !~ '^[A-Za-z0-9][A-Za-z0-9-]*/[A-Za-z0-9._-]+$'
  ) then
    raise exception using errcode = 'JV400', message = 'Write each repo as owner/name, like acme/website.';
  end if;

  return new;
end;
$$;

create trigger settings_guard before insert or update or delete on public.settings
  for each row execute function private.guard_settings();

-- Alerts: the app may only mark an alert read or unread.
create function private.guard_alert_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated')
     and (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception using errcode = '42501', message = 'Only read_at can be changed on an alert.';
  end if;
  return new;
end;
$$;

create trigger alerts_guard_update before update on public.alerts
  for each row execute function private.guard_alert_update();


-- ════════════════════════════════════════════════════════════════════════
-- 6. The owner
-- ════════════════════════════════════════════════════════════════════════

-- The one settings row. If an account already exists, the earliest one is the
-- owner from the start; otherwise owner_id stays empty until the first account
-- is created (trigger below). Accounts made by anonymous sign-in never count.
insert into public.settings (owner_id)
select (
  select u.id
  from auth.users u
  where coalesce((to_jsonb(u) ->> 'is_anonymous')::boolean, false) = false
  order by u.created_at asc nulls last, u.id asc
  limit 1
)
where not exists (select 1 from public.settings);

-- The question every policy asks: "is the caller the owner?"
-- SECURITY DEFINER so it can read settings whatever the caller may see, with
-- an empty search_path so every name inside is spelled out in full.
-- Signed out, auth.uid() is null and the answer is false, never an error.
create function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.settings s
    where s.owner_id is not null
      and s.owner_id = (select auth.uid())
  );
$$;

-- The first account ever created claims the empty owner slot. Later accounts
-- find it taken and change nothing. This runs inside Supabase Auth's own
-- insert, so it must never raise: a failure here would block account creation.
create function private.claim_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false) then
    return new;
  end if;
  update public.settings set owner_id = new.id where owner_id is null;
  return new;
exception when others then
  raise warning 'jarvis: could not check ownership for the new account (%)', sqlerrm;
  return new;
end;
$$;

drop trigger if exists jarvis_claim_owner on auth.users;
create trigger jarvis_claim_owner after insert on auth.users
  for each row execute function private.claim_owner();


-- ════════════════════════════════════════════════════════════════════════
-- 7. Row-level security: privileges and policies
-- ════════════════════════════════════════════════════════════════════════
-- Two locks on every table:
--   privileges  what a ROLE may attempt. Signed out (anon): nothing.
--               Signed in (authenticated): only what is granted below.
--   policies    which ROWS a signed-in account may touch: all of them for the
--               owner, none for anybody else.
-- There is no policy for anon anywhere. "(select private.is_owner())" is
-- wrapped in a select so it is worked out once per statement, not per row.
-- FORCE makes the policies apply to the table's owner role too. settings is
-- the one table not forced, because is_owner() itself has to read it.

alter table public.shops            enable row level security;
alter table public.calls            enable row level security;
alter table public.appointments     enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_events      enable row level security;
alter table public.approvals        enable row level security;
alter table public.alerts           enable row level security;
alter table public.handbook_entries enable row level security;
alter table public.decisions        enable row level security;
alter table public.settings         enable row level security;

alter table public.shops            force row level security;
alter table public.calls            force row level security;
alter table public.appointments     force row level security;
alter table public.tasks            force row level security;
alter table public.task_events      force row level security;
alter table public.approvals        force row level security;
alter table public.alerts           force row level security;
alter table public.handbook_entries force row level security;
alter table public.decisions        force row level security;

-- Start from nothing, whatever the project granted automatically.
revoke all on table
  public.shops, public.calls, public.appointments, public.tasks, public.task_events,
  public.approvals, public.alerts, public.handbook_entries, public.decisions, public.settings
from public, anon, authenticated;

-- Edge functions (service role) do all of Jarvis's writing.
grant all on table
  public.shops, public.calls, public.appointments, public.tasks, public.task_events,
  public.approvals, public.alerts, public.handbook_entries, public.decisions, public.settings
to service_role;

-- The owner reads everything.
grant select on table
  public.shops, public.calls, public.appointments, public.tasks, public.task_events,
  public.approvals, public.alerts, public.handbook_entries, public.decisions, public.settings
to authenticated;

create policy shops_owner_read on public.shops
  for select to authenticated using ((select private.is_owner()));
create policy calls_owner_read on public.calls
  for select to authenticated using ((select private.is_owner()));
create policy appointments_owner_read on public.appointments
  for select to authenticated using ((select private.is_owner()));
create policy tasks_owner_read on public.tasks
  for select to authenticated using ((select private.is_owner()));
create policy task_events_owner_read on public.task_events
  for select to authenticated using ((select private.is_owner()));
create policy approvals_owner_read on public.approvals
  for select to authenticated using ((select private.is_owner()));
create policy alerts_owner_read on public.alerts
  for select to authenticated using ((select private.is_owner()));
create policy handbook_entries_owner_read on public.handbook_entries
  for select to authenticated using ((select private.is_owner()));
create policy decisions_owner_read on public.decisions
  for select to authenticated using ((select private.is_owner()));
create policy settings_owner_read on public.settings
  for select to authenticated using ((select private.is_owner()));

-- Alerts: the owner marks them read. One column, nothing else.
grant update (read_at) on table public.alerts to authenticated;
create policy alerts_owner_mark_read on public.alerts
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));

-- Memory: the owner adds, edits and deletes handbook entries and decisions.
-- Only the fields the app's forms write: id, timestamps and notion_page_id
-- (set by the later Notion sync) stay under the database's control.
grant insert (title, category, content, tags),
      update (title, category, content, tags)
  on table public.handbook_entries to authenticated;
grant insert (title, decision, rationale, decided_on, tags),
      update (title, decision, rationale, decided_on, tags)
  on table public.decisions to authenticated;
grant delete on table public.handbook_entries, public.decisions to authenticated;

create policy handbook_entries_owner_add on public.handbook_entries
  for insert to authenticated with check ((select private.is_owner()));
create policy handbook_entries_owner_edit on public.handbook_entries
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));
create policy handbook_entries_owner_delete on public.handbook_entries
  for delete to authenticated using ((select private.is_owner()));

create policy decisions_owner_add on public.decisions
  for insert to authenticated with check ((select private.is_owner()));
create policy decisions_owner_edit on public.decisions
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));
create policy decisions_owner_delete on public.decisions
  for delete to authenticated using ((select private.is_owner()));

-- Settings: the owner edits preferences. Not owner_id, not id, and the row
-- can be neither added nor deleted from the app.
grant update (
  notify_phone, notification_prefs, quiet_hours_enabled, quiet_hours_start,
  quiet_hours_end, timezone, allowed_repos
) on table public.settings to authenticated;
create policy settings_owner_edit on public.settings
  for update to authenticated
  using ((select private.is_owner()))
  with check ((select private.is_owner()));


-- ════════════════════════════════════════════════════════════════════════
-- 8. RPCs the app calls
-- ════════════════════════════════════════════════════════════════════════
-- Both run with the caller's own permissions (SECURITY INVOKER), so the
-- policies above decide what they can count: the owner gets real numbers,
-- any other account gets zeros and no rows. p_from is included, p_to is not.

-- Today's brief for the Home screen. Always exactly one row.
create function public.get_brief(p_from timestamptz, p_to timestamptz)
returns table (
  calls_answered integer,
  bookings_made  integer,
  missed_calls   integer,
  tasks_finished integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*) from public.calls c
      where c.started_at >= p_from and c.started_at < p_to
        and c.outcome not in ('missed', 'failed'))::integer,
    (select count(*) from public.calls c
      where c.started_at >= p_from and c.started_at < p_to
        and c.outcome = 'booked')::integer,
    (select count(*) from public.calls c
      where c.started_at >= p_from and c.started_at < p_to
        and c.outcome in ('missed', 'failed'))::integer,
    (select count(*) from public.tasks t
      where t.status = 'done'
        and t.finished_at >= p_from and t.finished_at < p_to)::integer;
$$;

-- One row per shop with today's counters and its next appointment
-- (the earliest one from now on that is still booked or confirmed).
create function public.get_shop_summaries(p_from timestamptz, p_to timestamptz)
returns table (
  id                  uuid,
  name                text,
  phone               text,
  address             text,
  timezone            text,
  status              text,
  created_at          timestamptz,
  calls_today         integer,
  bookings_today      integer,
  missed_today        integer,
  next_appointment_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    s.id, s.name, s.phone, s.address, s.timezone, s.status, s.created_at,
    coalesce(c.calls_today, 0)::integer,
    coalesce(c.bookings_today, 0)::integer,
    coalesce(c.missed_today, 0)::integer,
    a.next_appointment_at
  from public.shops s
  left join lateral (
    select
      count(*) as calls_today,
      count(*) filter (where k.outcome = 'booked') as bookings_today,
      count(*) filter (where k.outcome in ('missed', 'failed')) as missed_today
    from public.calls k
    where k.shop_id = s.id and k.started_at >= p_from and k.started_at < p_to
  ) c on true
  left join lateral (
    select min(p.starts_at) as next_appointment_at
    from public.appointments p
    where p.shop_id = s.id
      and p.starts_at >= now()
      and p.status in ('booked', 'confirmed')
  ) a on true
  order by s.name, s.id;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 9. Reading a webhook payload safely
-- ════════════════════════════════════════════════════════════════════════
-- Small helpers that pull one field out of an event's "data" and explain, in
-- words the sender can act on, what is wrong with it. All errors raised on
-- purpose in sections 9 to 12 use one of three SQLSTATE codes:
--   JV400  the input is not acceptable
--   JV404  the thing it points at does not exist
--   JV409  too late (already finished / already decided)

-- Refuses field names the event does not have, so typos surface early.
create function jarvis.check_fields(p_type text, p_data jsonb, p_allowed text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_unknown text;
begin
  select k into v_unknown
  from jsonb_object_keys(p_data) as k
  where k <> all (p_allowed)
  order by k
  limit 1;

  if v_unknown is not null then
    raise exception using
      errcode = 'JV400',
      message = format('Unknown field "%s" in %s. Allowed fields: %s.',
                       v_unknown, p_type, array_to_string(p_allowed, ', '));
  end if;
end;
$$;

-- A text field, trimmed. Missing, null or empty gives null (or an error when
-- the field is required).
create function jarvis.text_field(p_data jsonb, p_key text, p_required boolean, p_max integer default 2000)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_data -> p_key;
  v_text  text;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    if p_required then
      raise exception using errcode = 'JV400', message = format('"%s" is required.', p_key);
    end if;
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'string' then
    raise exception using errcode = 'JV400', message = format('"%s" must be text.', p_key);
  end if;

  v_text := btrim(v_value #>> '{}', E' \t\n\r');
  if v_text = '' then
    if p_required then
      raise exception using errcode = 'JV400', message = format('"%s" cannot be empty.', p_key);
    end if;
    return null;
  end if;
  if char_length(v_text) > p_max then
    raise exception using
      errcode = 'JV400',
      message = format('"%s" is too long: %s characters, and the limit is %s.', p_key, char_length(v_text), p_max);
  end if;
  return v_text;
end;
$$;

-- A field that must be one of a fixed set of words.
create function jarvis.choice_field(p_data jsonb, p_key text, p_choices text[], p_required boolean)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := jarvis.text_field(p_data, p_key, p_required, 100);
begin
  if v_text is not null and v_text <> all (p_choices) then
    raise exception using
      errcode = 'JV400',
      message = format('"%s" is not a valid %s. Use one of: %s.', v_text, p_key, array_to_string(p_choices, ', '));
  end if;
  return v_text;
end;
$$;

-- A whole number within a range. Missing or null gives null.
create function jarvis.int_field(p_data jsonb, p_key text, p_min integer, p_max integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value  jsonb := p_data -> p_key;
  v_number numeric;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'number' then
    raise exception using errcode = 'JV400', message = format('"%s" must be a number.', p_key);
  end if;
  v_number := (v_value #>> '{}')::numeric;
  if v_number <> trunc(v_number) or v_number < p_min or v_number > p_max then
    raise exception using
      errcode = 'JV400',
      message = format('"%s" must be a whole number from %s to %s.', p_key, p_min, p_max);
  end if;
  return v_number::integer;
end;
$$;

-- An ISO-8601 timestamp. The timezone must be written out (Z or +hh:mm) so a
-- time can never be read in the wrong zone.
create function jarvis.time_field(p_data jsonb, p_key text, p_required boolean)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_text text := jarvis.text_field(p_data, p_key, p_required, 64);
begin
  if v_text is null then
    return null;
  end if;
  if v_text ~ '^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?([Zz]|[+-]\d{2}(:?\d{2})?)$' then
    begin
      return v_text::timestamptz;
    exception when others then
      null;  -- right shape, impossible date: fall through to the message below
    end;
  end if;
  raise exception using
    errcode = 'JV400',
    message = format('"%s" must be an ISO-8601 time with its timezone, like 2026-11-19T15:04:05Z.', p_key);
end;
$$;

-- One of our own ids. Missing or null gives null.
create function jarvis.uuid_field(p_data jsonb, p_key text, p_required boolean default false)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text := jarvis.text_field(p_data, p_key, p_required, 64);
begin
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception using errcode = 'JV400', message = format('"%s" is not a valid id.', p_key);
  end if;
  return v_text::uuid;
end;
$$;

-- A call transcript: an array of { role: agent | caller, text, t }.
-- Missing or null gives null.
create function jarvis.transcript_field(p_data jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_value jsonb := p_data -> 'transcript';
  v_bad   bigint;
begin
  if v_value is null or jsonb_typeof(v_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(v_value) <> 'array' then
    raise exception using errcode = 'JV400', message = '"transcript" must be a list of turns.';
  end if;

  select min(turn.position) into v_bad
  from jsonb_array_elements(v_value) with ordinality as turn (item, position)
  where jsonb_typeof(turn.item) is distinct from 'object'
     or coalesce(turn.item ->> 'role', '') not in ('agent', 'caller')
     or jsonb_typeof(turn.item -> 'text') is distinct from 'string'
     or jsonb_typeof(turn.item -> 't') is distinct from 'number'
     or (turn.item ->> 't')::numeric < 0
     or turn.item - array['role', 'text', 't'] <> '{}'::jsonb;

  if v_bad is not null then
    raise exception using
      errcode = 'JV400',
      message = format(
        'Turn %s of "transcript" is not valid. Each turn is { "role": "agent" or "caller", "text": "...", "t": seconds from the start }.',
        v_bad);
  end if;
  return v_value;
end;
$$;

-- Finds the row an event points at. Every reference comes in two styles: our
-- id ("shop_id", "task_id", "call_id") or the sender's own ("shop_phone",
-- "task_external_id", "call_external_id"). Gives null when the event names
-- neither (or an error when one is required).
create function jarvis.find_ref(p_kind text, p_data jsonb, p_required boolean)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_id_key   text := p_kind || '_id';
  v_own_key  text := case p_kind when 'shop' then 'shop_phone' else p_kind || '_external_id' end;
  v_own_noun text := case p_kind when 'shop' then 'phone number' else 'external id' end;
  v_id       uuid := jarvis.uuid_field(p_data, v_id_key);
  v_own      text := jarvis.text_field(p_data, v_own_key, false, 200);
  v_found    uuid;
begin
  if v_id is not null then
    case p_kind
      when 'shop' then select s.id into v_found from public.shops s where s.id = v_id;
      when 'task' then select t.id into v_found from public.tasks t where t.id = v_id;
      when 'call' then select c.id into v_found from public.calls c where c.id = v_id;
    end case;
    if v_found is null then
      raise exception using errcode = 'JV404', message = format('No %s with that id.', p_kind);
    end if;
  end if;

  if v_own is not null then
    v_found := null;
    case p_kind
      when 'shop' then select s.id into v_found from public.shops s where s.phone = v_own;
      when 'task' then select t.id into v_found from public.tasks t where t.external_id = v_own;
      when 'call' then select c.id into v_found from public.calls c where c.external_id = v_own;
    end case;
    if v_found is null then
      raise exception using
        errcode = 'JV404',
        message = format('No %s with that %s.', p_kind, v_own_noun)
                  || case p_kind when 'shop' then ' Send shop.upsert first.' else '' end;
    end if;
    if v_id is not null and v_id <> v_found then
      raise exception using
        errcode = 'JV400',
        message = format('"%s" and "%s" point at different %ss. Send only one of them.', v_id_key, v_own_key, p_kind);
    end if;
    v_id := v_found;
  end if;

  if v_id is null and p_required then
    raise exception using
      errcode = 'JV400',
      message = format('Say which %s this is for: send "%s" or "%s".', p_kind, v_id_key, v_own_key);
  end if;
  return v_id;
end;
$$;

-- Turns a database error into a sentence for the sender. Our own errors (JV…)
-- already are one. The rest should not happen, because every field is checked
-- before it is written; if one does, name the problem without table jargon.
create function jarvis.explain_error(p_state text, p_message text, p_constraint text, p_column text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_state like 'JV%' then p_message
    when p_state = '23505' and p_constraint = 'tasks_external_id_key' then 'Another task already uses that external id.'
    when p_state = '23505' then 'That would create a duplicate of something that must be unique.'
    when p_state = '23503' then 'It points at something that no longer exists.'
    when p_state = '23502' then format('"%s" is required.', coalesce(nullif(p_column, ''), 'A field'))
    when p_state = '23514' then 'One of the values is outside what is allowed for this event.'
    when p_state like '22%' then 'One of the values has the wrong format: ' || p_message
    else 'This event could not be applied: ' || p_message
  end;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 10. Alert routing
-- ════════════════════════════════════════════════════════════════════════

-- True when p_now falls inside the quiet-hours window. Both times are "HH:MM"
-- on the wall clock of p_timezone. The window may run overnight (22:00 to
-- 07:00). The start is included, the end is not. Equal times mean "never".
create function jarvis.in_quiet_hours(p_now timestamptz, p_timezone text, p_start text, p_end text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local time;
  v_start time := p_start::time;
  v_end   time := p_end::time;
begin
  begin
    v_local := (p_now at time zone p_timezone)::time;
  exception when others then
    v_local := (p_now at time zone 'UTC')::time;  -- unknown zone: fall back rather than lose the alert
  end;

  if v_start = v_end then
    return false;
  elsif v_start < v_end then
    return v_local >= v_start and v_local < v_end;
  else
    return v_local >= v_start or v_local < v_end;
  end if;
end;
$$;

-- Where an alert of this type should go right now:
--   { "channel": call | text | in_app, "phone": the owner's number or null, "quiet_hours": true | false }
-- The owner's preference for the type decides the channel. During quiet hours
-- a call or text becomes in_app. Without a phone number on file a call or
-- text cannot happen, so it becomes in_app as well.
create function jarvis.route_alert(p_type text, p_now timestamptz default now())
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_settings public.settings;
  v_channel  text;
  v_quiet    boolean;
begin
  select * into v_settings from public.settings limit 1;
  if not found then
    return jsonb_build_object('channel', 'in_app', 'phone', null, 'quiet_hours', false);
  end if;

  v_channel := coalesce(v_settings.notification_prefs ->> p_type, 'in_app');
  if v_channel not in ('call', 'text', 'in_app') then
    v_channel := 'in_app';
  end if;

  v_quiet := v_settings.quiet_hours_enabled
             and jarvis.in_quiet_hours(p_now, v_settings.timezone,
                                       v_settings.quiet_hours_start, v_settings.quiet_hours_end);

  if v_channel <> 'in_app' and (v_quiet or v_settings.notify_phone is null) then
    v_channel := 'in_app';
  end if;

  return jsonb_build_object('channel', v_channel, 'phone', v_settings.notify_phone, 'quiet_hours', v_quiet);
end;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 11. Internal functions for jarvis-command (service role only)
-- ════════════════════════════════════════════════════════════════════════
-- Each one is a single atomic change. They run with the CALLER's permissions
-- (SECURITY INVOKER): only the service role can write these tables, so even a
-- mistaken grant to another role would not let it change anything.

-- A short title from the first line of the instructions: at most 72
-- characters, cut at a word boundary, with an ellipsis when cut. Kept in step
-- with titleFromInstructions() in src/lib/format.ts.
create function jarvis.task_title(p_instructions text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_line  text := btrim(split_part(btrim(coalesce(p_instructions, ''), E' \t\n\r'), E'\n', 1), E' \t\r');
  v_cut   text;
  v_space integer;
begin
  if v_line = '' then
    return 'Untitled task';
  end if;
  if char_length(v_line) <= 72 then
    return v_line;
  end if;

  v_cut := left(v_line, 72);
  v_space := 72 - position(' ' in reverse(v_cut));  -- characters before the last space (72 when there is none)
  if v_space < 72 and v_space > 43 then            -- only cut at a space in the last 40% of the line
    v_cut := left(v_cut, v_space);
  end if;
  return rtrim(v_cut, E' \t') || '…';
end;
$$;

-- Creates a queued task after checking the repo and the instructions.
create function public.jarvis_create_task(p_repo text, p_instructions text)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_repo         text := btrim(coalesce(p_repo, ''));
  v_instructions text := btrim(coalesce(p_instructions, ''), E' \t\n\r');
  v_task         public.tasks;
begin
  if v_repo = '' then
    raise exception using errcode = 'JV400', message = 'Choose a repo for this task.';
  end if;
  if not exists (select 1 from public.settings s where v_repo = any (s.allowed_repos)) then
    raise exception using
      errcode = 'JV400',
      message = format('%s is not on your list of allowed repos. Add it in Settings first.', v_repo);
  end if;
  if v_instructions = '' then
    raise exception using errcode = 'JV400', message = 'Tell Jarvis what to do: the instructions are empty.';
  end if;
  if char_length(v_instructions) > 8000 then
    raise exception using
      errcode = 'JV400',
      message = format('Those instructions are %s characters long. The limit is 8000.', char_length(v_instructions));
  end if;

  insert into public.tasks (repo, instructions, title, status)
  values (v_repo, v_instructions, jarvis.task_title(v_instructions), 'queued')
  returning * into v_task;

  insert into public.task_events (task_id, kind, message) values (v_task.id, 'status', 'Queued');
  return v_task;
end;
$$;

-- Records what happened when the task was handed to the Jarvis backend.
--   accepted        keep the backend's id for the task (if it gave one)
--   not_configured  no backend yet: the task waits in the queue
--   rejected        the backend refused: the task fails with the reason
-- A task that already finished keeps its status; the line is still logged.
create function public.jarvis_record_dispatch(
  p_task_id     uuid,
  p_outcome     text,
  p_external_id text default null,
  p_detail      text default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task        public.tasks;
  v_external_id text := nullif(btrim(coalesce(p_external_id, '')), '');
  v_detail      text := coalesce(nullif(btrim(coalesce(p_detail, '')), ''), 'The Jarvis backend did not accept this task.');
begin
  if p_outcome is null or p_outcome not in ('accepted', 'not_configured', 'rejected') then
    raise exception using
      errcode = 'JV400',
      message = 'The dispatch outcome must be accepted, not_configured or rejected.';
  end if;

  select * into v_task from public.tasks t where t.id = p_task_id for update;
  if not found then
    raise exception using errcode = 'JV404', message = 'That task no longer exists.';
  end if;

  if p_outcome = 'accepted' then
    if v_external_id is not null then
      begin
        update public.tasks t set external_id = v_external_id where t.id = p_task_id returning * into v_task;
      exception when unique_violation then
        raise exception using
          errcode = 'JV400',
          message = 'The Jarvis backend returned an id that another task already uses.';
      end;
    end if;
    insert into public.task_events (task_id, kind, message) values (p_task_id, 'log', 'Sent to Jarvis.');

  elsif p_outcome = 'not_configured' then
    insert into public.task_events (task_id, kind, message)
    values (p_task_id, 'log', 'Jarvis backend isn''t connected yet. This task will wait in the queue.');

  else
    if v_task.status not in ('done', 'failed', 'cancelled') then
      update public.tasks t
      set status = 'failed', error = v_detail, finished_at = now()
      where t.id = p_task_id
      returning * into v_task;
    end if;
    insert into public.task_events (task_id, kind, message) values (p_task_id, 'error', v_detail);
  end if;

  return v_task;
end;
$$;

-- Cancels a task that is still in flight and expires its open approvals.
create function public.jarvis_cancel_task(p_task_id uuid)
returns public.tasks
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks t where t.id = p_task_id for update;
  if not found then
    raise exception using errcode = 'JV404', message = 'That task no longer exists.';
  end if;
  if v_task.status not in ('queued', 'running', 'needs_approval') then
    raise exception using
      errcode = 'JV409',
      message = case v_task.status
                  when 'done' then 'This task is already done, so there is nothing to cancel.'
                  when 'failed' then 'This task already failed, so there is nothing to cancel.'
                  else 'This task was already cancelled.'
                end;
  end if;

  update public.tasks t
  set status = 'cancelled', finished_at = now()
  where t.id = p_task_id
  returning * into v_task;

  update public.approvals a set status = 'expired' where a.task_id = p_task_id and a.status = 'pending';

  insert into public.task_events (task_id, kind, message) values (p_task_id, 'status', 'Cancelled by you');
  return v_task;
end;
$$;

-- Records the owner's answer to a pending approval.
-- If its task is waiting on approval:
--   approved  the task goes back to running, unless it is still waiting on
--             another approval
--   denied    the task is cancelled and its other open approvals expire
-- Whether a request is too old to answer is the backend's call: the edge
-- function tells the backend first, and the backend expires requests with the
-- approval.expire event. Here only the status counts.
create function public.jarvis_decide_approval(p_approval_id uuid, p_decision text)
returns public.approvals
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_approval    public.approvals;
  v_task_id     uuid;
  v_task_status text;
begin
  if p_decision is null or p_decision not in ('approved', 'denied') then
    raise exception using errcode = 'JV400', message = 'A decision must be "approved" or "denied".';
  end if;

  -- Lock the task before the approval, the same order jarvis_cancel_task
  -- uses, so the two can never wait on each other.
  select a.task_id into v_task_id from public.approvals a where a.id = p_approval_id;
  if not found then
    raise exception using errcode = 'JV404', message = 'That approval no longer exists.';
  end if;
  if v_task_id is not null then
    select t.status into v_task_status from public.tasks t where t.id = v_task_id for update;
  end if;

  select * into v_approval from public.approvals a where a.id = p_approval_id for update;
  if not found then
    raise exception using errcode = 'JV404', message = 'That approval no longer exists.';
  end if;
  if v_approval.status <> 'pending' then
    raise exception using
      errcode = 'JV409',
      message = case v_approval.status
                  when 'approved' then 'This was already approved.'
                  when 'denied' then 'This was already denied.'
                  else 'This request has expired.'
                end;
  end if;

  update public.approvals a
  set status = p_decision, decided_at = now()
  where a.id = p_approval_id
  returning * into v_approval;

  if v_task_id is not null and v_task_status = 'needs_approval' then
    if p_decision = 'approved' then
      if not exists (select 1 from public.approvals a where a.task_id = v_task_id and a.status = 'pending') then
        update public.tasks t
        set status = 'running', started_at = coalesce(t.started_at, now())
        where t.id = v_task_id;
      end if;
      insert into public.task_events (task_id, kind, message) values (v_task_id, 'status', 'Approved by you');
    else
      update public.tasks t set status = 'cancelled', finished_at = now() where t.id = v_task_id;
      update public.approvals a set status = 'expired' where a.task_id = v_task_id and a.status = 'pending';
      insert into public.task_events (task_id, kind, message) values (v_task_id, 'status', 'Denied by you');
    end if;
  end if;

  return v_approval;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 12. The webhook
-- ════════════════════════════════════════════════════════════════════════
-- One function per event type. Each takes the event's "data", checks every
-- field, writes, and returns { "id": … } (plus "notify" for alert.create).
--
-- Updating a row that already exists follows one rule everywhere:
--   field left out   keep what is stored
--   field sent       store it
--   field sent null  clear it, where the column can be empty; otherwise the
--                    same as leaving it out

-- shop.upsert: creates the shop or updates the one with that phone.
create function jarvis.event_shop_upsert(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_name     text;
  v_phone    text;
  v_address  text;
  v_timezone text;
  v_status   text;
  v_id       uuid;
begin
  perform jarvis.check_fields('shop.upsert', d, array['name', 'phone', 'address', 'timezone', 'status']);
  v_name     := jarvis.text_field(d, 'name', true, 200);
  v_phone    := jarvis.text_field(d, 'phone', true, 32);
  v_address  := jarvis.text_field(d, 'address', false, 500);
  v_timezone := jarvis.text_field(d, 'timezone', false, 64);
  v_status   := jarvis.choice_field(d, 'status', array['active', 'paused'], false);

  if v_phone !~ '^\+[1-9][0-9]{6,14}$' then
    raise exception using
      errcode = 'JV400',
      message = '"phone" must be the full number with country code and digits only, like +15125550142.';
  end if;

  insert into public.shops as s (name, phone, address, timezone, status)
  values (v_name, v_phone, coalesce(v_address, ''), coalesce(v_timezone, 'UTC'), coalesce(v_status, 'active'))
  on conflict (phone) do update set
    name     = excluded.name,
    address  = case when jsonb_typeof(d -> 'address') = 'string' then excluded.address else s.address end,
    timezone = case when v_timezone is not null then excluded.timezone else s.timezone end,
    status   = case when v_status is not null then excluded.status else s.status end
  returning s.id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- call.upsert: creates the call or updates the one with that external_id.
create function jarvis.event_call_upsert(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_external_id text;
  v_shop_id     uuid;
  v_caller_phone text;
  v_caller_name text;
  v_started_at  timestamptz;
  v_duration    integer;
  v_outcome     text;
  v_summary     text;
  v_transcript  jsonb;
  v_id          uuid;
begin
  perform jarvis.check_fields('call.upsert', d, array[
    'external_id', 'shop_id', 'shop_phone', 'caller_phone', 'caller_name', 'started_at',
    'duration_seconds', 'outcome', 'summary', 'transcript']);
  v_external_id  := jarvis.text_field(d, 'external_id', true, 200);
  v_shop_id      := jarvis.find_ref('shop', d, true);
  v_caller_phone := jarvis.text_field(d, 'caller_phone', true, 64);
  v_caller_name  := jarvis.text_field(d, 'caller_name', false, 200);
  v_started_at   := jarvis.time_field(d, 'started_at', true);
  v_duration     := jarvis.int_field(d, 'duration_seconds', 0, 86400);
  v_outcome      := jarvis.choice_field(d, 'outcome',
                      array['booked', 'answered', 'message', 'transferred', 'missed', 'failed'], true);
  v_summary      := jarvis.text_field(d, 'summary', false, 10000);
  v_transcript   := jarvis.transcript_field(d);

  insert into public.calls as c (
    external_id, shop_id, caller_phone, caller_name, started_at, duration_seconds, outcome, summary, transcript)
  values (
    v_external_id, v_shop_id, v_caller_phone, v_caller_name, v_started_at,
    coalesce(v_duration, 0), v_outcome, v_summary, coalesce(v_transcript, '[]'::jsonb))
  on conflict (external_id) do update set
    shop_id          = excluded.shop_id,
    caller_phone     = excluded.caller_phone,
    caller_name      = case when d ? 'caller_name' then excluded.caller_name else c.caller_name end,
    started_at       = excluded.started_at,
    duration_seconds = case when v_duration is not null then excluded.duration_seconds else c.duration_seconds end,
    outcome          = excluded.outcome,
    summary          = case when d ? 'summary' then excluded.summary else c.summary end,
    transcript       = case when v_transcript is not null then excluded.transcript else c.transcript end
  returning c.id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- appointment.upsert: creates the appointment or updates the one with that external_id.
create function jarvis.event_appointment_upsert(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_external_id    text;
  v_shop_id        uuid;
  v_call_id        uuid;
  v_customer_name  text;
  v_customer_phone text;
  v_service        text;
  v_barber         text;
  v_starts_at      timestamptz;
  v_duration       integer;
  v_status         text;
  v_source         text;
  v_notes          text;
  v_id             uuid;
begin
  perform jarvis.check_fields('appointment.upsert', d, array[
    'external_id', 'shop_id', 'shop_phone', 'customer_name', 'customer_phone', 'service', 'barber',
    'starts_at', 'duration_minutes', 'status', 'source', 'notes', 'call_id', 'call_external_id']);
  v_external_id    := jarvis.text_field(d, 'external_id', true, 200);
  v_shop_id        := jarvis.find_ref('shop', d, true);
  v_call_id        := jarvis.find_ref('call', d, false);
  v_customer_name  := jarvis.text_field(d, 'customer_name', true, 200);
  v_customer_phone := jarvis.text_field(d, 'customer_phone', false, 64);
  v_service        := jarvis.text_field(d, 'service', true, 200);
  v_barber         := jarvis.text_field(d, 'barber', false, 200);
  v_starts_at      := jarvis.time_field(d, 'starts_at', true);
  v_duration       := jarvis.int_field(d, 'duration_minutes', 1, 1440);
  v_status         := jarvis.choice_field(d, 'status',
                        array['booked', 'confirmed', 'completed', 'cancelled', 'no_show'], false);
  v_source         := jarvis.choice_field(d, 'source', array['jarvis', 'online', 'walk_in'], false);
  v_notes          := jarvis.text_field(d, 'notes', false, 10000);

  insert into public.appointments as a (
    external_id, shop_id, call_id, customer_name, customer_phone, service, barber,
    starts_at, duration_minutes, status, source, notes)
  values (
    v_external_id, v_shop_id, v_call_id, v_customer_name, v_customer_phone, v_service, v_barber,
    v_starts_at, coalesce(v_duration, 30), coalesce(v_status, 'booked'), coalesce(v_source, 'jarvis'), v_notes)
  on conflict (external_id) do update set
    shop_id          = excluded.shop_id,
    call_id          = case when d ?| array['call_id', 'call_external_id'] then excluded.call_id else a.call_id end,
    customer_name    = excluded.customer_name,
    customer_phone   = case when d ? 'customer_phone' then excluded.customer_phone else a.customer_phone end,
    service          = excluded.service,
    barber           = case when d ? 'barber' then excluded.barber else a.barber end,
    starts_at        = excluded.starts_at,
    duration_minutes = case when v_duration is not null then excluded.duration_minutes else a.duration_minutes end,
    status           = case when v_status is not null then excluded.status else a.status end,
    source           = case when v_source is not null then excluded.source else a.source end,
    notes            = case when d ? 'notes' then excluded.notes else a.notes end
  returning a.id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- task.update: changes a task. started_at is stamped the first time it is
-- running; finished_at when it reaches done, failed or cancelled. A task that
-- is already done, failed or cancelled keeps its status (other fields, such
-- as a late result summary, are still stored).
create function jarvis.event_task_update(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_changes     constant text[] := array['status', 'external_id', 'title', 'branch', 'result_summary', 'pr_url', 'error'];
  v_task_id     uuid;
  v_task        public.tasks;
  v_status      text;
  v_external_id text;
  v_title       text;
  v_branch      text;
  v_summary     text;
  v_pr_url      text;
  v_error       text;
  v_finished    boolean;
begin
  perform jarvis.check_fields('task.update', d, array['task_id', 'task_external_id'] || v_changes);
  v_task_id := jarvis.find_ref('task', d, true);
  if not d ?| v_changes then
    raise exception using
      errcode = 'JV400',
      message = 'task.update needs at least one field to change: ' || array_to_string(v_changes, ', ') || '.';
  end if;
  v_status := jarvis.choice_field(d, 'status',
                array['queued', 'running', 'needs_approval', 'done', 'failed', 'cancelled'], false);
  v_external_id := jarvis.text_field(d, 'external_id', false, 200);
  v_title       := jarvis.text_field(d, 'title', false, 300);
  v_branch      := jarvis.text_field(d, 'branch', false, 255);
  v_summary     := jarvis.text_field(d, 'result_summary', false, 20000);
  v_pr_url      := jarvis.text_field(d, 'pr_url', false, 2000);
  v_error       := jarvis.text_field(d, 'error', false, 10000);

  select * into v_task from public.tasks t where t.id = v_task_id for update;
  v_finished := v_task.status in ('done', 'failed', 'cancelled');
  if v_status is null or v_finished then
    v_status := v_task.status;
  end if;

  update public.tasks t set
    status         = v_status,
    external_id    = case when d ? 'external_id' then v_external_id else t.external_id end,
    title          = coalesce(v_title, t.title),
    branch         = case when d ? 'branch' then v_branch else t.branch end,
    result_summary = case when d ? 'result_summary' then v_summary else t.result_summary end,
    pr_url         = case when d ? 'pr_url' then v_pr_url else t.pr_url end,
    error          = case when d ? 'error' then v_error else t.error end,
    started_at     = case when v_status = 'running' and t.started_at is null then now() else t.started_at end,
    finished_at    = case when v_status in ('done', 'failed', 'cancelled') and not v_finished
                          then now() else t.finished_at end
  where t.id = v_task_id;

  return jsonb_build_object('id', v_task_id);
end;
$$;

-- task.event: appends a line to a task's progress log.
create function jarvis.event_task_event(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_task_id    uuid;
  v_kind       text;
  v_message    text;
  v_created_at timestamptz;
  v_id         uuid;
begin
  perform jarvis.check_fields('task.event', d, array['task_id', 'task_external_id', 'kind', 'message', 'created_at']);
  v_task_id    := jarvis.find_ref('task', d, true);
  v_kind       := jarvis.choice_field(d, 'kind', array['status', 'log', 'command', 'error'], true);
  v_message    := jarvis.text_field(d, 'message', true, 20000);
  v_created_at := jarvis.time_field(d, 'created_at', false);

  insert into public.task_events (task_id, kind, message, created_at)
  values (v_task_id, v_kind, v_message, coalesce(v_created_at, clock_timestamp()))
  returning id into v_id;

  return jsonb_build_object('id', v_id);
end;
$$;

-- approval.request: creates a pending approval. A queued or running task it
-- points at starts waiting on it.
create function jarvis.event_approval_request(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_kind       text;
  v_title      text;
  v_detail     text;
  v_task_id    uuid;
  v_shop_id    uuid;
  v_expires_at timestamptz;
  v_id         uuid;
begin
  perform jarvis.check_fields('approval.request', d, array[
    'kind', 'title', 'detail', 'task_id', 'task_external_id', 'shop_id', 'shop_phone', 'expires_at']);
  v_kind       := jarvis.choice_field(d, 'kind', array['code', 'receptionist', 'spend', 'other'], true);
  v_title      := jarvis.text_field(d, 'title', true, 300);
  v_detail     := jarvis.text_field(d, 'detail', false, 10000);
  v_task_id    := jarvis.find_ref('task', d, false);
  v_shop_id    := jarvis.find_ref('shop', d, false);
  v_expires_at := jarvis.time_field(d, 'expires_at', false);

  insert into public.approvals (kind, title, detail, task_id, shop_id, expires_at)
  values (v_kind, v_title, v_detail, v_task_id, v_shop_id, v_expires_at)
  returning id into v_id;

  if v_task_id is not null then
    update public.tasks t set status = 'needs_approval'
    where t.id = v_task_id and t.status in ('queued', 'running');
  end if;

  return jsonb_build_object('id', v_id);
end;
$$;

-- approval.expire: marks a pending approval expired. Sending it again for an
-- approval that already expired is fine; one that was answered stays answered.
create function jarvis.event_approval_expire(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_id     uuid;
  v_status text;
begin
  perform jarvis.check_fields('approval.expire', d, array['id']);
  v_id := jarvis.uuid_field(d, 'id', true);

  select a.status into v_status from public.approvals a where a.id = v_id for update;
  if not found then
    raise exception using errcode = 'JV404', message = 'No approval with that id.';
  end if;
  if v_status in ('approved', 'denied') then
    raise exception using
      errcode = 'JV409',
      message = format('That approval was already %s, so it cannot expire.', v_status);
  end if;

  update public.approvals a set status = 'expired' where a.id = v_id and a.status = 'pending';
  return jsonb_build_object('id', v_id);
end;
$$;

-- alert.create: stores an alert and says how the owner wants to hear about it.
create function jarvis.event_alert_create(d jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_type        text;
  v_title       text;
  v_body        text;
  v_shop_id     uuid;
  v_call_id     uuid;
  v_task_id     uuid;
  v_approval_id uuid;
  v_notify      jsonb;
  v_id          uuid;
begin
  perform jarvis.check_fields('alert.create', d, array[
    'type', 'title', 'body', 'shop_id', 'shop_phone', 'call_id', 'call_external_id',
    'task_id', 'task_external_id', 'approval_id']);
  v_type := jarvis.choice_field(d, 'type',
              array['missed_call', 'failed_call', 'approval_needed', 'task_done', 'task_failed', 'system'], true);
  v_title       := jarvis.text_field(d, 'title', true, 300);
  v_body        := jarvis.text_field(d, 'body', false, 10000);
  v_shop_id     := jarvis.find_ref('shop', d, false);
  v_call_id     := jarvis.find_ref('call', d, false);
  v_task_id     := jarvis.find_ref('task', d, false);
  v_approval_id := jarvis.uuid_field(d, 'approval_id');

  if v_approval_id is not null
     and not exists (select 1 from public.approvals a where a.id = v_approval_id) then
    raise exception using errcode = 'JV404', message = 'No approval with that id.';
  end if;
  -- An alert about a call belongs to that call's shop unless the sender says otherwise.
  if v_shop_id is null and v_call_id is not null then
    select c.shop_id into v_shop_id from public.calls c where c.id = v_call_id;
  end if;

  v_notify := jarvis.route_alert(v_type);

  insert into public.alerts (type, title, body, shop_id, call_id, task_id, approval_id, channel)
  values (v_type, v_title, v_body, v_shop_id, v_call_id, v_task_id, v_approval_id, v_notify ->> 'channel')
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'notify', v_notify);
end;
$$;

-- The webhook's entry point. Applies the events in order and returns one
-- result per event:
--   { "index": 0, "type": "call.upsert", "ok": true,  "id": "…" }
--   { "index": 1, "type": "alert.create", "ok": true, "id": "…", "notify": { … } }
--   { "index": 2, "type": "task.update", "ok": false, "error": "No task with that id." }
-- Each event runs in its own BEGIN … EXCEPTION block (a sub-transaction), so
-- a bad event is undone on its own and the events around it still apply.
create function public.jarvis_apply_events(p_events jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_events     jsonb := p_events;
  v_results    jsonb := '[]'::jsonb;
  v_event      jsonb;
  v_index      integer;
  v_type       text;
  v_data       jsonb;
  v_applied    jsonb;
  v_state      text;
  v_message    text;
  v_constraint text;
  v_column     text;
begin
  -- A single { type, data } object is treated as a list of one.
  if jsonb_typeof(v_events) = 'object' then
    v_events := jsonb_build_array(v_events);
  end if;
  if v_events is null or jsonb_typeof(v_events) <> 'array' then
    raise exception using errcode = 'JV400', message = 'Send a list of events: [{ "type": "…", "data": { … } }].';
  end if;
  if jsonb_array_length(v_events) > 100 then
    raise exception using
      errcode = 'JV400',
      message = format('That is %s events. Send at most 100 per request.', jsonb_array_length(v_events));
  end if;

  for v_event, v_index in
    select e.item, (e.position - 1)::integer
    from jsonb_array_elements(v_events) with ordinality as e (item, position)
    order by e.position
  loop
    v_type := case
                when jsonb_typeof(v_event) = 'object' and jsonb_typeof(v_event -> 'type') = 'string'
                then v_event ->> 'type'
              end;
    begin
      if jsonb_typeof(v_event) <> 'object' then
        raise exception using errcode = 'JV400', message = 'Each event must be an object: { "type": "…", "data": { … } }.';
      end if;
      if v_type is null then
        raise exception using errcode = 'JV400', message = 'This event has no "type".';
      end if;
      perform jarvis.check_fields('the event', v_event, array['type', 'data']);
      v_data := v_event -> 'data';
      if v_data is null or jsonb_typeof(v_data) <> 'object' then
        raise exception using errcode = 'JV400', message = '"data" must be an object.';
      end if;

      v_applied := case v_type
        when 'shop.upsert'        then jarvis.event_shop_upsert(v_data)
        when 'call.upsert'        then jarvis.event_call_upsert(v_data)
        when 'appointment.upsert' then jarvis.event_appointment_upsert(v_data)
        when 'task.update'        then jarvis.event_task_update(v_data)
        when 'task.event'         then jarvis.event_task_event(v_data)
        when 'approval.request'   then jarvis.event_approval_request(v_data)
        when 'approval.expire'    then jarvis.event_approval_expire(v_data)
        when 'alert.create'       then jarvis.event_alert_create(v_data)
      end;
      if v_applied is null then
        raise exception using errcode = 'JV400', message = format('Unknown event type "%s".', v_type);
      end if;

      v_results := v_results || jsonb_build_array(
        jsonb_build_object('index', v_index, 'type', v_type, 'ok', true) || v_applied);
    exception when others then
      get stacked diagnostics
        v_state      = returned_sqlstate,
        v_message    = message_text,
        v_constraint = constraint_name,
        v_column     = column_name;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'index', v_index,
        'type',  v_type,
        'ok',    false,
        'error', jarvis.explain_error(v_state, v_message, v_constraint, v_column)));
    end;
  end loop;

  return v_results;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════
-- 13. Who may run the functions
-- ════════════════════════════════════════════════════════════════════════
-- Postgres lets everybody run a new function unless told otherwise, so every
-- function is closed first and then opened to exactly one role.

revoke all on all functions in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema jarvis  from public, anon, authenticated, service_role;
revoke all on all functions in schema public  from public, anon, authenticated, service_role;

-- The policy helper: signed-in sessions only (policies call it for them).
grant execute on function private.is_owner() to authenticated;

-- The app's two RPCs: signed-in sessions only (and only the owner sees data).
grant execute on function public.get_brief(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_shop_summaries(timestamptz, timestamptz) to authenticated;

-- Everything that writes on Jarvis's behalf: the service role only.
grant execute on function public.jarvis_create_task(text, text) to service_role;
grant execute on function public.jarvis_record_dispatch(uuid, text, text, text) to service_role;
grant execute on function public.jarvis_cancel_task(uuid) to service_role;
grant execute on function public.jarvis_decide_approval(uuid, text) to service_role;
grant execute on function public.jarvis_apply_events(jsonb) to service_role;
grant execute on all functions in schema jarvis to service_role;


-- ════════════════════════════════════════════════════════════════════════
-- 14. Realtime
-- ════════════════════════════════════════════════════════════════════════
-- The app listens for changes on these six tables. Realtime applies the same
-- policies as section 7, so only the owner's session receives anything.
-- REPLICA IDENTITY FULL makes update and delete events carry the previous row
-- (a delete still reaches the app as the id only, because the tables have
-- row-level security).
alter table public.tasks        replica identity full;
alter table public.task_events  replica identity full;
alter table public.approvals    replica identity full;
alter table public.alerts       replica identity full;
alter table public.calls        replica identity full;
alter table public.appointments replica identity full;

do $$
declare
  v_table text;
begin
  -- Every Supabase project has this publication; create it where it is missing.
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach v_table in array array['tasks', 'task_events', 'approvals', 'alerts', 'calls', 'appointments'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$$;
