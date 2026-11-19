-- Test helpers, loaded by run.sh after the migration and the seed.
-- Every check either passes (and is counted) or raises "FAIL: <what>", which
-- stops psql with a non-zero exit.
--
-- Acting as someone (all LOCAL: they end with the transaction):
--   select test.as_anon();            signed out
--   select test.as_user(<uuid>);      signed in as that account
--   select test.as_service();         an edge function using the service role
--   select test.as_admin();           back to the migration's own role
-- Checks:
--   test.ok(condition, label)
--   test.is(got, want, label)                      compares as text
--   test.throws(sql, sqlstate, label [, message])  message is a LIKE pattern
--   test.rows(sql) → how many rows a statement touched (or returned)
--   test.make_user(email [, anonymous]) → uuid    as Supabase Auth would

create schema test;
grant usage on schema test to public;

create function test.pass() returns void language plpgsql as $$
begin
  perform set_config('test.count', (coalesce(nullif(current_setting('test.count', true), ''), '0')::int + 1)::text, false);
end $$;

create function test.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_label;
  end if;
  perform test.pass();
end $$;

create function test.is(p_got anyelement, p_want anyelement, p_label text) returns void language plpgsql as $$
begin
  if p_got::text is distinct from p_want::text then
    raise exception 'FAIL: % (got %, want %)', p_label, coalesce(p_got::text, 'NULL'), coalesce(p_want::text, 'NULL');
  end if;
  perform test.pass();
end $$;

create function test.throws(p_sql text, p_state text, p_label text, p_message text default null)
returns void language plpgsql as $$
declare
  v_state text;
  v_msg   text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    if v_state is distinct from p_state then
      raise exception 'FAIL: % (wanted SQLSTATE %, got %: %)', p_label, p_state, v_state, v_msg;
    end if;
    if p_message is not null and v_msg not like p_message then
      raise exception 'FAIL: % (message "%" does not match "%")', p_label, v_msg, p_message;
    end if;
    perform test.pass();
    return;
  end;
  raise exception 'FAIL: % (no error, wanted SQLSTATE %)', p_label, p_state;
end $$;

create function test.rows(p_sql text) returns bigint language plpgsql as $$
declare
  v_n bigint;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create function test.as_admin() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create function test.as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
end $$;

create function test.as_user(p_id uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function test.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
end $$;

-- Creates an account the way Supabase Auth does: as supabase_auth_admin,
-- which has no rights in "public" (so the owner trigger must cope alone).
create function test.make_user(p_email text, p_anonymous boolean default false) returns uuid
language plpgsql as $$
declare
  v_id   uuid := gen_random_uuid();
  v_role text := current_setting('role');
begin
  perform set_config('role', 'supabase_auth_admin', true);
  insert into auth.users (id, email, is_anonymous, created_at) values (v_id, p_email, p_anonymous, clock_timestamp());
  perform set_config('role', v_role, true);
  return v_id;
end $$;

grant execute on all functions in schema test to public;
