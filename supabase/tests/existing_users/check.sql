-- The migration made the earliest real account the owner; later ones never are.
select test.is((select owner_id from public.settings), '00000000-0000-4000-8000-0000000000a1'::uuid,
  'the earliest existing (non-anonymous) account became the owner');
select test.is((select count(*) from public.settings), 1::bigint, 'exactly one settings row');

select test.make_user('third@example.com');
select test.is((select owner_id from public.settings), '00000000-0000-4000-8000-0000000000a1'::uuid,
  'an account created later does not take over');

select test.as_user('00000000-0000-4000-8000-0000000000a1');
select test.is((select count(*) from public.settings), 1::bigint, 'the owner sees the settings row');
select test.as_user('00000000-0000-4000-8000-0000000000a2');
select test.is((select count(*) from public.settings), 0::bigint, 'the second account sees nothing');
select test.as_admin();
