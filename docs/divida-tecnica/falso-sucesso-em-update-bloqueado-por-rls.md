# "Registro salvo." quando a RLS bloqueou a gravação

**Levantado em:** 04/09/2026
**Situação:** **RESOLVIDA** — a interface confere a contagem de linhas afetadas.
**Gravidade na época:** alta — enganava o usuário de forma ativa.

## Causa técnica

No Postgres, uma policy de RLS que impede a escrita pode agir de duas formas
distintas, e a diferença importa:

- num `INSERT`, a cláusula `WITH CHECK` **levanta erro**:
  `new row violates row-level security policy`;
- num `UPDATE` ou `DELETE`, a cláusula `USING` apenas **filtra as linhas
  visíveis**. O comando roda com sucesso e afeta **zero linhas**. Nenhum erro é
  levantado.

O `useSaveRow` só observava o erro. Sem erro, o `onSuccess` disparava e mostrava
"Registro salvo.", e o número de linhas afetadas nunca era consultado. A RLS
protegia os dados corretamente; o defeito era o que a interface dizia ao usuário.

O defeito só ficou visível quando existiu um perfil sem permissão de escrita: até
04/09/2026 o único usuário era admin, e o caminho de bloqueio nunca era
percorrido.

## Correção aplicada

Em `src/lib/mutations.ts`, `useSaveRow` e `useDeleteRow` pedem `count: "exact"` ao
PostgREST e chamam `exigirLinhaAfetada(count, acao)`, que lança um erro em
português quando `count === 0`. As telas de apontamentos e de operações usam o
mesmo helper nas escritas que fazem por conta própria.

Decisões que valem manter:

- **`count === 0`, e não `!count`.** `null` significa "não medido"; tratá-lo como
  zero quebraria qualquer chamada que não peça a contagem.
- **A mensagem não distingue "não existe" de "sem permissão".** Separar os dois
  revelaria a existência de registros que o usuário não pode enxergar.

## Observação atual

Desde a migration `016`, o papel `operacional` não escreve nas tabelas de negócio
pelo PostgREST: o painel administrativo é só de `admin`, e o operador usa a tela
`/operacional`, que fala apenas com as RPCs. O helper continua valendo como
defesa para qualquer escrita bloqueada pela RLS.
