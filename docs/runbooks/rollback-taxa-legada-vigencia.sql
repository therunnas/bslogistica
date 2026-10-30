-- ROLLBACK da migration 033 (AUTH-01C.1): remove a verificação de vigência no INSERT das taxas legadas.
-- NÃO é migration e NÃO fica em supabase/migrations: não executar sem autorização.
-- Efeito: com o motor ligado, o INSERT direto de contrato/colaborador/operação com taxa preenchida volta
-- a ser aceito por admin em AAL2 sem vigência correspondente (o estado anterior à 033). Dados não mudam.
-- Não toca a 032 nem o motor. O rollback da 032 (rollback-mfa-opcional.sql) é independente.

begin;

drop trigger trg_contracts_exige_vigencia_na_taxa on public.contracts;
drop trigger trg_employees_exige_vigencia_na_taxa on public.employees;
drop trigger trg_operations_exige_vigencia_na_taxa on public.operations;
drop function public.exigir_vigencia_na_taxa_legada();

commit;
