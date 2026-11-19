-- Accounts that already exist when the migration runs (an older project).
-- The anonymous one is the oldest, but anonymous accounts never count.
insert into auth.users (id, email, is_anonymous, created_at) values
  ('00000000-0000-4000-8000-0000000000a0', null,                true,  now() - interval '3 days'),
  ('00000000-0000-4000-8000-0000000000a1', 'first@example.com',  false, now() - interval '2 days'),
  ('00000000-0000-4000-8000-0000000000a2', 'second@example.com', false, now() - interval '1 day');
