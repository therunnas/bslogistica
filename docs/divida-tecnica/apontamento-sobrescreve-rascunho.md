# Apontamento sobrescreve o horário digitado

**Levantado em:** 04/09/2026
**Situação:** **RESOLVIDA** em 05/09/2026 — correção implementada e validada
contra o banco. Ver "Correção aplicada" e "Validação" no fim do documento.
**Gravidade:** alta — perdia receita sem aviso.

O histórico abaixo é o diagnóstico original, mantido na íntegra: ele explica por
que a tela se comportava assim e serve de referência caso o sintoma reapareça.

---

## Histórico — diagnóstico de 04/09/2026

### Causa técnica

Na tela de apontamentos, um `useEffect` reconstrói o rascunho inteiro:

```js
useEffect(() => {
  const base = teamMembers.map((member) => {
    const existing = existingEntries.find((e) => e.employee_id === member.employee_id);
    return {
      ...
      checkOut: existing?.check_out?.slice(0, 5) ?? shift?.end_time.slice(0, 5) ?? "",
      ...
    };
  });
  setDraft([...base, ...extras]);
}, [teamMembers, existingEntries, shift?.start_time, shift?.end_time, shift?.break_minutes]);
```

`teamMembers` e `existingEntries` são `useMemo` sobre dados do React Query.
Sempre que um refetch devolve arrays novos, as identidades mudam, o efeito
dispara e `setDraft` **substitui o que o usuário digitou**.

Quando ainda não existe apontamento gravado, `existing` é indefinido, e o
`checkOut` volta ao `end_time` do turno. O horário digitado desaparece.

O efeito não é idempotente em relação à edição em andamento: ele trata o estado
do servidor como única fonte de verdade e descarta o trabalho local.

### Comportamento confirmado nas duas aplicações

Mesma entrada — Felipe, presente, 06:00 às **17:30**, intervalo 60 — em datas
diferentes para não interferir uma na outra:

| Aplicação | Data       | Gravado                                                 |
| --------- | ---------- | ------------------------------------------------------- |
| Next.js   | 21/10/2026 | 15:00 · 480 min · 0 extra · R$ 180,00 · custo R$ 120,00 |
| TanStack  | 22/10/2026 | 15:00 · 480 min · 0 extra · R$ 180,00 · custo R$ 120,00 |

Idênticos. **Não é regressão da migração** — o defeito já existe na aplicação em
uso, e a versão Next.js o reproduz fielmente.

No TanStack o `updated_at` ficou 14 segundos depois do `created_at`: houve duas
escritas, e a segunda gravou por cima com o padrão do turno.

O Next.js torna o defeito mais fácil de disparar, porque o App Router liga
`reactStrictMode` por padrão e o StrictMode invoca efeitos duas vezes em
desenvolvimento. O StrictMode **revela** o problema, não o cria — desligá-lo
esconderia uma perda real de dados.

### Impacto financeiro

O valor perdido é justamente a hora extra. No caso observado, 2h30 de trabalho
deixaram de ser apontadas: **R$ 264,38 viraram R$ 180,00**, uma diferença de
R$ 84,38 num único apontamento.

A perda é invisível: a tela mostra o cálculo correto enquanto se digita, e o
usuário salva acreditando ter registrado o que via. Quem confere depois encontra
número menor, sem nada indicando que houve sobrescrita.

### Como reproduzir (no código anterior à correção)

1. Abrir apontamentos numa operação com turno cadastrado.
2. Alterar a saída para um horário maior que o fim do turno.
3. Aguardar alguns segundos, ou trocar de aba e voltar.
4. Salvar. O valor gravado é o `end_time` do turno, não o digitado.

---

## Precisões acrescentadas no diagnóstico de 05/09/2026

Dois pontos do diagnóstico original mereceram correção ao reexaminar a tela:

**Não havia escrita automática.** A varredura dos caminhos de escrita encontrou
apenas dois, ambos em `onClick` — o botão Salvar e o botão Fechar dia. Nenhum
`useEffect` chamava `mutate`. Abrir a tela, dar F5, sofrer refetch ou trocar de
rota nunca gravaram. O defeito era a substituição do rascunho **em memória**,
antes do clique; o clique em si sempre foi explícito.

**"Qualquer refetch" era exagero.** O React Query faz _structural sharing_ e
preserva a referência quando os dados voltam iguais, então um refetch sem
mudança não disparava a reconstrução. Os gatilhos reais eram quatro: a carga
inicial (arrays saindo de `undefined`), o `timesheet.id` aparecendo, o efeito que
forçava o primeiro turno, e refetches que traziam mudança de verdade.

