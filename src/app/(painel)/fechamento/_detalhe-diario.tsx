"use client";

import { CalendarDays, ChevronDown } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { horas, moeda } from "@/lib/fechamento/apresentacao";
import {
  ROTULO_DA_FOLHA,
  ROTULO_DA_SITUACAO_DE_FATURAMENTO,
  ROTULO_DO_STATUS,
  ROTULO_DO_TIPO_DO_DIA,
  type FechamentoData,
} from "@/lib/fechamento/tipos";
import { dateBR } from "@/lib/format";
import { cn } from "@/lib/utils";

import {
  CABECALHO_DA_TABELA,
  CARTAO,
  CELULA_NUMERICA,
  TITULO_DA_COLUNA,
  TITULO_DA_COLUNA_NUMERICA,
} from "./_estilos";

/**
 * Detalhamento diário: uma linha por lançamento que gera valor. As faltas não
 * aparecem aqui (não têm valor); elas estão em "Por colaborador" e nos avisos.
 *
 * Fechado por padrão e mostrado em blocos: um período grande pode ter milhares
 * de linhas, e montá-las todas de uma vez pesaria no navegador. O recorte é só
 * de exibição — os totais não dependem dele.
 */

const TAMANHO_DO_BLOCO = 100;

const COLUNAS_NUMERICAS = [
  "Horas trabalhadas",
  "Excedente (custo)",
  "Horas extras cobradas",
  "Diária",
  "Extra",
  "Cobrado",
  "Custo previsto",
] as const;

export function DetalheDiario({ dados }: { dados: FechamentoData }) {
  const [aberto, setAberto] = useState(false);
  const [visiveis, setVisiveis] = useState(TAMANHO_DO_BLOCO);

  const total = dados.detalhes.length;
  const exibidos = dados.detalhes.slice(0, visiveis);

  return (
    <Card className={CARTAO}>
      <CardHeader className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary"
              aria-hidden="true"
            >
              <CalendarDays className="h-4 w-4" />
            </div>

            <div>
              <CardTitle className="text-sm font-semibold tracking-tight">
                Detalhamento diário
              </CardTitle>

              <p className="mt-1 text-xs text-muted-foreground">
                {total} {total === 1 ? "lançamento" : "lançamentos"} que geram valor no período.
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            aria-expanded={aberto}
            aria-controls="tabela-detalhe-diario"
            onClick={() => setAberto((atual) => !atual)}
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", aberto && "rotate-180")}
              aria-hidden="true"
            />
            {aberto ? "Ocultar detalhamento" : "Mostrar detalhamento"}
          </Button>
        </div>
      </CardHeader>

      {aberto ? (
        <CardContent className="p-0" id="tabela-detalhe-diario">
          <div className="overflow-x-auto">
            <Table className="min-w-[96rem]">
              <TableCaption className="sr-only">
                Lançamentos do período, um por linha, em ordem de data.
              </TableCaption>

              <TableHeader>
                <TableRow className={CABECALHO_DA_TABELA}>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Data
                  </TableHead>
                  <TableHead scope="col" className={cn(TITULO_DA_COLUNA, "min-w-40")}>
                    Colaborador
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Função
                  </TableHead>
                  <TableHead scope="col" className={cn(TITULO_DA_COLUNA, "min-w-40")}>
                    Operação
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Turno
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Status
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Tipo do dia
                  </TableHead>

                  {COLUNAS_NUMERICAS.map((coluna) => (
                    <TableHead key={coluna} scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      {coluna}
                    </TableHead>
                  ))}

                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Situação de faturamento
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Situação da folha
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {exibidos.map((linha) => (
                  <TableRow
                    key={linha.entryId}
                    className="border-border transition-colors hover:bg-secondary/20"
                  >
                    <TableCell className="whitespace-nowrap text-sm">
                      {dateBR(linha.workDate)}
                    </TableCell>
                    <TableCell className="text-sm font-medium text-foreground">
                      {linha.colaborador}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {linha.funcao}
                    </TableCell>
                    <TableCell className="text-sm">{linha.operacao}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {linha.turno}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {ROTULO_DO_STATUS[linha.status]}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {linha.tipoDoDia === null ? "—" : ROTULO_DO_TIPO_DO_DIA[linha.tipoDoDia]}
                    </TableCell>

                    <TableCell className={CELULA_NUMERICA}>
                      {horas(linha.minutosTrabalhados)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>{horas(linha.minutosExtras)}</TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {horas(linha.minutosExtrasCobrados)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>{moeda(linha.diariaCentavos)}</TableCell>
                    <TableCell className={CELULA_NUMERICA}>{moeda(linha.extraCentavos)}</TableCell>
                    <TableCell className={cn(CELULA_NUMERICA, "font-semibold text-foreground")}>
                      {moeda(linha.faturadoCentavos)}
                      {linha.especialCentavos > 0 ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Horas especiais: {moeda(linha.especialCentavos)}
                        </span>
                      ) : null}
                      {linha.adicionalDiarioCentavos > 0 ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          Adicional diário: {moeda(linha.adicionalDiarioCentavos)}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>{moeda(linha.custoCentavos)}</TableCell>

                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "whitespace-nowrap rounded-md",
                          linha.situacaoDeFaturamento === "jaFaturado"
                            ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                            : "border-primary/30 text-primary",
                        )}
                      >
                        {ROTULO_DA_SITUACAO_DE_FATURAMENTO[linha.situacaoDeFaturamento]}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {ROTULO_DA_FOLHA[linha.situacaoDaFolha]}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
            <p className="text-xs text-muted-foreground" role="status">
              Mostrando {exibidos.length} de {total}.
            </p>

            {exibidos.length < total ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl"
                  onClick={() => setVisiveis((atual) => atual + TAMANHO_DO_BLOCO)}
                >
                  Mostrar mais {Math.min(TAMANHO_DO_BLOCO, total - exibidos.length)}
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  className="h-9 rounded-xl"
                  onClick={() => setVisiveis(total)}
                >
                  Mostrar todos
                </Button>
              </div>
            ) : null}
          </div>
        </CardContent>
      ) : null}
    </Card>
  );
}
