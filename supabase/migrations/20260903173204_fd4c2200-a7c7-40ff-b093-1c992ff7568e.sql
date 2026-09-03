-- ============ enums ============
CREATE TYPE public.app_role AS ENUM ('admin', 'operacional');
CREATE TYPE public.operation_type AS ENUM ('fixed', 'spot');
CREATE TYPE public.record_status AS ENUM ('active', 'inactive');
CREATE TYPE public.attendance_status AS ENUM ('present', 'absent', 'replacement');
CREATE TYPE public.timesheet_status AS ENUM ('open', 'closed');
CREATE TYPE public.invoice_status AS ENUM ('draft', 'closed', 'issued');

-- ============ shared trigger ============
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

-- ============ profiles ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ user roles ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

-- ============ clients ============
CREATE TABLE public.clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  doc TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  status public.record_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_all" ON public.clients FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_clients_updated BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ contracts ============
CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  daily_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  shift_hours NUMERIC(5,2) NOT NULL DEFAULT 8,
  ot_factor NUMERIC(5,2) NOT NULL DEFAULT 1,
  ot_tolerance_min INTEGER NOT NULL DEFAULT 10,
  valid_from DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_to DATE,
  status public.record_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contracts TO authenticated;
GRANT ALL ON public.contracts TO service_role;
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contracts_all" ON public.contracts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_contracts_updated BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ employees ============
CREATE TABLE public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  doc TEXT,
  role TEXT,
  phone TEXT,
  daily_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  status public.record_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;
GRANT ALL ON public.employees TO service_role;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employees_all" ON public.employees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_employees_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ operations ============
CREATE TABLE public.operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  contract_id UUID REFERENCES public.contracts(id) ON DELETE SET NULL,
  type public.operation_type NOT NULL DEFAULT 'fixed',
  name TEXT NOT NULL,
  site TEXT,
  agreed_amount NUMERIC(12,2),
  operation_date DATE,
  status public.record_status NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operations TO authenticated;
GRANT ALL ON public.operations TO service_role;
ALTER TABLE public.operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operations_all" ON public.operations FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_operations_updated BEFORE UPDATE ON public.operations FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ shifts ============
CREATE TABLE public.shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  crosses_midnight BOOLEAN NOT NULL DEFAULT false,
  status public.record_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shifts TO authenticated;
