"use client";

import {
  ChevronDown,
  Download,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  Loader2,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  baixarXlsx,
  mensagemDoDownload,
  pedeAtualizacao,
  type ModeloDeXlsx,
} from "@/lib/fechamento/download";
import {
  csvDoFechamento,
  nomeDoArquivo,
  ROTULO_DO_FORMATO_DE_CSV,
  SUFIXO_DO_FORMATO_DE_CSV,
  type FormatoDeCsv,
} from "@/lib/fechamento/exportacao";
import { SUFIXO_DO_ARQUIVO_DO_CLIENTE } from "@/lib/fechamento/exportacao-cliente";
import type { FechamentoData } from "@/lib/fechamento/tipos";
import { toast } from "@/lib/notificacoes";

const FORMATOS_DE_CSV: FormatoDeCsv[] = ["colaborador", "diario"];

/** Entrega um Blob ao navegador como download. */
function entregar(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = nome;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Ações de exportação do fechamento exibido.
 *
 * O XLSX é gerado no servidor: daqui só saem o recorte e a assinatura dos dados
 * que a tela mostra. Há dois: o interno (com custo e margem) e o do cliente
 * (modelo Dynamis: lançamentos, serviços avulsos e resumo, sem custo nem
 * margem). O CSV é montado a partir do MESMO `FechamentoData` que a tela
 * exibe (`exportacao.ts`), sem reconsultar nem recalcular.
 */
export function ExportarFechamento({
  dados,
  disponivel,
  onDesatualizado,
}: {
  dados: FechamentoData;
  /** Falso quando não há lançamento financeiro (vazio ou só faltas). */
  disponivel: boolean;
  /** Chamado quando o servidor avisa que os dados mudaram. */
  onDesatualizado: () => void;
}) {
  const [baixando, setBaixando] = useState<ModeloDeXlsx | null>(null);

  async function baixarExcel(modelo: ModeloDeXlsx) {
    if (baixando) return;
    setBaixando(modelo);
    try {
      const blob = await baixarXlsx({
        clienteId: dados.meta.clienteId,
        inicio: dados.meta.inicio,
        fim: dados.meta.fim,
        assinatura: dados.meta.assinatura,
        modelo,
      });
      entregar(
        blob,
        modelo === "cliente"
          ? nomeDoArquivo(dados.meta, "xlsx", SUFIXO_DO_ARQUIVO_DO_CLIENTE)
          : nomeDoArquivo(dados.meta, "xlsx"),
      );
    } catch (erro) {
      toast.error(mensagemDoDownload(erro));
      if (pedeAtualizacao(erro)) onDesatualizado();
    } finally {
      setBaixando(null);
    }
  }

  function baixarCsv(formato: FormatoDeCsv) {
    try {
      const csv = csvDoFechamento(dados, formato);
      entregar(
        new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
        nomeDoArquivo(dados.meta, "csv", SUFIXO_DO_FORMATO_DE_CSV[formato]),
      );
    } catch {
      toast.error("Não foi possível gerar o CSV. Atualize o fechamento e tente novamente.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        className="h-10 rounded-xl"
        disabled={!disponivel || baixando !== null}
        onClick={() => void baixarExcel("interno")}
      >
        {baixando === "interno" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
        )}
        {baixando === "interno" ? "Gerando…" : "Baixar Excel (.xlsx)"}
      </Button>

      <Button
        type="button"
        variant="outline"
        className="h-10 rounded-xl"
        disabled={!disponivel || baixando !== null}
        onClick={() => void baixarExcel("cliente")}
        title="Planilha para conferência do cliente: lançamentos, serviços avulsos e resumo por colaborador, sem custo nem margem."
      >
        {baixando === "cliente" ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        ) : (
          <FileCheck2 className="h-4 w-4" aria-hidden="true" />
        )}
        {baixando === "cliente" ? "Gerando…" : "Excel do cliente (.xlsx)"}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            disabled={!disponivel || baixando !== null}
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Baixar CSV
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Formato do CSV</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {FORMATOS_DE_CSV.map((formato) => (
            <DropdownMenuItem key={formato} onSelect={() => baixarCsv(formato)}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              CSV — {ROTULO_DO_FORMATO_DE_CSV[formato]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
