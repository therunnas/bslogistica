# Homologação integrada FIN-PR-11/12/13

Plano de execução no HML `qbnfcmrxmssnwkhaitgd`, schema 045. O PR #100 foi
mergeado em `91513b91b11461ac48d8dfe6af118234bfb6fbc0`. **A sessão 12 executou a
matriz em HML (ver "Resultados da execução" ao final): 17 PASS, 8 PARCIAL,
2 BLOQUEADO, 0 FAIL.** Isso **não** encerra a homologação funcional: restam
os itens que dependem de navegador, de Microsoft Excel, da planilha Dynamis e da
resolução comercial ON.

## Preparação e evidência

Antes da execução, registrar HEAD e deployment exatos, comprovar destino HML do
artefato (não só configuração global), migration head, backup/recuperação e
autorizações de identidades e dados. Não reutilizar contas reais nem alterar
papéis, MFA ou dados sem autorização. Production 034 fica fora desta matriz.

Classificação da preparação:

- **E**: possível com dados/identidades existentes, depois de confirmar sua
  adequação por leitura autorizada; disponibilidade ainda não confirmada.
- **P**: exige escrita controlada em HML e autorização nominal prévia.
- **L**: ensaio automatizado local já existe; não substitui o caso real.

O inventário histórico de HML informa três contas, um papel, nenhum fator MFA,
quatro apontamentos e nenhuma fatura; não se presume que continue igual. Não
criar contas nesta etapa. Para cada caso registrar executor, data, IDs dos
registros sintéticos, entrada, esperado em centavos/minutos, obtido, evidência
de interface/RPC/auditoria e PASS/FAIL/BLOQUEADO. Resultado inicial de todos:
**NÃO EXECUTADO** (atualizado em "Resultados da execução"). Não registrar tokens, cookies, documentos pessoais ou senhas.

## Matriz de execução

