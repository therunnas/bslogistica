import { Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ehSomenteFalta, horas, margem, moeda } from "@/lib/fechamento/apresentacao";
import type { FechamentoData } from "@/lib/fechamento/tipos";
import { cn } from "@/lib/utils";

import {
  CABECALHO_DA_TABELA,
  CARTAO,
  CELULA_NUMERICA,
  TITULO_DA_COLUNA,
  TITULO_DA_COLUNA_NUMERICA,
} from "./_estilos";

/**
 * Por colaborador. Cada célula é um campo pronto de `FechamentoData`: o total
 * da última linha vem do `consolidado` do próprio modelo, e não de uma soma
 * feita aqui.
 */

const COLUNAS_NUMERICAS = [
  "Diárias",
  "Valor das diárias",
  "Horas extras cobradas",
  "Valor das horas extras",
  "Ajuste de arredondamento",
  "Custo previsto",
  "Já faturado",
  "A faturar",
  "Total cobrado",
  "Resultado",
  "Margem",
] as const;

export function TabelaPorColaborador({ dados }: { dados: FechamentoData }) {
  return (
    <Card className={cn("mb-6", CARTAO)}>
      <CardHeader className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary"
            aria-hidden="true"
          >
            <Users className="h-4 w-4" />
          </div>

          <div>
            <CardTitle className="text-sm font-semibold tracking-tight">Por colaborador</CardTitle>

            <p className="mt-1 text-xs text-muted-foreground">
              Diárias, horas extras, custo previsto e valores cobrados de cada colaborador.
              Resultado e margem daqui consideram só os apontamentos; adicionais e o ajuste entram
              no resumo.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table className="min-w-[80rem]">
            <TableCaption className="sr-only">
              Resumo financeiro por colaborador, com total do período na última linha.
            </TableCaption>

            <TableHeader>
              <TableRow className={CABECALHO_DA_TABELA}>
                <TableHead scope="col" className={cn(TITULO_DA_COLUNA, "min-w-44")}>
                  Colaborador
                </TableHead>

                <TableHead scope="col" className={TITULO_DA_COLUNA}>
                  Função
                </TableHead>

                {COLUNAS_NUMERICAS.map((coluna) => (
                  <TableHead key={coluna} scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                    {coluna}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>

            <TableBody>
              {dados.colaboradores.map((c) => {
                const somenteFalta = ehSomenteFalta(c);

                return (
                  <TableRow
                    key={c.employeeId}
                    className={cn(
                      "border-border transition-colors hover:bg-secondary/20",
                      somenteFalta && "text-muted-foreground",
                    )}
                  >
                    <TableCell className="py-3">
                      <p className="text-sm font-medium text-foreground">{c.nome}</p>

                      {c.faltas > 0 || c.substituicoes > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.faltas > 0 ? (
                            <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[11px]">
                              {somenteFalta
                                ? `Somente falta${c.faltas > 1 ? "s" : ""} (${c.faltas})`
                                : `Falta${c.faltas > 1 ? "s" : ""}: ${c.faltas}`}
                            </Badge>
                          ) : null}

                          {c.substituicoes > 0 ? (
                            <Badge variant="outline" className="rounded-md px-1.5 py-0 text-[11px]">
                              Substituto: {c.substituicoes}
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>

                    <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                      {c.funcao}
                    </TableCell>

                    <TableCell className={CELULA_NUMERICA}>{c.consolidado.diarias}</TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(c.consolidado.diariaCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {horas(c.consolidado.minutosExtrasCobrados)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(c.consolidado.extraCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(c.ajusteAcumuladoCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(c.consolidado.custoCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(c.jaFaturado.faturadoCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(c.aFaturar.faturadoCentavos)}
                    </TableCell>
                    <TableCell className={cn(CELULA_NUMERICA, "font-semibold text-foreground")}>
                      {moeda(c.consolidado.faturadoCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(c.consolidado.resultadoCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {margem(c.consolidado.margemPermil)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>

            <TableFooter>
              <TableRow className="border-border bg-secondary/40 font-semibold hover:bg-secondary/40">
                <TableCell colSpan={2} className="text-sm text-foreground">
                  Total do período
                </TableCell>

                <TableCell className={CELULA_NUMERICA}>{dados.consolidado.diarias}</TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.consolidado.diariaCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {horas(dados.consolidado.minutosExtrasCobrados)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.consolidado.extraCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.financeiro.ajustePrevistoCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.consolidado.custoCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.jaFaturado.faturadoCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.aFaturar.faturadoCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.consolidado.faturadoCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {moeda(dados.consolidado.resultadoCentavos)}
                </TableCell>
                <TableCell className={CELULA_NUMERICA}>
                  {margem(dados.consolidado.margemPermil)}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
