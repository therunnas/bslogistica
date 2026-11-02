# Calendário territorial — fontes oficiais

SDLC: Requisitos / Design. Pesquisa pública conferida em **02/11/2026** para
2026, 2027 e 2028. Este inventário subsidia a revisão do calendário; não é carga
SQL, declaração de cobertura completa nem autorização de ativação.

## Critérios de uso

- Separar feriado legal de ponto facultativo, recesso escolar e ausência de
  expediente forense. A [Lei federal 9.093/1995][N4] exige lei municipal para
  feriados religiosos, incluída a Sexta-Feira da Paixão.
- Portarias e decretos de expediente da administração pública comprovam seu
  próprio calendário. Sua classificação não prova, isoladamente, aplicação a
  toda empresa privada. A lei instituidora e sua vigência precisam ser conferidas.
- **Toda data municipal depende de conferência do cliente antes da ativação**,
  inclusive quando existe publicação oficial anual. Conferir município real da
  execução, lei instituidora, alterações, transferências e ano.
- Fonte permanente para data fixa não equivale a calendário anual completo.
  Para 2027/2028, não foram localizados nesta consulta os atos anuais dos seis
  municípios nem o calendário anual federal/estadual correspondente. Isso não
  constitui prova de inexistência de publicação.
- Não calcular Páscoa, Carnaval, Paixão, Corpus Christi ou Divino para preencher
  lacunas de anos futuros. Campo sem data confirmada permanece pendente; não
  significa dia comum nem ausência de feriado.
- Registrar data civil local `YYYY-MM-DD`; UF e código IBGE são identidade
  territorial. A sede do cliente não substitui o local da execução.
- Para revisão/carga futura, guardar por ocorrência: data, nome, âmbito, UF,
  código IBGE municipal quando aplicável, ano, lei/ato, URL oficial, data da
  consulta, situação da evidência e aprovação do cliente. O status deste documento
  qualifica a pesquisa e não altera dados operacionais ou financeiros.

## Territórios e API oficial reutilizável

Identidades confirmadas por resposta JSON da [API do IBGE][I1] nesta consulta,
além da tabela oficial de [códigos de municípios][I2]. Santa Catarina: **UF SC,
código IBGE 42**. As seis localidades são municípios de SC, não estados.

