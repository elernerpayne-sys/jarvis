-- A small stand-in for the parts of a Supabase database the migration relies
-- on, so the migration and the tests can run on a plain PostgreSQL server.
-- NOT for a real Supabase project (it already has all of this).
--
--   roles     anon, authenticated, service_role (as Supabase creates them),
--             authenticator, supabase_auth_admin (owns auth.users)
--   auth      auth.users, auth.uid(), auth.role(), auth.jwt() reading the
--             request.jwt.claims setting the way PostgREST sets it
--   grants    the schema usage and default privileges a new project has
--   realtime  the supabase_realtime publication (empty)
--
-- Roles belong to the whole server, so they are created only when missing.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit createrole;
  end if;
end;
$$;

grant anon, authenticated, service_role to authenticator;

-- auth: the users table (only the columns that matter here) and the claim helpers.
create schema if not exists auth authorization supabase_auth_admin;

create table if not exists auth.users (
  id           uuid primary key default gen_random_uuid(),
  email        text unique,
  is_anonymous boolean not null default false,
  created_at   timestamptz default now()
);
alter table auth.users owner to supabase_auth_admin;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

alter function auth.jwt() owner to supabase_auth_admin;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.role() owner to supabase_auth_admin;

grant usage on schema auth to anon, authenticated, service_role, postgres;
grant execute on all functions in schema auth to anon, authenticated, service_role, postgres;
grant all on auth.users to postgres, service_role;

-- What a new project grants in "public": usage to the API roles, and ALL on
-- every new table, sequence and function. The migration must undo this.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;

-- Realtime's publication exists, empty, on every project.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end;
$$;
