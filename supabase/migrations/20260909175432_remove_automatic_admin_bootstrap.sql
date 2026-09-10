-- Onboarding cria somente o perfil. A atribuição do primeiro administrador é
-- uma operação explícita de controle, fora do fluxo automático de cadastro.
-- Nenhuma role existente é removida por esta migration.

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
END;
$$;

REVOKE ALL ON FUNCTION public.provision_bslog_user(uuid, text, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_bslog_user(uuid, text, jsonb)
TO service_role;

COMMENT ON FUNCTION public.provision_bslog_user(uuid, text, jsonb) IS
  'Cria ou atualiza somente o perfil do usuário. Papéis são atribuídos '
  'separadamente por um administrador autorizado.';
