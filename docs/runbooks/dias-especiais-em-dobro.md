# Domingo e feriado em dobro (migration 051)

Roteiro para aplicar a migration 051 e ligar o interruptor `dias_especiais_em_dobro`,
**primeiro no HML e depois em Production**. Cada passo, em cada ambiente, exige autorização
nominal do responsável. Merge não é autorização.

## O que muda

Com o interruptor **ligado** (e o motor por vigência ligado), domingo e os feriados da lista
única (Clientes → Feriados) pagam as horas efetivas em dobro, na cobrança e no custo, mesmo com
a resolução comercial desligada. Exemplo: 8 h num domingo com diária R$ 250 e custo R$ 150
gravam R$ 500 e R$ 300. Domingo que é feriado conta uma vez.

Com o interruptor **desligado** (padrão), nada muda em relação à 050.

Não muda nada que já esteja gravado. Vale para lançamento novo ou para edição de horário,
intervalo, status ou colaborador de linha não faturada.

## Antes de ligar

1. Feriados cadastrados para o período. O tipo do dia fica congelado no lançamento: feriado
   cadastrado depois não converte apontamento já gravado.
2. Colaboradores com custo vigente. Sem ele, o domingo ou feriado é recusado (P0002).
3. O fator de feriado do contrato deixa de valer com o interruptor ligado: o dobro é fixo.

## Passos (por ambiente)

1. Conferir o estado (leitura): versão 050, coluna inexistente.
2. Aplicar a 051 com o script, primeiro só conferindo e depois executando:

   ```bash
   python3 -I docs/runbooks/aplicar-migration-api.py <ref> supabase/migrations/20261118120000_051_domingo_feriado_em_dobro.sql 20261117120000
   ```

   ```bash
   BS_CONFIRMO_PROJETO=<ref> python3 -I docs/runbooks/aplicar-migration-api.py <ref> supabase/migrations/20261118120000_051_domingo_feriado_em_dobro.sql 20261117120000 --executar
   ```

3. Com a 051 aplicada e o interruptor ainda desligado, conferir que nada mudou: um domingo de
   teste em transação desfeita continua com o valor de dia comum.
4. Ligar, como `postgres`, numa transação que confere o resultado:

   ```sql
   begin;
   update public.pricing_settings
      set dias_especiais_em_dobro = true, changed_at = now(),
          reason = 'Domingo e feriado em dobro (051), autorizado pelo responsável em <data>'
    where id and not dias_especiais_em_dobro;
   do $$ begin
     if not public.dias_especiais_em_dobro_ativo() then
       raise exception 'interruptor não ficou ligado';
     end if;
   end $$;
   commit;
   ```

5. Conferir de novo: um domingo de teste em transação desfeita grava o dobro. A tela de
   apontamentos passa a dizer que o banco calcula ao salvar no domingo e no feriado.

## Desligar (reversão)

O mesmo `update` com `false`. O efeito vale para lançamentos novos. Linhas gravadas em dobro
continuam como estão. Com o interruptor desligado, editar o horário delas é recusado (55000) até
ligar de novo. Notas continuam livres.
