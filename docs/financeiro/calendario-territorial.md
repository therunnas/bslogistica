# Calendário territorial — FIN-PR-10

SDLC: Desenvolvimento / Testes. Estado de implantação exclusivamente em
[ESTADO_DO_PROJETO.md](../ESTADO_DO_PROJETO.md). Este documento descreve contratos,
não confirma aplicação remota nem autoriza ativação comercial.

## Identidade, evidência e cobertura

`financial_holidays` permanece a única fonte de ocorrências. O âmbito é nacional,
estadual ou municipal, com UF/código IBGE coerentes, norma, URL oficial, status de
verificação, tipo de ocorrência e indicação de móvel. Cada data móvel é ocorrência
anual explícita: não se calcula Páscoa, não se replica feriado no próximo ano e
ponto facultativo nunca integra o especial automaticamente. Cadastros anteriores
à 044 recebem apenas o marcador `legado`, sem reinterpretar sua abrangência.

`municipality_catalog` armazena identidades conferidas pelo administrador a partir
da API do IBGE. O seletor consulta qualquer UF, valida código e vínculo estadual,
e registra a fonte individual canônica. Não usa sede, GPS nem texto livre para
resolver a cidade. Catálogo geográfico não certifica feriados. A migration não
carrega municípios ou feriados reais. As fontes e pendências de 2026–2028 estão em
[calendario-fontes-oficiais.md](calendario-fontes-oficiais.md).

`financial_calendar_coverage` registra conferência anual por âmbito. O calendário
só é confirmado com coberturas nacional, estadual e municipal ativas para o ano e
sem candidato a feriado pendente naquele ano/território. Municipal exige também
conferência do cliente. Ausência de cobertura, local ou confirmação retorna estado
pendente e tipo de dia nulo; não constitui prova de dia comum. Registro e
aposentadoria usam motivo, sessão e auditoria existentes.

## Execução e histórico

`operation_location_terms` vincula explicitamente a operação ao município real em
vigências `[valid_from, valid_to)`, sem sobreposição. Mudança exige nova versão;
não pode atravessar apontamentos com local já congelado. Não há inferência do
endereço do cliente nem exceção livre de localização por payload.

O snapshot territorial do apontamento guarda local, versão, datas civis, IDs das
coberturas/feriados, classificação e segmentação capturada. A derivação ocorre no
banco. Edições autorizadas podem atualizar quantidades da segmentação mantendo
local, fontes e classificações congelados; não consultam o calendário atual para
reprecificar histórico. Registros anteriores permanecem sem backfill. Faturados e
lastro continuam protegidos por triggers, sem exceção administrativa de edição.

Com resolução OFF, o classificador antigo lê somente ocorrências `legado`: novos
cadastros territoriais não contaminam cobrança, custo, classificação ou snapshots
legados. A instalação não muda `pricing_settings`. Com ON, novas presenças exigem
local e calendário confirmado. O cálculo continua no núcleo 035 / integração do
FIN-PR-09; o componente especial é aplicado uma vez, mesmo com sobreposições de
abrangência ou domingo coincidente. Bônus permanece separado.

## Datas civis e intervalo

`segmentar_jornada_civil` identifica a duração bruta em cada data, com a mesma
precisão HH:MM do núcleo 035 (segundos não acrescentam minutos). Com início/fim
do intervalo, desconta a interseção exata; sem esses horários, mantém total líquido
exato e minutos líquidos por segmento desconhecidos, sem rateio inventado.

A superfície atual de apontamentos informa duração do intervalo, não seus
horários. A regra comercial de cobrança por segmentos mistos permanece pendente.
Novas presenças ON atravessando classificações distintas são recusadas com 55000;
a transação não grava cobrança estimada. Jornadas homogêneas usam a regra de
FIN-PR-09 pela data do apontamento. O helper técnico não ativa cálculo financeiro
por segmento nem amplia o payload das cinco RPCs operacionais. O local/horário é
civil da execução; não se infere fuso ou município por geolocalização.

## Compatibilidade, segurança e ensaios

A capacidade `calendario_territorial` é anunciada por `estado_motor_vigencia`.
A interface só consulta estruturas/RPCs novas com essa capacidade confirmada e
só usa a classificação territorial com resolução ON comprovada. Erro de rede não
é ausência de migration nem resolução OFF. O estado do calendário é separado da
capacidade das regras definitivas: carregamento/erro não mostra prévia comum.
Linhas gravadas intactas exibem seus valores congelados.

Novas tabelas permitem somente leitura administrativa sob RLS e piso de MFA.
Escrita é exclusivamente por RPC administrativa com guarda interna; helpers são
revogados da API. Operacional não recebe preço/custo nem nova superfície de
leitura; suas cinco RPCs e grants de coluna permanecem intactos.

As suítes históricas mantêm valores esperados. Quando a 044 existe, suas fixtures
ON declaram local/cobertura sintéticos; o cenário antigo de domingo para segunda
mantém o oráculo na 043 e exige bloqueio de turno misto na 044. Isso não transforma
a fórmula anterior em nova regra de segmentos. A suíte própria testa ausência de
local/cobertura, pendências, abrangência, snapshots e autorização diretamente.

O runner `scripts/testar-calendario-territorial-local.py` exige cópia descartável
exclusiva `bs-fin10-local-<id>`, sem vínculo remoto. Compara catálogo 043/044,
finanças OFF e rollback. Dinheiro, minutos, classificação e fontes não são
normalizados; somente IDs técnicos, metadados voláteis e novos campos territoriais
inexistentes na 043. O ensaio original FIN09 prova também 042/043. Runners possuem
prazos e encerramento dos subprocessos; timeout é falha.

Rollback: [rollback-calendario-territorial.sql](../runbooks/rollback-calendario-territorial.sql).
Só é permitido antes do uso: qualquer catálogo, cobertura, local, ocorrência,
snapshot ou auditoria territorial bloqueia com 55000. Não usa CASCADE nem apaga
histórico. A reversão restaura funções e índice anteriores, preservando dados.
