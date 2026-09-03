-- 1. has_role becomes SECURITY INVOKER (no RLS bypass); relies on own-row read policy
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;

-- staff helper (any assigned role), also SECURITY INVOKER
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_staff() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- 2. user_roles: own rows only
DROP POLICY IF EXISTS user_roles_select ON public.user_roles;
CREATE POLICY user_roles_select_own ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. profiles: own profile, or admins
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select_own_or_admin ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 4. business tables: staff read, admin-only writes on commercial/master data
DROP POLICY IF EXISTS clients_all ON public.clients;
CREATE POLICY clients_select_staff ON public.clients
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY clients_write_admin ON public.clients
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS contracts_all ON public.contracts;
CREATE POLICY contracts_select_staff ON public.contracts
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY contracts_write_admin ON public.contracts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS employees_all ON public.employees;
CREATE POLICY employees_select_staff ON public.employees
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY employees_write_admin ON public.employees
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS invoices_all ON public.invoices;
CREATE POLICY invoices_select_staff ON public.invoices
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY invoices_write_admin ON public.invoices
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS invoice_items_all ON public.invoice_items;
CREATE POLICY invoice_items_select_staff ON public.invoice_items
  FOR SELECT TO authenticated USING (public.is_staff());
CREATE POLICY invoice_items_write_admin ON public.invoice_items
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. operational tables: any staff member may manage
DROP POLICY IF EXISTS operations_all ON public.operations;
CREATE POLICY operations_staff ON public.operations
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS shifts_all ON public.shifts;
CREATE POLICY shifts_staff ON public.shifts
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS operation_team_all ON public.operation_team;
CREATE POLICY operation_team_staff ON public.operation_team
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS timesheets_all ON public.timesheets;
CREATE POLICY timesheets_staff ON public.timesheets
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());

DROP POLICY IF EXISTS timesheet_entries_all ON public.timesheet_entries;
CREATE POLICY timesheet_entries_staff ON public.timesheet_entries
  FOR ALL TO authenticated USING (public.is_staff()) WITH CHECK (public.is_staff());