| Município          | UF  | Código IBGE municipal | Consulta oficial individual                                                    |
| ------------------ | --- | --------------------- | ------------------------------------------------------------------------------ |
| Itajaí             | SC  | 4208203               | [IBGE](https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4208203) |
| Navegantes         | SC  | 4211306               | [IBGE](https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4211306) |
| Balneário Camboriú | SC  | 4202008               | [IBGE](https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4202008) |
| Brusque            | SC  | 4202909               | [IBGE](https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4202909) |
| Barra Velha        | SC  | 4202107               | [IBGE](https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4202107) |
| Ilhota             | SC  | 4207106               | [IBGE](https://servicodados.ibge.gov.br/api/v1/localidades/municipios/4207106) |

A [documentação de localidades][I1] permite expansão nacional sem lista fechada:

| Finalidade                | Endpoint `GET` do IBGE                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------ |
| UFs brasileiras           | `https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome`                 |
| UF por identificador      | `https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}`                         |
| Municípios de qualquer UF | `https://servicodados.ibge.gov.br/api/v1/localidades/estados/{UF}/municipios?orderBy=nome` |
| Todos os municípios       | `https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome`              |
| Município por código      | `https://servicodados.ibge.gov.br/api/v1/localidades/municipios/{municipio}`               |

Validar o vínculo município/UF retornado pela API. A API fornece geografia,
**não feriados nem cobertura legal**. A consulta conjunta dos seis códigos e a
consulta da UF 42 responderam com sucesso; não foi necessário autenticar.

## Feriados nacionais de data fixa

Âmbito de todas as linhas: **nacional**; UF: **todas**; IBGE municipal: **não se
aplica**. Cada coluna anual identifica uma ocorrência candidata distinta.
N1 é o texto atualizado da Lei 662/1949, com a redação da Lei 10.607/2002.

| Nome                                         | Data em 2026 | Data em 2027 | Data em 2028 | Lei / URL oficial verificada    | Status por ano                                                                      |
| -------------------------------------------- | ------------ | ------------ | ------------ | ------------------------------- | ----------------------------------------------------------------------------------- |
| Confraternização Universal                   | 2026-01-01   | 2027-01-01   | 2028-01-01   | Lei 662/1949, art. 1º — [N1]    | 2026: base legal conferida; 2027/2028: fonte permanente, conferência anual pendente |
| Tiradentes                                   | 2026-04-21   | 2027-04-21   | 2028-04-21   | Lei 662/1949, art. 1º — [N1]    | Mesmo status acima                                                                  |
| Dia do Trabalho                              | 2026-05-01   | 2027-05-01   | 2028-05-01   | Lei 662/1949, art. 1º — [N1]    | Mesmo status acima                                                                  |
| Independência do Brasil                      | 2026-09-07   | 2027-09-07   | 2028-09-07   | Lei 662/1949, art. 1º — [N1]    | Mesmo status acima                                                                  |
| Nossa Senhora Aparecida                      | 2026-10-12   | 2027-10-12   | 2028-10-12   | Lei 6.802/1980, art. 1º — [N2]  | Mesmo status acima                                                                  |
| Finados                                      | 2026-11-02   | 2027-11-02   | 2028-11-02   | Lei 662/1949, art. 1º — [N1]    | Mesmo status acima                                                                  |
| Proclamação da República                     | 2026-11-15   | 2027-11-15   | 2028-11-15   | Lei 662/1949, art. 1º — [N1]    | Mesmo status acima                                                                  |
| Dia Nacional de Zumbi e da Consciência Negra | 2026-11-20   | 2027-11-20   | 2028-11-20   | Lei 14.759/2023, art. 1º — [N3] | Mesmo status acima                                                                  |
| Natal                                        | 2026-12-25   | 2027-12-25   | 2028-12-25   | Lei 662/1949, art. 1º — [N1]    | Mesmo status acima                                                                  |

O calendário federal de 2026 está na Portaria MGI 11.460/2025, identificada no
[catálogo oficial][N5] e no [acervo da ANA][N6]. O catálogo de 2026 registra a
Portaria MGI **8.821/2026**, que altera a anterior: conferir a versão vigente
antes de importar também seus pontos facultativos ([N7]). Não se presume que o
texto original represente sozinho todo o calendário administrativo atualizado.

## Santa Catarina: transferência legal

A [Lei estadual 18.531/2022, Anexo Único][S1], consolidada na ALESC, conserva as
regras de transferência para o domingo subsequente quando 11/08 ou 25/11
coincidem com dia útil. Portanto, não ativar automaticamente as datas nominais
como feriados em terça a sexta-feira. Conferir a redação vigente e materializar a
data efetiva na revisão anual. A Lei 10.306/1996 e alterações são antecedentes;
não usar somente a lei histórica como se fosse o texto vigente consolidado.

| Nome                                         | Datas nominais / anos              | Âmbito                                            | UF  | IBGE municipal | Lei / URL oficial verificada                                                                  | Status                                                                                                        |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------- | --- | -------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Dia do Estado de Santa Catarina / data magna | 2026-08-11; 2027-08-11; 2028-08-11 | Estadual                                          | SC  | Não se aplica  | Lei 18.531/2022, Anexo Único, agosto; origens 12.906/2004 e 13.408/2005 — [S1]                | Fonte permanente conferida; transferência obrigatória quando útil; data efetiva e conferência anual pendentes |
| Dia de Santa Catarina de Alexandria          | 2026-11-25; 2027-11-25; 2028-11-25 | Estadual, candidato sob revisão de aplicabilidade | SC  | Não se aplica  | Lei 18.531/2022, Anexo Único, novembro; origens 10.306/1996, 11.213/1999 e 12.906/2004 — [S1] | Regra de transferência localizada; não ativar data nominal; aplicabilidade e conferência anual pendentes      |

O [Decreto estadual 1.374/2026][S2], alterado pelo 1.768/2026, trata do Executivo
estadual e reitera a transferência de 11/08. Não estender pontos facultativos do
Estado às empresas. O texto consolidado de S1 contém também a regra de 25/11;
sua ausência em uma lista administrativa simplificada não resolve a aplicabilidade
comercial. A Lei 17.388/2017 institui a semana alusiva à santa; não é evidência
suficiente de revogação da regra presente na consolidação.

## Candidatos municipais — 2026

Todas as linhas têm âmbito **municipal**, UF **SC** e ano **2026**. Nenhuma está
aprovada para ativação. `Cliente pendente` exige confirmação do cliente, além das
pendências de evidência especificadas. A lista não declara cobertura completa.

| Município / IBGE             | Data candidata | Nome                                | Lei / ato indicado                                                                                 | URL oficial verificada | Status                                                                                                             |
| ---------------------------- | -------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Itajaí / 4208203             | 2026-06-04     | Corpus Christi                      | Lei municipal 2.863/1993, identificada pelo TRF4 e pela prefeitura                                 | [M1], [M2]             | Referência oficial de 2026; íntegra e vigência municipal a conferir; cliente pendente                              |
| Itajaí / 4208203             | 2026-06-15     | Dia do Município                    | Lei municipal 2.863/1993                                                                           | [M1], [M2]             | Referência oficial de 2026; íntegra e vigência municipal a conferir; cliente pendente                              |
| Navegantes / 4211306         | 2026-02-02     | Nossa Senhora dos Navegantes        | Lei municipal 544/1985, citada no Decreto 497/2023; calendário TJSC de 2026                        | [M3], [M4]             | Base histórica e referência de 2026; conferir ato anual municipal e vigência; cliente pendente                     |
| Navegantes / 4211306         | 2026-06-04     | Corpus Christi                      | Lei municipal 544/1985, citada no Decreto 497/2023; data de 2026 em N6                             | [M3], [N6]             | Candidato: lei histórica referenciada; ato anual municipal de 2026 não conferido integralmente; cliente pendente   |
| Navegantes / 4211306         | 2026-08-26     | Emancipação do Município            | Lei municipal 544/1985, citada no Decreto 497/2023; calendário TJSC de 2026                        | [M3], [M4]             | Base histórica e referência de 2026; conferir ato anual municipal e vigência; cliente pendente                     |
| Balneário Camboriú / 4202008 | 2026-02-17     | Carnaval                            | Decreto 13.000/2026, art. 1º, II, remete à Lei municipal 3.351/2011                                | [M5]                   | PDF oficial lido; base legal permanente e alterações a conferir; cliente pendente                                  |
| Balneário Camboriú / 4202008 | 2026-06-04     | Corpus Christi                      | Decreto 13.000/2026, art. 1º, VIII; Lei municipal 3.351/2011 referenciada                          | [M5]                   | PDF oficial lido; base legal permanente e alterações a conferir; cliente pendente                                  |
| Balneário Camboriú / 4202008 | 2026-07-20     | Emancipação político-administrativa | Decreto 13.000/2026, art. 1º, X; Lei municipal 3.351/2011 referenciada                             | [M5]                   | PDF oficial lido; base legal permanente e alterações a conferir; cliente pendente                                  |
| Brusque / 4202909            | 2026-02-16     | Carnaval                            | Decretos 10.561/2026 e alteração 10.562/2026, art. 1º, II                                          | [M6], [M7], [M8]       | PDFs oficiais lidos: segunda é feriado municipal, terça é ponto facultativo; lei instituidora e cliente pendentes  |
| Brusque / 4202909            | 2026-04-03     | Paixão de Cristo                    | Decreto 10.561/2026, art. 1º, IV; Lei municipal 1.811/1993 referenciada                            | [M6]                   | PDF oficial classifica como municipal; íntegra e vigência da lei e cliente pendentes                               |
| Brusque / 4202909            | 2026-06-04     | Corpus Christi                      | Lei municipal 1.811/1993, identificada no calendário TRF4 de 2026                                  | [M1], [M6]             | Referência de 2026; conferir íntegra e vigência da lei; cliente pendente                                           |
| Brusque / 4202909            | 2026-08-04     | Dia do Município                    | Lei municipal 1.811/1993, identificada no calendário TRF4 de 2026                                  | [M1], [M6]             | Referência de 2026; conferir íntegra e vigência da lei; cliente pendente                                           |
| Barra Velha / 4202107        | 2026-05-25     | Festa do Divino Espírito Santo      | Decreto municipal 2.319, de 22/12/2025, citado na Portaria TJSC 005/2026-DF                        | [M9]                   | Referência judicial identifica feriado municipal; íntegra municipal e lei instituidora pendentes; cliente pendente |
| Barra Velha / 4202107        | 2026-12-07     | Emancipação política                | Decreto municipal 2.319, de 22/12/2025, citado na Portaria TJSC 005/2026-DF                        | [M9]                   | Referência judicial identifica feriado municipal; íntegra municipal e lei instituidora pendentes; cliente pendente |
| Ilhota / 4207106             | 2026-06-04     | Corpus Christi                      | Decreto 14/2026, anexo na alteração 235/2026                                                       | [M10]                  | Anexo oficial lido; lei instituidora pendente; cliente pendente                                                    |
| Ilhota / 4207106             | 2026-06-21     | Aniversário do Município            | Decreto 14/2026, anexo na alteração 235/2026; antecedente 696/2021 cita Leis 278/1978 e 1.918/2018 | [M10], [M11]           | Anexo oficial lido; vigência da lei instituidora pendente; cliente pendente                                        |

## Ocorrências móveis e classificações que não autorizam carga automática

| Data / ano                 | Nome                                                                           | Âmbito da evidência                                                                    | UF / IBGE municipal                     | Ato / URL oficial verificada                           | Status para uso financeiro                                                                               |
| -------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| 2026-04-03                 | Paixão de Cristo                                                               | Calendário federal administrativo; enquadramento religioso municipal na Lei 9.093/1995 | Todas / município precisa ser definido  | Portaria MGI 11.460/2025 e Lei 9.093/1995 — [N6], [N4] | Não tratar como feriado privado nacional só por essa portaria; lei de cada município e cliente pendentes |
| 2026-02-16 e 2026-02-17    | Carnaval                                                                       | Federal administrativo                                                                 | Todas / não se aplica                   | Portaria MGI 11.460/2025 — [N6]                        | Ponto facultativo federal; as exceções municipais candidatas acima exigem sua própria base               |
| 2026-02-18                 | Quarta-Feira de Cinzas                                                         | Federal administrativo                                                                 | Todas / não se aplica                   | Portaria MGI 11.460/2025 — [N6]                        | Ponto facultativo parcial; não carregar como feriado                                                     |
| 2026-06-04                 | Corpus Christi                                                                 | Federal administrativo                                                                 | Todas / não se aplica                   | Portaria MGI 11.460/2025 — [N6]                        | Ponto facultativo federal; verificar lei municipal para cada local                                       |
| 2026-06-04                 | Corpus Christi                                                                 | Calendário forense de Barra Velha                                                      | SC / 4202107                            | Portaria TJSC 005/2026-DF, Resolução GP 01/1985 — [M9] | Identificado como dia sem expediente forense, não como feriado municipal; não ativar por essa evidência  |
| 2026-10-13                 | Dia do Professor antecipado                                                    | Escolar de Balneário Camboriú                                                          | SC / 4202008                            | Decreto 13.634/2026, confirmação oficial — [M12]       | Restrito à rede de ensino; não carregar como feriado comercial municipal                                 |
| 2026-10-30                 | Dia do Servidor Público; em Ilhota, comemoração unificada com Dia do Professor | Administração municipal de BC e Ilhota                                                 | SC / 4202008 e 4207106                  | Decreto 13.634/2026 e Decreto 235/2026 — [M12], [M10]  | Ponto facultativo; não carregar como feriado                                                             |
| Sem data confirmada / 2027 | Carnaval, Cinzas, Paixão, Corpus Christi e Divino                              | Federal / estadual / municipal a confirmar                                             | Brasil / SC / respectivos códigos acima | Ato anual do território não localizado nesta consulta  | Pendente; nenhuma data inferida                                                                          |
| Sem data confirmada / 2028 | Carnaval, Cinzas, Paixão, Corpus Christi e Divino                              | Federal / estadual / municipal a confirmar                                             | Brasil / SC / respectivos códigos acima | Ato anual do território não localizado nesta consulta  | Pendente; nenhuma data inferida                                                                          |

O Decreto 13.000/2026 original de BC contém uma linha de Páscoa e classificações
administrativas amplas. Não usar sua enumeração para criar feriados nacionais.
As alterações posteriores devem ser confrontadas no ato vigente. Calendários
judiciais também incluem feriados exclusivamente forenses; sua coluna
“nacional” não substitui a legislação geral aplicável às operações da BS.

## Datas fixas municipais — referências para 2027 e 2028

Todas são **candidatas, pendentes de ato/conferência anual, vigência da lei e
conferência do cliente antes da ativação**. São recorrências de datas fixas das
fontes indicadas, não comprovação de cobertura oficial dos anos futuros.
Âmbito: municipal; UF: SC. Datas móveis não são preenchidas nesta tabela.

| Município / IBGE             | Nome                                | Data candidata / ano 2027 | Data candidata / ano 2028 | Lei / ato e URL oficial de referência                                  |
| ---------------------------- | ----------------------------------- | ------------------------- | ------------------------- | ---------------------------------------------------------------------- |
| Itajaí / 4208203             | Dia do Município                    | 2027-06-15                | 2028-06-15                | Lei 2.863/1993 identificada em [M1], [M2]                              |
| Navegantes / 4211306         | Nossa Senhora dos Navegantes        | 2027-02-02                | 2028-02-02                | Lei 544/1985 identificada em [M3]                                      |
| Navegantes / 4211306         | Emancipação do Município            | 2027-08-26                | 2028-08-26                | Lei 544/1985 identificada em [M3]                                      |
| Balneário Camboriú / 4202008 | Emancipação político-administrativa | 2027-07-20                | 2028-07-20                | Lei 3.351/2011 referenciada no Decreto 13.000/2026 — [M5]              |
| Brusque / 4202909            | Dia do Município                    | 2027-08-04                | 2028-08-04                | Lei 1.811/1993 identificada em [M1]                                    |
| Barra Velha / 4202107        | Emancipação política                | 2027-12-07                | 2028-12-07                | Decreto 2.319/2025 identificado em [M9]; lei permanente ainda pendente |
| Ilhota / 4207106             | Aniversário do Município            | 2027-06-21                | 2028-06-21                | Decreto 235/2026 e antecedentes legais identificados em [M10], [M11]   |

## Registro das fontes e limites da verificação

Os links abaixo foram consultados em 02/11/2026. “Lido” refere-se ao conteúdo
obtido nesta pesquisa, não à certificação jurídica de vigência integral. Algumas
páginas falharam no navegador de pesquisa; PDFs de BC, Brusque e Ilhota e a API IBGE
foram obtidos por HTTP e seus conteúdos foram conferidos. Não usar resumos
automáticos do DOM como substituto do PDF assinado.

| ID  | Órgão / documento                                            | Conteúdo efetivamente conferido / limite                                                                                                           |
| --- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| I1  | [IBGE — documentação da API][I1]                             | Documentação lida; respostas da UF 42 e dos seis municípios conferidas por HTTP                                                                    |
| I2  | [IBGE — códigos municipais][I2]                              | Resultado oficial indexado; abertura da tabela retornou 403; identidades confirmadas pela API                                                      |
| N1  | [Câmara — Lei 662/1949 atualizada][N1]                       | Texto atualizado lido, incluindo alteração de 2002                                                                                                 |
| N2  | [Câmara — Lei 6.802/1980][N2]                                | Texto legal lido                                                                                                                                   |
| N3  | [Câmara — Lei 14.759/2023][N3]                               | Texto legal lido                                                                                                                                   |
| N4  | [Câmara — Lei 9.093/1995 atualizada][N4]                     | Texto legal lido                                                                                                                                   |
| N5  | [MGI — catálogo de portarias de 2025][N5]                    | Identificação e link da Portaria 11.460/2025; DOU direto retornou erro de acesso                                                                   |
| N6  | [ANA — acervo da Portaria 11.460/2025][N6]                   | Transcrição oficial consultada, com as datas de 2026                                                                                               |
| N7  | [MGI — catálogo de portarias de 2026][N7]                    | Alteração 8.821/2026 identificada; íntegra da alteração não obtida; pontos facultativos federais exigem revisão                                    |
| S1  | [ALESC — Lei 18.531/2022 consolidada][S1]                    | Anexo de agosto e novembro lido; ambas as regras de transferência localizadas                                                                      |
| S2  | [ALESC — Decreto 1.374/2026 compilado][S2]                   | Calendário administrativo e transferência de 11/08 lidos                                                                                           |
| M1  | [TRF4/JFSC — calendário 2026][M1]                            | Referências às Leis 2.863/1993 de Itajaí e 1.811/1993 de Brusque; finalidade forense                                                               |
| M2  | [Prefeitura de Itajaí — feriados municipais][M2]             | Notícia histórica identifica Lei 2.863/1993; não constitui calendário de 2026                                                                      |
| M3  | [Prefeitura de Navegantes — Decreto 497/2023][M3]            | PDF de 2024 lido, cita Lei 544/1985; não é ato anual de 2026                                                                                       |
| M4  | [TJSC — calendário 2026 / Resolução GP 37][M4]               | Referências municipais de 2026; finalidade forense, não lei instituidora                                                                           |
| M5  | [DOM — BC Decreto 13.000/2026][M5]                           | Registro oficial e PDF integral lidos; remissão à Lei 3.351/2011; conferir alterações posteriores                                                  |
| M6  | [DOM — Brusque Decreto 10.561/2026][M6]                      | Registro e PDF lidos; referência à Lei 1.811/1993 e classificação municipal da Paixão                                                              |
| M7  | [DOM — Brusque alteração 10.562/2026][M7]                    | PDF lido: ato de 13/01, publicado 16/01/2026; metadado 10565 diverge do PDF 10.562; alteração confirma 16/02 feriado municipal e 17/02 facultativo |
| M8  | [Prefeitura de Brusque — Carnaval 2026][M8]                  | Notícia oficial de 11/02/2026 confirma fechamento por feriado e ponto facultativo em 16/17 de fevereiro                                            |
| M9  | [TJSC — Barra Velha Portaria 005/2026-DF][M9]                | PDF lido; separa feriado municipal, forense e ausência de expediente; cita Decreto municipal 2.319/2025                                            |
| M10 | [DOM — Ilhota Decreto 235/2026][M10]                         | Registro e PDF com anexo anual lidos; alteração do Decreto 14/2026; PDF datado 06/10, publicado 07/10/2026                                         |
| M11 | [Prefeitura de Ilhota — Decreto 696/2021][M11]               | PDF histórico obtido por HTTP; identifica antecedentes 278/1978 e 1.918/2018; não prova sozinho calendário de 2026                                 |
| M12 | [Prefeitura de BC — alteração de expediente em outubro][M12] | Notícia oficial confirma Decreto 13.634/2026, ponto facultativo e distinção do feriado escolar                                                     |

Para liberar cobertura, obter as íntegras municipais pendentes e alterações,
conciliar cada território/ano, registrar aprovação do cliente e só então preparar
uma carga revisável. A falta de fonte municipal confirmada deve permanecer
visível como pendência de cobertura.

[I1]: https://servicodados.ibge.gov.br/api/docs/localidades
[I2]: https://www.ibge.gov.br/explica/codigos-dos-municipios.php
[N1]: https://www2.camara.leg.br/legin/fed/lei/1940-1949/lei-662-6-abril-1949-347136-normaatualizada-pl.html
[N2]: https://www2.camara.leg.br/legin/fed/lei/1980-1987/lei-6802-30-junho-1980-357065-publicacaooriginal-1-pl.html
[N3]: https://www2.camara.leg.br/legin/fed/lei/2023/lei-14759-21-dezembro-2023-795091-publicacaooriginal-170522-pl.html
[N4]: https://www2.camara.leg.br/legin/fed/lei/1995/lei-9093-12-setembro-1995-348594-normaatualizada-pl.html
[N5]: https://www.gov.br/gestao/pt-br/acesso-a-informacao/institucional/atos-normativos/2025/2025-portarias
[N6]: https://biblioteca.ana.gov.br/sophia_web/acervo/detalhe/112312
[N7]: https://www.gov.br/gestao/pt-br/acesso-a-informacao/institucional/atos-normativos/2026/2026-portarias
[S1]: https://leis.alesc.sc.gov.br/ato-normativo/21721
[S2]: https://leis.alesc.sc.gov.br/ato-normativo/53811/compilado
[M1]: https://www.trf4.jus.br/trf4/controlador.php?acao=calendario_feriados_listar&selOrgao=3
[M2]: https://biblioteca.itajai.sc.gov.br/noticia/25303/itajai-nao-decreta-ponto-facultativo-entre-corpus-christi-e-aniversario-do-municipio
[M3]: https://navegantes.sc.gov.br/wp-content/uploads/2024/07/Feriados-2024.pdf
[M4]: https://busca.tjsc.jus.br/dje-consulta/rest/diario/caderno?cdCaderno=4&edicao=4744
[M5]: https://static.dom.sc.gov.br/?id=7975080&r=site/atoView
[M6]: https://static.dom.sc.gov.br/?id=7887774&r=site/atoView
[M7]: https://static.dom.sc.gov.br/?id=7904063&r=site/atoView
[M8]: https://www.brusque.sc.gov.br/cidadao/noticia/confira-como-sera-o-atendimento-dos-servicos-municipais-na-segunda-e-tercafeira-16-e-17
[M9]: https://www.tjsc.jus.br/documents/d/tjsc/portaria_2026005-pdf-1
[M10]: https://static.dom.sc.gov.br/?id=8782390&r=site/atoView
[M11]: https://ilhota.sc.gov.br/wp-content/uploads/2021/12/2046353_DECRETO_N_696_DE_10_DE_FEVEREIRO_DE_2021.pdf
[M12]: https://www.bc.sc.gov.br/noticia/44669
