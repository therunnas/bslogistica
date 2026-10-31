import { Scale } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import type { CodigoDeConciliacao, FechamentoData } from "@/lib/fechamento/tipos";
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
 * Composição financeira e conciliação com o banco (migration 030).
 *
 * Só exibe. A receita é a soma de parcelas que o banco já calculou; a conciliação compara essa
 * soma com `resumo_financeiro_periodo`, a mesma fonte de Dashboard e Relatórios. Uma diferença
 * aparece como "Não confere" — nenhum valor é ajustado para as telas coincidirem.
 */

const ROTULO_DA_CONCILIACAO: Record<CodigoDeConciliacao, string> = {
  apontamentos: "Apontamentos",
  adicionais: "Adicionais de serviço",
  "ajuste-faturado": "Ajuste de arredondamento já faturado",
  "ajuste-previsto": "Ajuste de arredondamento previsto",
  "a-faturar": "A faturar (sem o ajuste previsto)",
  faturado: "Já faturado",
};

function Cabecalho({ titulo, descricao }: { titulo: string; descricao: string }) {
  return (
    <CardHeader className="border-b border-border px-5 py-4">
      <CardTitle className="text-sm font-semibold tracking-tight">{titulo}</CardTitle>
      <p className="mt-1 text-xs text-muted-foreground">{descricao}</p>
    </CardHeader>
  );
}

