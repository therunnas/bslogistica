"use client";

import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { mensagemDoErro } from "@/lib/erros-banco";
import { useImplantacaoDasVigencias } from "@/lib/vigencias-dados";
import {
  MOTIVO_DA_PENDENCIA,
  ROTA_DO_TIPO,
  ROTULO_DO_TIPO,
  motivoDaDivergencia,
  resumirImplantacao,
  textoDosApontamentosLegados,
  type LinhaDePendencia,
} from "@/lib/vigencias-implantacao";
import { PageHeader } from "../_components/app-shell";

function Tabela({
  titulo,
  linhas,
  motivo,
}: {
  titulo: string;
  linhas: (LinhaDePendencia & { campos?: string[] })[];
  motivo: (l: LinhaDePendencia & { campos?: string[] }) => string;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-base font-semibold">
        {titulo} <Badge variant="secondary">{linhas.length}</Badge>
      </h2>
      {linhas.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum cadastro nesta situação.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo</TableHead>
              <TableHead>Cadastro</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="text-right">Ação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {linhas.map((l) => (
              <TableRow key={`${l.tipo}-${l.id}`}>
                <TableCell>{ROTULO_DO_TIPO[l.tipo]}</TableCell>
                <TableCell className="font-medium">{l.nome || "(sem nome)"}</TableCell>
                <TableCell className="max-w-md text-sm text-muted-foreground">
                  {motivo(l)}
                </TableCell>
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link href={ROTA_DO_TIPO[l.tipo]}>Abrir a tela</Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function PainelImplantacaoVigencias() {
  const consulta = useImplantacaoDasVigencias();

  return (
    <div>
      <PageHeader
        title="Implantação das vigências"
        description="Cadastros que impedem ligar o motor por vigência. Esta tela só consulta: nada é registrado, sincronizado nem ligado aqui."
      />

      {consulta.isPending ? (
        <p className="text-sm text-muted-foreground">Verificando…</p>
      ) : consulta.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Não foi possível consultar a implantação</AlertTitle>
          <AlertDescription>
            {mensagemDoErro(consulta.error)} A ausência de resposta não significa que não haja
            pendências.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {(() => {
            const r = resumirImplantacao(consulta.data.pendencias, consulta.data.divergencias);
            return r.semBloqueios ? (
              <Alert className="mb-6">
                <AlertTitle>Nenhuma pendência nem divergência</AlertTitle>
                <AlertDescription>
                  O banco não encontrou cadastro em uso sem vigência para hoje nem coluna diferente
                  da vigência. Ligar o motor continua sendo ato separado, de administrador com
                  segundo fator e motivo.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert variant="destructive" className="mb-6">
                <AlertTitle>
                  {r.pendentes} sem vigência · {r.divergentes} divergente(s)
                </AlertTitle>
                <AlertDescription>
                  Enquanto houver divergência o banco recusa ligar o motor. Cadastro sem vigência só
                  liga se for aceito de forma explícita, e os apontamentos dele serão recusados.
                </AlertDescription>
              </Alert>
            );
          })()}

          <Tabela
            titulo="Sem vigência para hoje"
            linhas={consulta.data.pendencias}
            motivo={() => MOTIVO_DA_PENDENCIA}
          />
          <Tabela
            titulo="Coluna diferente da vigência"
            linhas={consulta.data.divergencias}
            motivo={(l) => motivoDaDivergencia(l.campos ?? [])}
          />

          <p className="text-sm text-muted-foreground">
            {textoDosApontamentosLegados(consulta.data.legados)}
          </p>
        </>
      )}
    </div>
  );
}