| ID  | Fluxo e resultado esperado                                                                                                                                                                                                                | Preparação                                                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | Login admin existente; logout invalida acesso às rotas protegidas; credencial inválida é recusada                                                                                                                                         | E; falha controlada sem exceder rate limit                                                                                                                            |
| A02 | Sem fator verificado, AAL1 acessa funções do papel; com fator, senha sozinha barra app e banco; TOTP válido libera; inválido recusa                                                                                                       | E sem fator; P para fator/identidade aprovados                                                                                                                        |
| A03 | Operacional vê só operações atribuídas; operação alheia e sem atribuição recusadas; `/dashboard`, `/faturamento`, `/fechamento`, `/containers`, rotas XLSX e tabelas financeiras inacessíveis                                             | P: identidade operacional e atribuições aprovadas; L                                                                                                                  |
| A04 | Conta sem papel e sessão inválida não acessam dados; admin+operacional segue decisão central; financeiro não aparece em respostas operacionais                                                                                            | P para combinações de papel; L                                                                                                                                        |
| A05 | Convite, troca de papel, proteção do último admin e auditoria; recuperação sem MFA e com um TOTP; link GET não consome token                                                                                                              | P; Preview comum carece de secrets server-side para administração/recuperação: usar candidato autorizado com capacidade comprovada, sem mudar configs automaticamente |
| B01 | Cliente, contrato, operação, turno, função e colaborador sintéticos; relações corretas e obrigatórios/duplicidades recusados                                                                                                              | E leitura; P cadastro                                                                                                                                                 |
| B02 | Vigências de tarifa padrão e diária individual antes/no/depois da data; fonte congelada; resolução OFF preserva regra anterior e ON só em fixture autorizada; nenhuma linha faturada recalculada                                          | P; L                                                                                                                                                                  |
| C01 | Presença, ausência e substituição; falta sem valor; entrada/saída/intervalo coerentes; entrada=saída recusada; turno noturno válido                                                                                                       | P; L                                                                                                                                                                  |
| C02 | Jornada, saída antecipada, tolerância e HE abaixo/no/acima do limite; usar cálculo esperado independente das regras vigentes; custo e cobrança separados                                                                                  | P; L                                                                                                                                                                  |
| C03 | Sábado; domingo; feriado nacional/estadual/municipal com local e cobertura válidos; sem cobertura/condição deve seguir recusa/alerta vigente                                                                                              | P; L; não criar calendário ou regra comercial nova                                                                                                                    |
| C04 | Adicional diário não entra na base da HE; salvar de novo preserva adicional; duplicação sem confirmação recusada; trilha com motivo                                                                                                       | P; L                                                                                                                                                                  |
| C05 | Fechar/reabrir folha respeita papel e estado; salvar durante refetch/erro bloqueia sem perder rascunho; linha faturada imutável                                                                                                           | P; L                                                                                                                                                                  |
| D01 | Containers, fluxo 1: admin acessa lista/detalhe; operacional é barrado na UI e banco                                                                                                                                                      | E admin; P operacional; L                                                                                                                                             |
| D02 | Fluxo 2: registrar pelo menu, operação opcional, datas, descrição, quantidade, receita total e custo por participante; lista/detalhe iguais ao registro                                                                                   | P; L                                                                                                                                                                  |
| D03 | Fluxo 3: rateio explícito do total entre participantes, soma exata sem divisão automática ou centavos perdidos                                                                                                                            | P; L                                                                                                                                                                  |
| D04 | Fluxo 4: atalho de Operações preenche cliente/operação; parâmetros inválidos, repetidos ou de outro cliente recusados                                                                                                                     | E navegação; P envio; L                                                                                                                                               |
| D05 | Fluxo 5: duplo clique/recarregar intenção cria só um serviço, um adicional e uma trilha de registro; intenção diferente conflita                                                                                                          | P; L                                                                                                                                                                  |
| D06 | Fluxo 6: quantidade zero, dinheiro com mais de duas casas, participante repetido, soma divergente e solicitação no mesmo dia recusados sem escrita parcial                                                                                | P; L                                                                                                                                                                  |
| D07 | Fluxo 7: cancelar antes da fatura exige motivo e cancela receita junto; adicional vinculado não cancela isolado; faturado não cancela. Correção anterior à fatura segue cancelar e novo registro com trilha; nunca editar lastro faturado | P; L                                                                                                                                                                  |
| D08 | Fluxo 8: fatura mista e somente Containers; competência distinta da execução; receita aparece uma vez, vínculo à fatura e custo congelado corretos; repetição não emite nova fatura                                                       | P; L                                                                                                                                                                  |
| D09 | Fluxo 9: participantes e custo devido só em visões internas previstas; custo não significa pagamento; auditoria de registro/cancelamento preservada; exportação cliente sem custo/margem                                                  | E leitura se houver serviços; P criação; L                                                                                                                            |
| E01 | Fechamento 1ª/2ª quinzena e mês conforme frequência; por colaborador e detalhe: diária+HE+especial+adicional diário=apontamentos; +serviços+ajustes=receita; faltas fora das diárias                                                      | E se período completo; P cobertura; L                                                                                                                                 |
| E02 | Conferir banco/Fechamento/fatura; soma itens=total receita; custo da fatura inclui Containers uma vez; antes/depois faturamento sem duplicação e a faturar zerado no recorte emitido                                                      | P emissão; L                                                                                                                                                          |
| E03 | Excel interno e do cliente no Microsoft Excel: abas, datas, moeda, ordem, filtros por colaborador/data/operação e SUBTOTAL; dinheiro filtrado correto, total fixo igual à receita do recorte                                              | E exportação se dados aptos; P para matriz completa; L                                                                                                                |
| E04 | Minutos de HE somados antes da conversão no total; SUBTOTAL de horas pode diferir por soma das linhas arredondadas; dinheiro nunca diverge; cliente sem custo/resultado/margem; textos hostis não viram fórmulas                          | E exportação; P textos sintéticos; L                                                                                                                                  |
| E05 | Assinatura vencida recusa exportação; lançamento/adicional/ajuste alterado exige recarga; JSON inconsistente e acesso sem permissão não produzem arquivo                                                                                  | P mutação controlada; L                                                                                                                                               |
| E06 | Modelo Dynamis: conferir estrutura e fórmulas históricas versus V2; explicar diferença por componente e regra/período, sem forçar os R$ 35.118,12                                                                                         | Arquivo externo ainda não acessível                                                                                                                                   |

## Modelo comercial e conciliação

