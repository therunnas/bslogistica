# Homologação integrada FIN-PR-11/12/13

Plano para execução posterior no Preview do PR #100 ligado ao HML
`qbnfcmrxmssnwkhaitgd`, schema esperado 045. **Nenhum caso foi executado no HML
nesta sessão.** Ready, CI e ensaio local não encerram a homologação.

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
**NÃO EXECUTADO**. Não registrar tokens, cookies, documentos pessoais ou senhas.

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
explícita da homologação. O PR #100 permanece Draft enquanto os pré-requisitos
dos gates de Preview/homologação/revisão não estiverem concluídos. Merge exige
autorização própria. Manual e preparação de Production 035–045 vêm depois, com
backup novo, rollback e controle do deploy automático de main.
