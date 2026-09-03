-- rls_auto_enable() é a função de um event trigger: ela liga RLS
-- automaticamente em toda tabela nova criada no schema public.
--
-- O Postgres concede EXECUTE a PUBLIC em toda função nova, e o schema public
-- é exposto pela Data API. Na prática isso publicava um endpoint
-- /rest/v1/rpc/rls_auto_enable acessível inclusive sem autenticação — uma
-- função SECURITY DEFINER ao alcance de qualquer visitante.
--
-- Revogar EXECUTE não afeta o event trigger: ele é disparado pelo Postgres
-- com os privilégios do dono da função, sem passar por essa concessão.

revoke execute on function public.rls_auto_enable() from public;
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