`Dynamis Controle de jornada 2026 (1).xlsx` é referência comercial histórica,
não especificação obrigatória do motor V2. **Modelo externo ainda não acessível**:
busca no workspace e pasta local autorizada do projeto não encontrou cópia.
Nenhuma aba, fórmula ou total do anexo foi inferido.

Quando o original estiver acessível, preservar bytes e calcular SHA-256. Ler
abas/cabeçalhos/fórmulas e valores armazenados, confirmar período e distinguir
fórmula de resultado recalculado. Mapear jornada, tarifa, tolerância, sábado,
domingo/feriado, arredondamento, HE e adicionais contra as regras/snapshots V2.
Registrar diferenças históricas por componente sem mudar o motor aprovado.

Para conciliação estrita de uma base efetivamente comparável:
`npm run conciliar:fin-pr-13 -- base.json fechamento.json containers.json`.
O JSON comercial tem `fonte: { arquivo, sha256 }`, `cliente: { id, nome }`,
`periodo: { inicio, fim }`, `quantidadeApontamentos`, `quantidadeColaboradores`,
`componentes` e `totalCentavos`. Componentes: `diariasCentavos`,
`horasExtrasCentavos`, `domingoFeriadoCentavos`, `adicionalDiarioCentavos`,
`outrosAdicionaisCentavos`, `containersCentavos`, `ajustesCentavos` (este admite
sinal). Usar inteiros em centavos, nunca reais decimais. Apontamentos incluem
faltas lidas; colaboradores seguem o conjunto do Fechamento.

`fonte.arquivo` é caminho absoluto ou relativo à pasta de `base.json`. O CLI lê
os bytes originais e verifica o hash antes de conciliar; não grava o original.
`fechamento.json` é o snapshot do recorte e `containers.json` lista os IDs de
`billing_additionals` ligados a serviços desse mesmo recorte, obtidos por leitura
autorizada, não inferidos da descrição. A lista prova correspondência ao snapshot;
a confirmação do vínculo no banco pertence à evidência da extração. A função pura
valida formato do hash; a verificação dos bytes pertence ao CLI.

Códigos de saída: 0 confere; 1 divergência exata; 2 entrada inválida/fonte ausente
ou hash divergente. Hash confirma identidade dos bytes, não autoria ou aprovação
comercial. Se o modelo histórico usar regras diferentes, registrar a comparação
como diferença esperada explicada, e não declarar paridade financeira V2.

## Saída e próximos gates

Apresentar resultados reais, falhas, bloqueios e evidências; obter aprovação
explícita da homologação. O PR #100 já foi integrado (sessão 11). Manual e
preparação de Production 035–045 vêm depois, com backup novo, rollback e controle
do deploy automático de main.

## Resultados da execução (sessão 12, 05/11/2026)

**Ambiente:** servidor Next local (`next dev`, porta 3100, `main` em `91513b9`)
ligado **exclusivamente** ao HML `qbnfcmrxmssnwkhaitgd` (URL e chaves do HML; nenhuma
variável de Production). Não houve Preview da Vercel: não havia acesso à Vercel
(sem CLI, token ou MCP) para criar um Preview isolado. O ambiente local não substitui
o Preview publicado; o isolamento de build/runtime da Vercel não foi exercido.
**Identidades:** contas sintéticas `s11-*@e2e-sintetico.invalid` criadas pela Admin API
do HML, sem envio de e-mail; senhas aleatórias fora do repositório. **Recuperação:** dump
de dados de `public` do HML antes das escritas (não restaura `auth`). **Execução:**
PostgREST/RPC com JWT reais das contas de teste e rotas do app com cookies de sessão reais;
TOTP real calculado a partir do segredo do fator. O harness ficou fora do repositório.

Esperados calculados à parte, em centavos, a partir das regras documentadas
(diária 200,00; jornada líquida 8 h; fator 1,5; tolerância 10 min; custo 70–100/dia).