**Um agravante não identificado em 04/09:** o Salvar montava o payload com
`computed.map(...)`, isto é, gravava **todas** as linhas do rascunho com valores
recalculados no navegador — não só a que o usuário editou. Salvar um colaborador
regravava os demais.

---

## Correção aplicada — 05/09/2026

Tudo em `src/app/(painel)/apontamentos/painel-apontamentos.tsx`. `billing.ts`,
`calcEntry`, as regras de diária, hora extra e custo, o schema, as migrations e o
Dashboard não foram tocados.

**Rascunho com identidade de contexto.** O estado passou de `DraftEntry[]` para
`DraftState { key, rows, dirty }`, onde `key` é `operationId|turnoId|date`. O
rascunho só é reconstruído do zero quando a chave muda; enquanto ela não muda, os
dados do servidor são **mesclados**, não substituídos.

**Precedência da edição manual.** `update()` marca a linha em `dirty`, sempre com
um `Set` novo — nunca mutando o anterior. Linhas em `dirty` mantêm os valores
digitados durante a mesclagem e recebem apenas o `entryId` vindo do servidor, para
que uma linha gravada em outra aba não volte a ser tratada como nova.

**Escrita escopada.** O payload deriva de `aSalvar`, que filtra por
`!row.entryId || dirty.has(employeeId)`. Sem nada a salvar, `mutationFn` retorna
antes de qualquer chamada ao Supabase e a tela informa
`Nenhuma alteração para salvar.`

**Sincronização pós-save.** `onSuccess` aguarda as invalidações concluírem antes
de limpar `dirty`, para que a reconstrução seguinte rode sobre dados já
posteriores à gravação.

**Seleção de turno.** O efeito que forçava o primeiro turno agora só age quando o
turno atual não pertence à operação. "Sem turno definido" escolhido de propósito
é preservado; sem turnos disponíveis o estado fica `null`, e não `""`, para que um
turno cadastrado depois ainda seja selecionado.

**Guarda de carregamento.** Enquanto `shifts`, `team`, `timesheets` ou `entries`
estiverem na primeira carga, o rascunho não é montado e o Salvar fica
desabilitado — assim uma linha existente nunca é confundida com nova por a query
ainda não ter terminado. A guarda usa `isLoading`, não `isFetching`: refetch em
segundo plano não pode bloquear a tela.

**Comportamento preservado de propósito:** num apontamento novo todas as linhas
são novas, então o primeiro Salvar continua criando a equipe inteira.

## Validação — 05/09/2026

Executada na aplicação local, contra o banco do BSLOG, com dois colaboradores
numa mesma operação, turno e data.

| Teste                                    | Resultado                                                      |
| ---------------------------------------- | -------------------------------------------------------------- |
| Digitar 06:00–17:30 pausa 60, salvar, F5 | **PASS** — 17:30 permaneceu; 630 min, 150 extras, R$ 236,25    |
| Salvar sem alterar nenhum campo          | **PASS** — `Nenhuma alteração para salvar.`, zero escrita       |
| Editar somente Carlos e salvar           | **PASS** — `updated_at` do lipe inalterado                      |

Medição do terceiro teste, a prova da escrita escopada:

| Colaborador      | Saída                                    | `updated_at`                                     |
| ---------------- | ---------------------------------------- | ------------------------------------------------ |
| Carlos (editado) | 18:00 · 660 min · 180 extras · R$ 247,50 | `2026-09-05 15:59:00.512673+00`                  |
| lipe (intocado)  | 15:00 · 480 min · 0 extras · R$ 180,00   | `2026-09-05 15:53:29.085837+00` — **não mudou**  |

O Dashboard refletiu os lançamentos corretamente: 2 diárias, 2,5 h extras,
receita R$ 416,25, custo R$ 316,88, margem R$ 99,37 (23,9%), 2 colaboradores
ativos.

**Nota de método.** A primeira rodada dos dois últimos testes falhou porque foi
executada contra a Preview, que servia o commit `0b400d5` — anterior à correção,
que ainda estava só na árvore de trabalho. Ao validar correções desta tela,
confirme antes que o build sob teste as contém; a tabela exibindo
"Carregando equipe e apontamentos…" na primeira carga é um indicador rápido.

## O que continua em aberto

O cálculo permanece no navegador e é enviado pronto ao banco. Mover o cálculo
para o servidor tiraria do frontend a autoridade sobre o valor, e conversa
diretamente com [faturamento-nao-transacional.md](faturamento-nao-transacional.md).
Fica para a etapa de faturamento transacional.

Não há teste automatizado cobrindo a mesclagem — o projeto ainda não tem runner
de testes. A função de mesclagem é candidata natural a teste unitário quando
houver.
