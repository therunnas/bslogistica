# Homologação integrada FIN-PR-11/12/13

Plano de execução no HML `qbnfcmrxmssnwkhaitgd`, schema 045. O PR #100 foi
mergeado em `91513b91b11461ac48d8dfe6af118234bfb6fbc0`. **A sessão 12 executou a
matriz em HML (17 PASS, 8 PARCIAL, 2 BLOQUEADO) e a sessão 13 fechou os casos
possíveis (ver "Resultados da execução" e "Sessão 13"): 25 PASS, 1 PARCIAL (A05),
1 BLOQUEADO (E06), 0 FAIL; a sessão 14 fechou A05 e E06 (27 PASS, com as ressalvas
de cada linha).** Isso **não** encerra a homologação funcional: faltam a revisão
humana, a confirmação dos modelos de e-mail do Dashboard e as decisões comerciais.

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

| ID  | Resultado | Evidência resumida                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A01 | PASS      | Admin acessa `/dashboard` e `/fechamento` (200); sem sessão 307 para `/login`; logout global faz o token antigo ler 0 clientes; credencial inválida recusada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| A02 | PASS      | Sem fator: AAL1 lê dados e acessa o app. Com fator: senha sozinha lê 0 linhas, RPC admin recusada, app 307 para `/mfa`; TOTP inválido recusado, válido libera sem novo código. Fator removido ao fim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| A03 | PASS      | Operacional vê só a operação atribuída; zero campo financeiro nas 4 RPCs de leitura; operação alheia recusada; chave extra gera `22023`; 9 tabelas de negócio com 0 linhas; rotas financeiras mostram "Área administrativa restrita"; APIs de Fechamento/XLSX não geram arquivo.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A04 | PASS      | Sem papel: 0 linhas, RPC recusada, telas "Acesso não liberado"; token forjado 401; anon sem dados; admin+operacional decide como admin e não usa a superfície operacional.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A05 | PASS      | Aplicação (sessões 12 e 14): último admin protegido; papel e auditoria pela interface; recuperação com e sem MFA (um TOTP). **Sessão 14, stack local isolada com caixa de e-mail capturada (sem destinatário real):** pedido público em `/esqueci-senha` (resposta neutra) gera e-mail com link `/auth/confirm`; duas visitas de "scanner" não consomem (303 + cookie `httpOnly` de 300 s); "Continuar" valida, a senha muda e o link não pode ser reutilizado; convite pela tela Usuários cria conta, perfil e papel (convite capturado); primeiro acesso do convidado pelo "Esqueci minha senha" (entra com o menu operacional). **Dependências não verificadas:** modelos de e-mail e SMTP do Dashboard de HML/Production e o tempo de expiração do link. |
| B01 | PASS      | Operações ligadas ao contrato do próprio cliente; nome obrigatório, contrato de outro cliente, colaborador em duas equipes, função duplicada e diária negativa recusados.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B02 | PASS      | OFF (sessão 12): vigência 250,00 de 01/12; fonte congelada; diária individual não altera a cobrança. ON (sessão 13): tarifa padrão operador/diurno 220,00 → 22000 c; noturno 260,00 → 26000 c; tarifa conferente 300,00 de 10/11 a 12/11 (fim exclusivo): 10 e 11 → 30000 c, 09, 12 e 13 recusados; individual 280,00 desde 16/11 vence a tarifa (13/11 → 22000, 16 e 17/11 → 28000); individual 999,00 → 99900 c; contrato sem fonte recusado; lançamento OFF e linhas faturadas inalterados.                                                                                                                                                                                                                                                               |
| C01 | PASS      | Presença 200,00/80,00; falta 0/0; substituição 200,00/90,00; entrada = saída recusada sem gravação parcial; noturno 22:00–07:00 (480 min) cobra 200,00 e custa 100,00.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| C02 | PASS      | HE de 0, 10, 15, 16, 45, 46, 75, 76 e 120 min: cobra 0, 0, 30, 30, 60, 60, 90, 90 e 120 min; custo separado e zerado abaixo da tolerância; saída antecipada proporcional (150,00/60,00). Regra 15/45 do `ESTADO_DO_PROJETO.md` — ver achado A.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| C03 | PASS      | OFF (sessão 12): classificação com cobertura e pendência sem cobertura. ON (sessão 13): sábado 38500 c (220,00 + 4 h × 41,25); domingo 08/11 → 44000 c e custo 16000 c; domingo parcial de 240 min → 22000 c; feriados nacional, estadual e municipal → 44000 c; feriado com 600 min → 55000 c (sem HE comum); domingo que é feriado (15/11) → 44000 c, fator uma vez, tipo `feriado`; operação sem local recusada.                                                                                                                                                                                                                                                                                                                                          |
| C04 | PASS      | Com a resolução ON: base 22000 + HE 4125 = 26125 c; adicional 25,00 → 28625 c (HE continua 4125, custo inalterado); salvar de novo preserva; duplicação sem confirmação recusada; substituição para 30,00 → 29125 c; trilha com motivo; também em domingo (44000 + 1500). Com OFF o banco recusa (`55000`).                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| C05 | PASS      | Navegador (sessão 13): erro de gravação (saída = entrada) bloqueia o Salvar e mantém o rascunho do outro colaborador (HE 1h00, R$ 237,50); corrigido, grava 200,00/80,00 e 237,50/101,25; "Fechar dia" fecha a folha (botão vira "Reabrir"), reabrir volta a `open`. Banco (sessão 12): escrita em folha fechada recusada, operacional recusado, linha faturada imutável.                                                                                                                                                                                                                                                                                                                                                                                    |
| D01 | PASS      | Admin: lista, detalhe e novo respondem 200; operacional: restrito na UI, `registrar`/`cancelar` recusados e 0 linhas nas 3 tabelas de container. Renderização client não inspecionada.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D02 | PASS      | Serviço de 450,00 (receita) e 250,00 (custo por pessoa 100,00 + 150,00); adicional de 450,00 com competência 01–15/10; trilha `registered` com motivo; lista/detalhe 200.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D03 | PASS      | Rateio 100,00 + 200,01 do total de 300,01 soma exata; total divergente recusado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D04 | PASS      | Navegador: `?operacao=` válido pré-seleciona Cliente A e Operação A1; inválido mostra o alerta "operação de origem não está disponível" sem pré-seleção; repetido não pré-seleciona; validação de formulário mostrou o alerta de data de solicitação e quantidade; envio válido persistiu. O banco recusa operação de outro cliente.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D05 | PASS      | Mesma chave e payload no banco: +1 serviço, +1 adicional, +1 trilha; payload diferente com a mesma chave dá `23505`. Navegador: duplo clique em "Confirmar registro" gerou exatamente 1 serviço, 1 adicional e 1 trilha.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D06 | PASS      | Quantidade zero, centavo fracionário, participante repetido, soma divergente, mesmo dia, campo desconhecido e competência invertida recusados; contagens de serviços, adicionais e trilhas inalteradas.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D07 | PASS      | Cancelar exige motivo, cancela serviço e adicional juntos, é imutável depois e preserva `registered`+`canceled`; o adicional não cancela isolado; correção = cancelar + novo; serviço faturado não cancela (`55000`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D08 | PASS      | Fatura mista (cliente A) e fatura só de Containers (cliente B, 800,00/300,00): cada serviço aparece uma vez; serviço executado em 16/10 com competência 1ª quinzena entrou na fatura da 1ª; vínculos e custo corretos; repetir a emissão é recusado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D09 | PASS      | Custo só em visões internas: exportação do cliente sem custo/margem; operacional restrito; auditoria preservada; detalhe interno mostra custo por participante sem estado de pagamento e o Excel interno diz que os valores são previstos e não representam pagamento realizado.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| E01 | PASS      | 1ª quinzena: apontamentos 2.862,50 + containers 920,01 = receita 3.782,51; soma por colaborador = apontamentos; conciliação confere; faltas fora das diárias; 2ª quinzena: 662,50 + 150,00 = 812,50 (serviço de competência 1ª não entra).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| E02 | PASS      | Fatura 3.782,51; 13 diárias; 7 h; 7 itens somam o total; custo 1.781,64 (apontamentos 1.151,63 + containers 630,01 uma vez); depois da emissão a faturar = 0; janelas fora da frequência e repetição recusadas; linha/adicional/fatura faturados imutáveis.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E03 | PASS      | Microsoft Excel real (via AppleScript): abas, colunas, datas dd/mm/aaaa, moeda R$, fórmula `=SUBTOTAL(109;…)` e AutoFilter ativo. Filtros reais: colaborador 2 → 4 linhas, 856,25; operação A2 → 200,00; tipo do dia Sábado → 350,00 e 4,00 h; datas 12–15/10 → 9 linhas, 1.682,50 e 3,00 h. O total fixo permaneceu 3.782,51 em todos os filtros.                                                                                                                                                                                                                                                                                                                                                                                                           |
| E04 | PASS      | Excel real: HE total 7,00 h = 420 min. Caso de arredondamento acumulado (cliente B, 3 × 10 min): linhas 0,17 h cada, SUBTOTAL de horas 0,51 e total fixo 0,50 (30 min somados antes da conversão), dinheiro igual em ambos (928,13, com ajuste de −0,01). Cliente sem custo/resultado/margem; descrição `=HYPERLINK(...)` e referência `@SUM(...)` abertas como texto, sem fórmula.                                                                                                                                                                                                                                                                                                                                                                          |
| E05 | PASS      | Sem sessão e operacional sem arquivo; JSON inválido, corpo incompleto e assinatura adulterada sem arquivo; assinatura vencida após mudança de dados recusada; nova assinatura exporta.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| E06 | PASS      | Planilha Dynamis localizada em `~/Downloads` (duas cópias idênticas, SHA-256 `2b211d4c39f0f0f803a774e70d96cd71e16fc944dcf105d2de063591820018f7`), lida sem copiar para o repositório. Estrutura, fórmulas e totais conferidos; diferenças contra o V2 explicadas por componente e regra (ver "Sessão 14"). **Não** declara paridade financeira nem usa R$ 35.118,12 como esperado do V2.                                                                                                                                                                                                                                                                                                                                                                     |

### Achados

- **A (resolvido, documentação).** `docs/ARQUITETURA.md` descrevia o arredondamento
  diário da HE como "até 15 descarta; 16 a 45 vira 30; 46 a 59 vira a hora seguinte",
  divergente do núcleo V2. A regra V2 aprovada é 15 min = 30 min e 45 min = 60 min de
  HE; o texto foi corrigido na sessão 13 e o núcleo não foi alterado. O C02 é PASS por
  essa regra.
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

## Sessão 13 (05/11/2026)

**Resolução comercial:** estava OFF e a 045 confirmada (50 migrations); backup novo de
dados de `public` antes. Ligada em HML (`alterar_resolucao_tarifas`, aceitando os
contratos sem tarifa), usada em B02, C03 e C04 e **restaurada para OFF**, confirmado em
`pricing_settings.tarifas_por_funcao = false`. As tarifas padrão do contrato A e a
diária individual ficam cadastradas e inativas enquanto OFF.
**Pré-condições vistas com a resolução ON:** turno com período diurno/noturno
classificado; operação com local e coberturas; contrato sem tarifa recusa apontamento.
**Navegador:** Chrome com o app local ligado ao HML, contas descartáveis `s11-nav*`.
**Excel:** Microsoft Excel instalado, controlado por AppleScript; um travamento da
automação (provável diálogo modal) exigiu reiniciar o aplicativo; não é falha do arquivo.

### Achados adicionais

- **G (P4).** No Dashboard, o cartão de margem por cliente do cliente B mostra receita
  R$ 928,14, enquanto o Fechamento e o total do Dashboard usam 928,13 (o ajuste de
  arredondamento acumulado de −0,01 fica fora do cartão por cliente).
- **H (observação).** `valid_to` das tarifas é exclusivo (`[)`): uma tarifa de 10 a
  12/11 cobre 10 e 11, não o dia 12. A interface deve deixar isso claro ao cadastrar.

### Dados sintéticos adicionais (limpeza posterior)

Serviço de Containers criado pela interface `63f0686b-61d8-444d-acca-3d42817e54fb`
(com adicional e trilha); folha de 18/11 da operação A1; vigência acumulada do
contrato B desde 01/11 e três lançamentos do colaborador 5 (03 a 05/11); tarifas
padrão do contrato A (operador diurno `e7d77278-33bc-46dd-be1f-5507ac7d95c0`,
noturno `8d228f66-3530-43e7-98a6-a96eef0a20c9`, conferente
`421e4c2b-1bb7-4386-8c5d-37076ce200ee`); diária individual do colaborador 1 desde
16/11; feriados de novembro (nacional 02 e 15, estadual 04, municipal 05); local da
operação A2; contas `s11-navadm` e `s11-navop` (senhas rotacionadas). Fator MFA da
conta `mfa` removido. Nada de Production foi tocado.

## Sessão 14 (05/11/2026)

### A05 — convite e recuperação em ambiente isolado

Stack Supabase **local** (`project_id` e portas próprios, migrations 001–045, Mailpit de captura)
com o app ligado a ela; recipientes `@exemplo.invalid`. O modelo de e-mail de recuperação
local aponta para `/auth/confirm?token_hash=…&type=recovery`, que é o contrato do app; o
modelo real do Dashboard não é versionado e **não foi verificado**. O convite usou o modelo
padrão do Supabase: o link passa por `/auth/v1/verify`, **consome o token no GET** e
redireciona ao `/login` com os tokens no fragmento da URL, sem abrir sessão no app. Por isso
o primeiro acesso do convidado só se completa pelo "Esqueci minha senha". Se o modelo real
do Dashboard for o padrão, o link do convite fica exposto a leitores automáticos de e-mail
(achado J). Uso da Admin API na homologação não alterou o fluxo: o pedido público, o e-mail
e o link reais foram exercitados separadamente.

### E06 — planilha Dynamis (referência comercial, não regra)

Arquivo com uma aba (`Dynamis`), duas tabelas (`Tabela1` A6:K183 e `Tabela2` com os totais) e
um segmentador. Cabeçalho: Data, Quinzena, Mês, Colaborador, Função, Entrada, Saída, Diária,
Adicional, H.Extra, Total. Período **31/08/2022 a 14/09/2022** (dados históricos de 2022, não
existem no HML). 141 lançamentos (36 linhas da tabela estão vazias), 14 colaboradores,
funções Conferente, Ajudante, Serviços Gerais e Operador, diárias de R$ 210 a R$ 260.

- **Totais armazenados** (conferidos por soma independente): diárias R$ 33.050,00, adicionais
  R$ 0,00, hora extra R$ 2.068,125, total R$ 35.118,125 (o "R$ 35.118,12").
- **Fórmula da hora extra:** `SE(Saída <= Entrada + 10 h; 0; (INT(excedente em h) + SE(min < 15;
0; SE(min < 45; 0,5; 1))) × Diária ÷ 8 × 1,5)`. Recalculada linha a linha, reproduz os 141
  valores armazenados (zero divergência). **O arredondamento 15/45 é o mesmo do núcleo V2.**
  Fator 1,5 e divisor 8 também coincidem.
- **Diferenças de regra contra o V2** (componentes): (1) a referência de hora extra é **10 h de
  presença** (sem intervalo informado), e o V2 usa **8 h líquidas** mais o intervalo do turno;
  (2) a diária é **integral mesmo com saída antecipada** (62 de 141 linhas têm menos de 10 h de
  presença), e o V2 paga proporcional; (3) **sábado** (26 linhas) e **domingo** (13 linhas) são
  pagos como dia útil, e o V2 usa referência de 4 h no sábado e minutos × diária × 2 ÷ 480 no
  domingo/feriado (com a resolução ligada); (4) a diária é uma coluna por linha, sem vigência,
  função/período ou snapshot; (5) tolerância: a planilha não tem, o contrato V2 tem; (6) o
  total da planilha é uma soma simples, sem ajuste de arredondamento acumulado.
- **Simulação V2 sobre as mesmas linhas** (premissa explícita: intervalo de 120 min, para que 10
  h de presença sejam 8 h líquidas; **o arquivo não informa intervalo**): dias úteis R$ 25.570,68
  (diária proporcional R$ 23.716,25 + HE R$ 1.854,43), sábados R$ 10.801,43, domingos
  R$ 1.415,30, total ≈ R$ 37.787,41, ou seja ≈ R$ 2.669 acima do arquivo. A diferença vem
  principalmente de sábados (hora extra após 4 h) e é reduzida pelos domingos e pela
  proporcionalidade. É uma **explicação por componente, não uma conciliação**.
- **Conciliação estrita** (`npm run conciliar:fin-pr-13`) **não foi executada**: ela exige um
  Fechamento do mesmo cliente e período dentro do sistema, e os dados de 2022 não existem
  no HML. Nenhuma paridade financeira é declarada.

### Achados

- **G (resolvido como explicação, sem alteração de código).** O Dashboard soma, por cliente,
  o valor **por linha** (3 × R$ 309,38 = R$ 928,14), sem o ajuste de arredondamento
  acumulado (−R$ 0,01) e sem os adicionais de serviço. O Fechamento e o total do Dashboard
  usam `resumo_financeiro_periodo`, que arredonda a soma de 30 min uma vez (R$ 28,13) e inclui
  o ajuste: R$ 928,13. O centavo vem de arredondar 9,375 por linha (9,38 × 3 = 28,14) contra
  arredondar 28,125 uma vez (28,13). Nenhuma fatura foi afetada, e nenhum cálculo está errado:
  o cartão por cliente é uma soma de apontamentos, não a receita consolidada.
- **I (corrigido no [PR #104](https://github.com/therunnas/bslogistica/pull/104), mergeado em `071ea6d`).** A margem do Dashboard usa a receita total (inclui adicionais
  de serviço e Containers) contra um **custo que só soma os apontamentos**; o custo de Containers
  não entra. A margem do período fica superestimada quando há Containers. Não corrigido: depende
  de decisão da BS sobre onde exibir o custo de Containers.
- **H (corrigido em PR separado).** Rótulos de vigência de tarifas e diárias individuais agora
  dizem "(fim exclusivo)".
- **J (dependência).** O modelo de e-mail do convite pode consumir o link no GET (ver acima).

## Sessão 15 (05/11/2026)

- **Achado I:** o Dashboard e os Relatórios agora somam o custo dos serviços de Containers
  (`cost_total_cents` do serviço, não cancelados, executados no período, sem duplicar o custo por
  participante) ao custo do período. Reprodução no HML (novembro): custo R$ 2.327,18 → R$ 2.367,18,
  margem R$ 4.643,15 → R$ 4.603,15, receita inalterada (R$ 6.970,33). O cartão "Margem por cliente"
  passou a dizer que é só de apontamentos, o que também explica o centavo do achado G. Fatura,
  custo persistido, Fechamento e migrations não mudaram. Mesma classe, fora deste PR: a prévia de
  margem do Faturamento e o Fechamento ainda mostram custo só de apontamentos (a fatura emitida
  já inclui os Containers).
- **Achado H:** PR #102 mergeado (`b63d33b`).
- **Achado J, configuração real de Auth lida** (somente leitura): ver
  [plano de Production](../runbooks/producao-034-045.md), seção 1.2. O conteúdo dos modelos de e-mail
  e a expiração continuam dependendo do administrador do Supabase.

## Sessão 16 (05/11/2026)

- **PR #104 mergeado (`071ea6d`).** A revisão de compatibilidade com o schema 034 achou um defeito real:
  num banco **restaurado do backup de Production**, para a tabela ausente o PostgREST responde GET com
  404/`PGRST205` mas o HEAD de contagem com **204 sem erro e `count` nulo**; o paginador lançava
  `CONTAGEM_INVALIDA` e o Dashboard mostraria "custo de Containers indisponível" em Production. Corrigido
  com sondagem prévia, com teste RED/GREEN, antes do merge.
- **Margem do Fechamento e da prévia do Faturamento (PR #105, aberto).** Definições: custo de apontamentos,
  custo de Containers (`cost_total_cents` do serviço não cancelado do adicional do recorte), custo total e
  margem total = receita total − custo total (igual ao `total_cost` da fatura). No HML (cliente A, 1ª quinzena
  de outubro): Fechamento e Faturamento mostravam custo R$ 1.151,63 e margem R$ 2.630,88; a fatura emitida
  guardou custo R$ 1.781,64 (margem R$ 2.000,87). Medido em PostgREST real: 034 → custo 0; 045 → R$ 550,01 nos
  dois adicionais ativos (cancelado fora).
- **Backup:** restaurado de novo a partir dos arquivos cifrados, com Auth funcional (login, MFA, recuperação com
  e sem TOTP). `auth.one_time_tokens`: os 3 tokens pendentes de Production **só não restauravam por diferença
  de versão do GoTrue** (falta da coluna `expires_at` no local); com a coluna criada, voltam todos.
  Privilégios: o dump não reemite os `REVOKE`; restaurar em destino com privilégios padrão deixa `anon`,
  `authenticated` e `service_role` com `ALL`. Procedimento de reconciliação em
  [backup-production.md](../runbooks/backup-production.md).
- **E-mail:** [checklist](../runbooks/checklist-email-supabase.md) para a conferência manual; DNS do domínio de
  envio conferido por leitura (DKIM, SPF de retorno e DMARC publicados).
- **Ensaio 034 → 045** sobre o banco restaurado e parecer **NO-GO condicional** em
  [producao-034-045.md](../runbooks/producao-034-045.md), seções 5.1 e 11.