| ID  | Resultado | Evidência resumida                                                                                                                                                                                                                                                                                    |
| --- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A01 | PASS      | Admin acessa `/dashboard` e `/fechamento` (200); sem sessão 307 para `/login`; logout global faz o token antigo ler 0 clientes; credencial inválida recusada.                                                                                                                                         |
| A02 | PASS      | Sem fator: AAL1 lê dados e acessa o app. Com fator: senha sozinha lê 0 linhas, RPC admin recusada, app 307 para `/mfa`; TOTP inválido recusado, válido libera sem novo código. Fator removido ao fim.                                                                                                 |
| A03 | PASS      | Operacional vê só a operação atribuída; zero campo financeiro nas 4 RPCs de leitura; operação alheia recusada; chave extra gera `22023`; 9 tabelas de negócio com 0 linhas; rotas financeiras mostram "Área administrativa restrita"; APIs de Fechamento/XLSX não geram arquivo.                      |
| A04 | PASS      | Sem papel: 0 linhas, RPC recusada, telas "Acesso não liberado"; token forjado 401; anon sem dados; admin+operacional decide como admin e não usa a superfície operacional.                                                                                                                            |
| A05 | PARCIAL   | Último admin: DELETE e rebaixamento recusados (transação com ROLLBACK, 4 admins reduzidos a 1; nada persistiu). **Não executados:** convite, recuperação e troca de papel pela interface (enviam e-mail real / Server Action) e auditoria correspondente.                                             |
| B01 | PASS      | Operações ligadas ao contrato do próprio cliente; nome obrigatório, contrato de outro cliente, colaborador em duas equipes, função duplicada e diária negativa recusados.                                                                                                                             |
| B02 | PARCIAL   | Vigência 250,00 a partir de 01/12: 30/11 cobra 200,00, 01/12 e 02/12 cobram 250,00; lançamento de 03/11 mantém snapshot 200,00; com resolução OFF a diária individual (999,00) não altera a cobrança. **Não executado:** resolução ON (diária individual, tarifa por função/período).                 |
| C01 | PASS      | Presença 200,00/80,00; falta 0/0; substituição 200,00/90,00; entrada = saída recusada sem gravação parcial; noturno 22:00–07:00 (480 min) cobra 200,00 e custa 100,00.                                                                                                                                |
| C02 | PASS      | HE de 0, 10, 15, 16, 45, 46, 75, 76 e 120 min: cobra 0, 0, 30, 30, 60, 60, 90, 90 e 120 min; custo separado e zerado abaixo da tolerância; saída antecipada proporcional (150,00/60,00). Regra 15/45 do `ESTADO_DO_PROJETO.md` — ver achado A.                                                        |
| C03 | PARCIAL   | Com local e coberturas nacional/estadual/municipal confirmadas, sábado, domingo e os três feriados classificam corretamente e o dia útil também; sem cobertura ou local o estado é pendente com tipo nulo; município de outra operação não contamina. **Não executado:** pagamento ×2 (resolução ON). |
| C04 | BLOQUEADO | O banco recusa o adicional diário com a resolução OFF (`55000`). Exige ligar a resolução, sem autorização.                                                                                                                                                                                            |
| C05 | PARCIAL   | Fechar/reabrir folha; escrita em folha fechada recusada (admin e operacional); `UPDATE` só de campo derivado recusado; linha faturada imutável (E02). **Não executado:** salvar durante refetch/erro sem perder rascunho (navegador).                                                                 |
| D01 | PASS      | Admin: lista, detalhe e novo respondem 200; operacional: restrito na UI, `registrar`/`cancelar` recusados e 0 linhas nas 3 tabelas de container. Renderização client não inspecionada.                                                                                                                |
| D02 | PASS      | Serviço de 450,00 (receita) e 250,00 (custo por pessoa 100,00 + 150,00); adicional de 450,00 com competência 01–15/10; trilha `registered` com motivo; lista/detalhe 200.                                                                                                                             |
| D03 | PASS      | Rateio 100,00 + 200,01 do total de 300,01 soma exata; total divergente recusado.                                                                                                                                                                                                                      |
| D04 | PARCIAL   | Rota `?operacao=` válida, inválida e repetida sem 5xx; o banco recusa operação de outro cliente. **Não executado:** preenchimento automático e mensagens do formulário (navegador).                                                                                                                   |
| D05 | PASS      | Mesma chave e payload devolvem o mesmo id (+1 serviço, +1 adicional, +1 trilha); payload diferente com a mesma chave dá `23505` sem escrita. Duplo clique na interface não executado.                                                                                                                 |
| D06 | PASS      | Quantidade zero, centavo fracionário, participante repetido, soma divergente, mesmo dia, campo desconhecido e competência invertida recusados; contagens de serviços, adicionais e trilhas inalteradas.                                                                                               |
| D07 | PASS      | Cancelar exige motivo, cancela serviço e adicional juntos, é imutável depois e preserva `registered`+`canceled`; o adicional não cancela isolado; correção = cancelar + novo; serviço faturado não cancela (`55000`).                                                                                 |
| D08 | PASS      | Fatura mista (cliente A) e fatura só de Containers (cliente B, 800,00/300,00): cada serviço aparece uma vez; serviço executado em 16/10 com competência 1ª quinzena entrou na fatura da 1ª; vínculos e custo corretos; repetir a emissão é recusado.                                                  |
| D09 | PARCIAL   | Cliente sem custo/resultado/margem; operacional sem acesso; auditoria preservada. **Não executado:** texto de que custo devido não é pagamento (navegador).                                                                                                                                           |
| E01 | PASS      | 1ª quinzena: apontamentos 2.862,50 + containers 920,01 = receita 3.782,51; soma por colaborador = apontamentos; conciliação confere; faltas fora das diárias; 2ª quinzena: 662,50 + 150,00 = 812,50 (serviço de competência 1ª não entra).                                                            |
| E02 | PASS      | Fatura 3.782,51; 13 diárias; 7 h; 7 itens somam o total; custo 1.781,64 (apontamentos 1.151,63 + containers 630,01 uma vez); depois da emissão a faturar = 0; janelas fora da frequência e repetição recusadas; linha/adicional/fatura faturados imutáveis.                                           |
| E03 | PARCIAL   | `.xlsx` lido no XML: abas, datas serial, moeda numérica, ordem pt-BR e por data, `SUBTOTAL(109)` cobrindo as 17 linhas, total fixo 3.782,51. **Não executado:** abrir e filtrar no Microsoft Excel.                                                                                                   |
| E04 | PARCIAL   | HE somada em minutos (7 h) igual à soma das linhas; cliente sem custo/resultado/margem; interno com custo, resultado e margem; descrição `=HYPERLINK(...)` e referência `@SUM(...)` sem fórmula. **Não executado:** filtros no Excel real.                                                            |
| E05 | PASS      | Sem sessão e operacional sem arquivo; JSON inválido, corpo incompleto e assinatura adulterada sem arquivo; assinatura vencida após mudança de dados recusada; nova assinatura exporta.                                                                                                                |
| E06 | BLOQUEADO | Planilha Dynamis original indisponível; nada foi inferido.                                                                                                                                                                                                                                            |