GRANT ALL ON public.shifts TO service_role;
ALTER TABLE public.shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "shifts_all" ON public.shifts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_shifts_updated BEFORE UPDATE ON public.shifts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ operation team ============
CREATE TABLE public.operation_team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation_id, shift_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.operation_team TO authenticated;
GRANT ALL ON public.operation_team TO service_role;
ALTER TABLE public.operation_team ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operation_team_all" ON public.operation_team FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ timesheets ============
CREATE TABLE public.timesheets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id UUID NOT NULL REFERENCES public.operations(id) ON DELETE CASCADE,
  shift_id UUID REFERENCES public.shifts(id) ON DELETE SET NULL,
  work_date DATE NOT NULL,
  status public.timesheet_status NOT NULL DEFAULT 'open',
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation_id, shift_id, work_date)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheets TO authenticated;
GRANT ALL ON public.timesheets TO service_role;
ALTER TABLE public.timesheets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timesheets_all" ON public.timesheets FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_timesheets_updated BEFORE UPDATE ON public.timesheets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ timesheet entries ============
CREATE TABLE public.timesheet_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timesheet_id UUID NOT NULL REFERENCES public.timesheets(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  status public.attendance_status NOT NULL DEFAULT 'present',
  check_in TIME,
  check_out TIME,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  daily_rate_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  ot_hour_rate_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  daily_cost_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  billed_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  invoice_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (timesheet_id, employee_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.timesheet_entries TO authenticated;
GRANT ALL ON public.timesheet_entries TO service_role;
ALTER TABLE public.timesheet_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "timesheet_entries_all" ON public.timesheet_entries FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_timesheet_entries_updated BEFORE UPDATE ON public.timesheet_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============ invoices ============
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  total_dailies NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_overtime NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_all" ON public.invoices FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_invoices_updated BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.timesheet_entries
  ADD CONSTRAINT timesheet_entries_invoice_fk
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;

-- ============ invoice items ============
CREATE TABLE public.invoice_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  operation_id UUID REFERENCES public.operations(id) ON DELETE SET NULL,
  description TEXT NOT NULL,
  quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoice_items TO authenticated;
GRANT ALL ON public.invoice_items TO service_role;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_items_all" ON public.invoice_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============ indexes ============
CREATE INDEX idx_contracts_client ON public.contracts(client_id);
CREATE INDEX idx_operations_client ON public.operations(client_id);
CREATE INDEX idx_shifts_operation ON public.shifts(operation_id);
CREATE INDEX idx_timesheets_date ON public.timesheets(work_date);
CREATE INDEX idx_timesheet_entries_timesheet ON public.timesheet_entries(timesheet_id);
CREATE INDEX idx_timesheet_entries_employee ON public.timesheet_entries(employee_id);

-- ============ demo data ============
INSERT INTO public.clients (id, name, doc, contact_name, email, phone, status) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Ludovico Logística', '12.345.678/0001-90', 'Marcos Silva', 'operacoes@ludovico.com.br', '(11) 4002-8922', 'active'),
  ('11111111-1111-1111-1111-111111111112', 'Porto Santos Cargas', '98.765.432/0001-10', 'Ana Ribeiro', 'contato@portosantos.com.br', '(13) 3232-1010', 'active');

INSERT INTO public.contracts (id, client_id, name, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from) VALUES
  ('22222222-2222-2222-2222-222222222221', '11111111-1111-1111-1111-111111111111', 'Contrato Ludovico 2026', 210.00, 8, 1.00, 10, '2026-01-01'),
  ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111112', 'Contrato Avulsos Porto', 250.00, 8, 1.50, 15, '2026-01-01');

INSERT INTO public.operations (id, client_id, contract_id, type, name, site, status) VALUES
  ('33333333-3333-3333-3333-333333333331', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222221', 'fixed', 'CD Ludovico — Equipe Fixa', 'Guarulhos - SP', 'active');

INSERT INTO public.operations (id, client_id, contract_id, type, name, site, agreed_amount, operation_date, status) VALUES
  ('33333333-3333-3333-3333-333333333332', '11111111-1111-1111-1111-111111111112', '22222222-2222-2222-2222-222222222222', 'spot', 'Descarga de contêiner MSC-4471', 'Porto de Santos', 0, '2026-09-02', 'active');

INSERT INTO public.shifts (id, operation_id, name, start_time, end_time, break_minutes, crosses_midnight) VALUES
  ('44444444-4444-4444-4444-444444444441', '33333333-3333-3333-3333-333333333331', '1º turno', '06:00', '15:00', 60, false),
  ('44444444-4444-4444-4444-444444444442', '33333333-3333-3333-3333-333333333331', '2º turno', '15:00', '00:00', 0, true),
  ('44444444-4444-4444-4444-444444444443', '33333333-3333-3333-3333-333333333332', 'Turno único', '08:00', '17:00', 60, false);

INSERT INTO public.employees (id, name, doc, role, phone, daily_cost) VALUES
  ('55555555-5555-5555-5555-555555555551', 'João Pereira', '123.456.789-01', 'Ajudante', '(11) 90000-0001', 120.00),
  ('55555555-5555-5555-5555-555555555552', 'Carlos Souza', '123.456.789-02', 'Ajudante', '(11) 90000-0002', 120.00),
  ('55555555-5555-5555-5555-555555555553', 'Rafael Lima', '123.456.789-03', 'Conferente', '(11) 90000-0003', 140.00),
  ('55555555-5555-5555-5555-555555555554', 'Bruno Alves', '123.456.789-04', 'Ajudante', '(11) 90000-0004', 120.00),
  ('55555555-5555-5555-5555-555555555555', 'Diego Martins', '123.456.789-05', 'Operador', '(11) 90000-0005', 150.00);

INSERT INTO public.operation_team (operation_id, shift_id, employee_id) VALUES
  ('33333333-3333-3333-3333-333333333331', '44444444-4444-4444-4444-444444444441', '55555555-5555-5555-5555-555555555551'),
  ('33333333-3333-3333-3333-333333333331', '44444444-4444-4444-4444-444444444441', '55555555-5555-5555-5555-555555555552'),
  ('33333333-3333-3333-3333-333333333331', '44444444-4444-4444-4444-444444444441', '55555555-5555-5555-5555-555555555553'),
  ('33333333-3333-3333-3333-333333333331', '44444444-4444-4444-4444-444444444442', '55555555-5555-5555-5555-555555555554'),
  ('33333333-3333-3333-3333-333333333331', '44444444-4444-4444-4444-444444444442', '55555555-5555-5555-5555-555555555555'),
  ('33333333-3333-3333-3333-333333333332', '44444444-4444-4444-4444-444444444443', '55555555-5555-5555-5555-555555555551'),
  ('33333333-3333-3333-3333-333333333332', '44444444-4444-4444-4444-444444444443', '55555555-5555-5555-5555-555555555554');