export function ConciliacaoDoFechamento({ dados }: { dados: FechamentoData }) {
  const f = dados.financeiro;
  const composicao: [string, string][] = [
    ["Apontamentos", moeda(f.apontamentosCentavos)],
    ["Adicionais de serviço", moeda(f.adicionaisCentavos)],
    ["Ajuste de arredondamento já faturado", moeda(f.ajusteFaturadoCentavos)],
    ["Ajuste de arredondamento previsto", moeda(f.ajustePrevistoCentavos)],
    ["Receita total", moeda(f.receitaCentavos)],
  ];

  return (
    <div className="mb-6 space-y-6">
      <Card className={CARTAO}>
        <CardHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/[0.06] text-primary"
              aria-hidden="true"
            >
              <Scale className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold tracking-tight">
                Composição da receita e conciliação
              </CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                Valores previstos (sem fatura), faturados e ajustes, conferidos com o resumo
                financeiro do banco. Nada é corrigido aqui: uma diferença é apenas sinalizada.
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 p-5">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {composicao.map(([rotulo, valor]) => (
              <div key={rotulo} className="min-w-0">
                <dt className="text-[11px] font-medium text-muted-foreground">{rotulo}</dt>
                <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">
                  {valor}
                </dd>
              </div>
            ))}
          </dl>

          <div className="overflow-x-auto">
            <Table>
              <TableCaption className="sr-only">
                Comparação de cada parcela do Fechamento com o resumo financeiro do banco.
              </TableCaption>
              <TableHeader>
                <TableRow className={CABECALHO_DA_TABELA}>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Parcela
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                    Fechamento
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                    Banco
                  </TableHead>
                  <TableHead scope="col" className={TITULO_DA_COLUNA}>
                    Situação
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dados.conciliacao.map((item) => (
                  <TableRow key={item.codigo} className="border-border">
                    <TableCell className="text-sm">{ROTULO_DA_CONCILIACAO[item.codigo]}</TableCell>
                    <TableCell className={CELULA_NUMERICA}>
                      {moeda(item.fechamentoCentavos)}
                    </TableCell>
                    <TableCell className={CELULA_NUMERICA}>{moeda(item.bancoCentavos)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(
                          "rounded-md",
                          item.confere
                            ? "border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                            : "border-destructive/40 text-destructive",
                        )}
                      >
                        {item.confere ? "Confere" : "Não confere"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {dados.adicionais.length > 0 ? (
        <Card className={CARTAO}>
          <Cabecalho
            titulo="Adicionais de serviço"
            descricao="Valores extras do período, separados da diária. Entram na receita; não têm custo."
          />
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">Adicionais de serviço do período.</TableCaption>
                <TableHeader>
                  <TableRow className={CABECALHO_DA_TABELA}>
                    <TableHead scope="col" className={TITULO_DA_COLUNA}>
                      Período
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA}>
                      Descrição
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA}>
                      Situação
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Valor
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dados.adicionais.map((a) => (
                    <TableRow key={a.id} className="border-border">
                      <TableCell className="whitespace-nowrap text-sm">
                        {dateBR(a.inicio)} – {dateBR(a.fim)}
                        {/* Competência de cobrança (038): pode ser diferente da execução. */}
                        {a.competenciaInicio && a.competenciaFim ? (
                          <p className="text-xs text-muted-foreground">
                            Cobrança: {dateBR(a.competenciaInicio)} – {dateBR(a.competenciaFim)}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-sm">
                        {a.descricao}
                        {a.referencia !== null ? (
                          <span className="text-muted-foreground"> · ref. {a.referencia}</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {a.faturaId === null ? "A faturar" : "Já faturado"}
                      </TableCell>
                      <TableCell className={CELULA_NUMERICA}>{moeda(a.valorCentavos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dados.ajustesAcumulados.length > 0 || dados.ajustesFaturados.length > 0 ? (
        <Card className={CARTAO}>
          <Cabecalho
            titulo="Arredondamento acumulado de horas extras"
            descricao="Contratos que acumulam os minutos do período antes de arredondar. O ajuste previsto é o que a fatura vai trazer; o faturado já está em fatura."
          />
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  Ajuste do arredondamento acumulado por colaborador.
                </TableCaption>
                <TableHeader>
                  <TableRow className={CABECALHO_DA_TABELA}>
                    <TableHead scope="col" className={TITULO_DA_COLUNA}>
                      Colaborador
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Minutos no período
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Arredondado
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Valor-hora
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Ajuste previsto
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dados.ajustesAcumulados.map((a) => (
                    <TableRow
                      key={`${a.employeeId}-${a.valorHoraCentavos}`}
                      className="border-border"
                    >
                      <TableCell className="text-sm">{a.colaborador}</TableCell>
                      <TableCell className={CELULA_NUMERICA}>{horas(a.minutosBrutos)}</TableCell>
                      <TableCell className={CELULA_NUMERICA}>
                        {horas(a.minutosArredondados)}
                      </TableCell>
                      <TableCell className={CELULA_NUMERICA}>
                        {moeda(a.valorHoraCentavos)}
                      </TableCell>
                      <TableCell className={CELULA_NUMERICA}>{moeda(a.ajusteCentavos)}</TableCell>
                    </TableRow>
                  ))}
                  {dados.ajustesFaturados.map((a) => (
                    <TableRow key={`${a.faturaId}-${a.descricao}`} className="border-border">
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        Já faturado — {a.descricao}
                      </TableCell>
                      <TableCell className={CELULA_NUMERICA}>{moeda(a.valorCentavos)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {dados.saldoDeHoras.length > 0 ? (
        <Card className={CARTAO}>
          <Cabecalho
            titulo="Saldo de horas (informativo)"
            descricao="Horas excedentes e faltantes à jornada de referência, em apontamentos com entrada e saída. Compensação entre dias é só informação: não altera nenhum valor."
          />
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableCaption className="sr-only">
                  Saldo de horas por colaborador, sem efeito financeiro.
                </TableCaption>
                <TableHeader>
                  <TableRow className={CABECALHO_DA_TABELA}>
                    <TableHead scope="col" className={TITULO_DA_COLUNA}>
                      Colaborador
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Apontamentos
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Excedentes
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Faltantes
                    </TableHead>
                    <TableHead scope="col" className={TITULO_DA_COLUNA_NUMERICA}>
                      Saldo
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dados.saldoDeHoras.map((s) => (
                    <TableRow key={s.employeeId} className="border-border">
                      <TableCell className="text-sm">{s.colaborador}</TableCell>
                      <TableCell className={CELULA_NUMERICA}>{s.apontamentos}</TableCell>
                      <TableCell className={CELULA_NUMERICA}>
                        {horas(s.minutosExcedentes)}
                      </TableCell>
                      <TableCell className={CELULA_NUMERICA}>{horas(s.minutosFaltantes)}</TableCell>
                      <TableCell className={CELULA_NUMERICA}>
                        {s.saldoMinutos < 0 ? "-" : ""}
                        {horas(Math.abs(s.saldoMinutos))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
