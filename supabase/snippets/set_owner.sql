-- Who is the owner, and how to make another account the owner.
-- Run in the Supabase dashboard's SQL editor (it runs as an admin).
-- Only the owner can read anything in Jarvis; every other account sees nothing.

-- 1. See who the owner is now (empty when no account has been created yet).
select s.owner_id, u.email, u.created_at
from public.settings s
left join auth.users u on u.id = s.owner_id;

-- 2. Make an existing account the owner. The account must already exist:
--    create it under Authentication → Users → "Add user" first.
--    Replace the email, then run the whole block. It stops with an error and
--    changes nothing if no account has that email.
do $$
declare
  v_email text := 'you@example.com';  -- ← the new owner's email
  v_id    uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(v_email);
  if v_id is null then
    raise exception 'No account with the email %. Create it in Authentication → Users first.', v_email;
  end if;
  update public.settings set owner_id = v_id;
  raise notice 'The owner is now % (%).', v_email, v_id;
end;
$$;

-- The previous owner can now sign in but sees nothing. While an account is
-- the owner it cannot be deleted from Supabase Auth; after this change the
-- old account can be deleted.
