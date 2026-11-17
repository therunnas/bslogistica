# Gate C — achados D1–D8 (sessões 31 e 32)

Navegação administrativa do Preview `dpl_99KcDZk8fbx57dcw9qYWR7NgyvXY` (HEAD `da94921`, HML na
054) feita pelo Claude in Chrome: 8 telas abertas, sem erro de console do app, sem gravação. A
sessão 31 auditou os achados no código (só leitura); a sessão 32 corrigiu o D8, só local.
Login, MFA, logout, operador, acesso por URL, gravações, concorrência e faturamento no Preview
seguem **pendentes**.

## Diagnóstico (sessão 31)

| ID  | Achado                                          | Classificação                                                                  | Prioridade | Migration      |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------ | ---------- | -------------- |
| D1  | Contrato TESTE-MANUAL "até 01/01/0001", "Ativo" | CONFIRMADO: dado gravado em 11/11 pela tela anterior ao #134 (D-CP02-02); status é campo manual | P2         | sim (decisão abaixo) |
| D2  | Ana: R$ 250 cobrado × R$ 260 no contrato; custo R$ 470 × R$ 180 hoje | COMPORTAMENTO ESPERADO: vigência de 250 até 11/11; fatura emitida (12:19:50) antes da correção do custo para 180 (12:20); faturado congelado | —          | não            |
| D3  | Operações ~4 s e Clientes ~14 s com contadores zerados | CONFIRMADO (zeros sem `isPending`; leituras sequenciais; uma consulta por linha no "valor de hoje"); os 14 s de Clientes NÃO COMPROVADO | P3         | não            |
| D4  | Consultas repetidas em Apontamentos             | CONFIRMADO: parte é o desenho da leitura paginada; parte é duplicação (foco da aba, RPC da virada por linha) | P3         | não            |
| D5  | "Fechamento" aparece depois no menu             | CONFIRMADO: disponibilidade lida por RPC no navegador (`useFechamentoDisponivel`) | P3         | não            |
| D6  | CNPJ "32423" aceito                             | CONFIRMADO no formulário, no salvamento e no banco (`clients.doc text`, sem CHECK) | P2         | sim (decisão abaixo) |
| D7  | "Ativo" vermelho em Feriados, verde no resto    | CONFIRMADO: `Badge variant="default"` (cor primária) × `StatusBadge` verde copiado | P3         | não            |
| D8  | Histórico e prévia na mesma chave de cache      | CONFIRMADO — **corrigido localmente na sessão 32**                              | P2         | não            |

## D8 — chaves de cache das vigências (sessão 32)

**Causa.** `useVersoes` (histórico e "valor atual") lê todas as versões, inclusive as aposentadas;
`useTermosDoApontamento` (prévia do apontamento) lê só as ativas. As duas usavam
`["vigencias", "contrato" | "operacao", id]`: a tela aberta primeiro decidia o que a outra recebia
do cache. Depois do histórico, a prévia recebia versões aposentadas (a busca por `id` de
`parametrosDaVersao` passava a achá-las); depois do apontamento, o histórico perdia as aposentadas.
O número da prévia (`resolverCondicaoDoDia`) não mudava, porque `versaoNaData` já filtra as ativas.
Colaborador não colidia (`["vigencias", "colaborador", id]` × `["vigencias", "custos", …]`).

**Correção** (`src/lib/vigencias-dados.ts`): uma fábrica `chaveDasVersoes(tipo, id, escopo)` →
`["vigencias", tipo, id, "todas" | "ativas"]`; o histórico usa `"todas"`, a prévia usa `"ativas"`
no contrato e na operação. O prefixo `["vigencias"]` não muda, então todas as invalidações
existentes (`invalidarVigencias`, tarifas, diária individual, ativar e desligar o motor) continuam
alcançando as duas entradas; nenhum código opera sobre a chave específica.

**Teste** `npm run test:d8-chaves-vigencias` (`scripts/testar-d8-chaves-vigencias.mjs`, no job
`validar`): hooks reais, `QueryClient` real, PostgREST simulado em memória (sem rede). Casos A–I:
histórico completo, prévia só com ativas, alternância histórico ↔ apontamento em contrato e
operação, identidade das entradas, invalidação pelo prefixo, prévia igual à da tela aberta direto
e forma do código. **RED** no código do `da94921`: 16 de 27 falham (os controles — tela aberta
direto, colaborador e o número da prévia — passam). **GREEN** com a correção: 27/27.

Impacto financeiro: nenhum. Sem migration, RPC, RLS, grant, trigger, cálculo (`billing.ts`,
`ledger.ts`, motor) ou faturamento alterado; o banco continua decidindo os valores gravados.

## Decisões do responsável (16/11/2026)

**Contratos** — a data de execução do serviço deve estar dentro da vigência contratual; serviço
executado dentro da vigência pode ser faturado depois, mesmo após o fim do contrato; sem data
final, a vigência é aberta; lançamentos históricos não são modificados.

- **DEC-CP02-01: DECIDIDA** — corresponde à política (c) do CP-10 §10 (recusar o lançamento fora
  da vigência), com o faturamento posterior permitido. Implementação em sessão própria (motor e
  tela, com migration); o CN-D `@falha-conhecida` vira o RED dela. A confirmar na implementação: se
  o dia do fim conta como dentro da vigência.
- **CP-10 §10, "Faturamento depois do término":** deixa de ser risco quando a execução está dentro
  da vigência (é o comportamento desejado); continua risco o lançamento fora dela, até a
  implementação.
- **DEC-CP02-03: parcialmente resolvida** — pela regra, o fim `01/01/0001` (antes do início) é
  inválido; falta decidir o valor correto (sem fim ou a data real) e autorizar a escrita no HML.
- **D1 (banco):** CHECK em `contracts.valid_to` e a mesma validação em `criar_contrato_com_vigencia`
  ficam para a sessão da regra de contratos.

**CNPJ** — opcional; quando preenchido, precisa ser válido (dígitos verificadores). Não foi
decidido nada sobre obrigatoriedade, unicidade ou CPF, e nada disso deve ser presumido.

- **D6:** implementação em sessão própria (validação na tela, no salvamento e no banco); as
  fixtures com CNPJ de dígito errado (`12.345.678/0001-90` no seed, no E2E CL2 e nas suítes SQL 009 e
  012) precisam ser corrigidas antes de um CHECK.

## Fila (cada item com autorização própria)

1. Publicar o D8 (PR Draft, CI, Preview) e revalidar pelo Claude in Chrome.
2. Regra de contratos (DEC-CP02-01, D1, DEC-CP02-03) — migration.
3. CNPJ (D6) — migration.
4. Carregamento (D3, D4, D5).
5. Padronização visual (D7).