### Achados

- **A (P3, documentação/decisão comercial).** `docs/ARQUITETURA.md` descreve o
  arredondamento diário da HE como "até 15 descarta; 16 a 45 vira 30; 46 a 59 vira a
  hora seguinte". O núcleo V2 (`nucleo_arredondar_he_diaria`) e o `ESTADO_DO_PROJETO.md`
  usam fronteiras inclusivas (15 min vira 30; 45 min vira 60). O HML seguiu o núcleo V2.
  A BS precisa confirmar qual fronteira vale; o C02 é PASS pela regra do `ESTADO`.
- **B (observação).** Com a resolução OFF, domingo e o feriado nacional confirmado no
  calendário foram cobrados como "Dia comum" (200,00), embora a consulta do calendário os
  classifique como domingo/feriado. É o comportamento "OFF preserva regra anterior"; o
  pagamento ×2 só existe com a resolução ON e não foi exercido.
- **C (observação).** Turno 22:00–06:00 com 60 min de intervalo tem 7 h líquidas e cobra
  proporcional (175,00), pela referência líquida de 8 h. O cadastro de turno não avisa.
- **D (observação).** Telas protegidas respondem HTTP 200 com "Área administrativa
  restrita" / "Acesso não liberado" (desenho documentado); os dados continuam protegidos
  pela RLS e as APIs respondem 401/403.
- **E (P4).** O cadastro de turno aceitou início = fim sem virada de meia-noite; só o
  apontamento recusa entrada = saída.
- **F (risco de Production).** Production está na 034 com o código da `main` (045) em
  produção. Ver "Production" no `ESTADO_DO_PROJETO.md`.

### Dados sintéticos criados em HML (limpeza posterior)

