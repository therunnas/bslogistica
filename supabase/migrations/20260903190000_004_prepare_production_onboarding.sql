-- Remove the fixed demonstration records shipped by the generated prototype.
-- These UUIDs are reserved for the original sample data only.
DELETE FROM public.operation_team
WHERE operation_id IN (
  '33333333-3333-3333-3333-333333333331'::uuid,
  '33333333-3333-3333-3333-333333333332'::uuid
);

DELETE FROM public.shifts
WHERE id IN (
  '44444444-4444-4444-4444-444444444441'::uuid,
  '44444444-4444-4444-4444-444444444442'::uuid,
  '44444444-4444-4444-4444-444444444443'::uuid
);

DELETE FROM public.operations
WHERE id IN (
  '33333333-3333-3333-3333-333333333331'::uuid,
  '33333333-3333-3333-3333-333333333332'::uuid
);

DELETE FROM public.contracts
WHERE id IN (
  '22222222-2222-2222-2222-222222222221'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid
);

DELETE FROM public.employees
WHERE id IN (
  '55555555-5555-5555-5555-555555555551'::uuid,
  '55555555-5555-5555-5555-555555555552'::uuid,
  '55555555-5555-5555-5555-555555555553'::uuid,
  '55555555-5555-5555-5555-555555555554'::uuid,
  '55555555-5555-5555-5555-555555555555'::uuid
);

DELETE FROM public.clients
WHERE id IN (
  '11111111-1111-1111-1111-111111111111'::uuid,
  '11111111-1111-1111-1111-111111111112'::uuid
);

-- Provision the application profile for every Auth user. The first account
-- receives the one-time bootstrap admin role; later accounts receive no role
-- until an administrator explicitly assigns one.
CREATE OR REPLACE FUNCTION public.provision_bslog_user(
  _user_id uuid,
  _email text,
  _metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  _full_name text := NULLIF(BTRIM(COALESCE(_metadata ->> 'full_name', '')), '');
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user id is required';
  END IF;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (_user_id, _full_name, NULLIF(BTRIM(_email), ''))
  ON CONFLICT (id) DO UPDATE
  SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
      email = COALESCE(EXCLUDED.email, public.profiles.email),
      updated_at = now();

  -- Serialize the first-admin decision so two simultaneous registrations
  -- cannot both bootstrap themselves as administrators.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('bslog/bootstrap-admin', 0)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles WHERE role = 'admin'
  ) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (_user_id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.provision_bslog_user(uuid, text, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_bslog_user(uuid, text, jsonb)
TO service_role;

CREATE OR REPLACE FUNCTION public.handle_bslog_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.provision_bslog_user(NEW.id, NEW.email, NEW.raw_user_meta_data);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_bslog_auth_user_created()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS on_bslog_auth_user_created ON auth.users;
CREATE TRIGGER on_bslog_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_bslog_auth_user_created();
