begin;

select public.provision_bslog_user(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'first-user@example.invalid',
  '{"full_name":"Primeiro Usuario"}'::jsonb
);

do $$
begin
  if not exists (
    select 1 from public.profiles
    where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
      and full_name = 'Primeiro Usuario'
      and email = 'first-user@example.invalid'
  ) then
    raise exception 'first user profile was not provisioned';
  end if;

  if exists (
    select 1 from public.user_roles
    where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid
  ) then
    raise exception 'first user received a role without explicit admin assignment';
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

  if (select count(*) from public.user_roles
      where user_id in (
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid
      )) <> 0 then
    raise exception 'onboarding assigned a role automatically';
  end if;
end
$$;

rollback;
