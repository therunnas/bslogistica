begin;

select public.provision_bslog_user(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'first-admin@example.invalid',
  '{"full_name":"Primeiro Admin"}'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.profiles
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      and full_name = 'Primeiro Admin'
      and email = 'first-admin@example.invalid'
  ) then
    raise exception 'first user profile was not provisioned';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      and role = 'admin'
  ) then
    raise exception 'first user did not receive the bootstrap admin role';
  end if;
end
$$;

select public.provision_bslog_user(
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'second-user@example.invalid',
  '{"full_name":"Segundo Usuario"}'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.profiles
    where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
  ) then
    raise exception 'subsequent user profile was not provisioned';
  end if;

  if exists (
    select 1 from public.user_roles
    where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
  ) then
    raise exception 'subsequent user received a role without admin approval';
  end if;
end
$$;

rollback;