Todos os nomes começam com `E2E-S11`. Faturas emitidas e lançamentos faturados são
imutáveis por desenho (inclusive contra `DELETE`); a limpeza exige tarefa própria
com sessão privilegiada. Além dos IDs abaixo existem: folhas e lançamentos das operações
A1, A2 e B1; vigências (contrato A a partir de 01/12, diária individual 999,00 do
colaborador 4); município 4208203, local da operação A1, coberturas 2026 e três feriados
sintéticos; a conta `mfa` (fator removido) e a conta `op2` (sem uso).

- `clA`: `76313ccf-9503-42f4-8745-7b4708fee4f4`
- `clB`: `37c4b132-24ce-4431-b643-0cf74bc85e49`
- `ctA`: `6369e01d-0859-4fb9-8ce0-7fd1b06f3295`
- `ctB`: `3eb763be-0fb4-4a14-95ea-906073bb5183`
- `e1`: `938d1068-0f28-4788-afa1-a3c376793eb4`
- `e2`: `cdbcdd89-5c4f-429d-9fd5-a879cee316c9`
- `e3`: `1680891d-3ded-4de2-ad51-b6ad8fcad74f`
- `opA1`: `d5b2ded2-4a0a-44ac-822b-da17362e1cc6`
- `opA2`: `237a0ab7-30f1-448c-9a60-e0b9b8a49e1d`
- `opB1`: `bbfd01ab-7dd5-4d61-826f-c7ce3b43ccba`
- `shDia`: `2f62b858-8f12-4bec-bf3f-65358e29af87`
- `shNoite`: `6db57b4f-9dd9-4ec7-ba57-c9d81b30aa05`
- `shDiaA2`: `67cbc773-70ac-460c-8ec2-ac479f27b3cc`
- `shDiaB1`: `72430989-1ce5-4c42-8ef4-c950043c56f9`
- `e4`: `383b4301-08e6-4937-96a1-ec509f8bbe41`
- `e5`: `71e1f72a-9711-49cc-b51c-9805322fc379`
- `fn1`: `ba0f1e78-0faa-4431-9402-07c11f9d3173`
- `indRate999`: `f3c0f4db-ec43-448c-90f2-db14e326e31e`
- `cS1`: `d91391e6-dd8c-4f1e-973d-4a8625a4871e`
- `cS1key`: `97eac365-2a2c-40e6-9a34-e16780ab8c7d`
- `cS2`: `d543b1c6-5d4d-4027-8df6-76ce7b001241`
- `cS3`: `d4277b02-87a1-4de9-a80a-44f3bf296bb8`
- `cS4`: `decb0076-22de-47c1-b8a7-ca1d6d505b9c`
- `cS4b`: `6e26ab79-cbcf-4777-a862-2d2d38f1802a`
- `cS6`: `d668bc24-58c5-44ab-ae74-11b3c2893cc9`
- `cS5`: `8fb3442d-7cc6-40d6-94c6-656897e1fe77`
- `invA`: `88cfeb04-6cf2-4cf7-8c69-90f43e7d6cf2`
- `invB`: `940ebf67-1618-4c12-860e-3ce85415d349`
- `invAid`: `88cfeb04-6cf2-4cf7-8c69-90f43e7d6cf2`
- equipes (`operation_team`): `a5eb7d24-1f19-49d9-a830-af62d63f7ebf`, `988d5492-9de3-4a9b-8593-9afacdd047aa`, `0d764ce5-a886-4d63-9d87-498cc9cb80ff`, `71d98146-6314-450c-90e3-78d853bb49e9`, `e49aba7b-6006-400b-be43-7f3072f5c8c2`
- turno avulso a limpar (08:00–08:00): `1b6a0451-3135-4e86-8762-a36e8d7d0b0a`
- usuários de auth sintéticos: adm `4e1ff521-e91d-478a-8456-229d5ef554b8`, op `b86cd826-6c7f-41f4-9e49-a642a9f0f67b`, sem `ff78687e-7b1a-4f4b-ae9c-1adbb92e5f6f`, ambos `4f48fc2a-a954-46a3-954e-e4676fa95cfe`, op2 `8c469d0b-ac0c-4ff5-92c0-a383258d1ba7`, mfa `14367631-514f-408a-a466-da4315ee9dc2`
