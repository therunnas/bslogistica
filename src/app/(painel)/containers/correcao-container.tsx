"use client";

import Link from "next/link";
import { caminhoDoAvulsoAntigo } from "@/lib/container-servico-ui";
import { useEffect, useState } from "react";
import { loteParaCorrecao } from "@/lib/container-servico-dados";
import type { LoteDeContainers } from "@/lib/container-servico";
import { capacidadeCorrecaoContainerAction, carregarContainerAction } from "./_acoes";
import { FormularioContainer } from "./formulario-container";

/**
 * Correção de serviço de containers (049): só serviço disponível e com o banco anunciando a correção.
 * O formulário é o mesmo do registro, pré-preenchido com os dados atuais do serviço.
 */
export function CorrecaoDoContainer({ id }: { id: string }) {
  const [correcao, setCorrecao] = useState<{ servicoId: string; lote: LoteDeContainers } | null>(
    null,
  );
  const [mensagem, setMensagem] = useState("");
  const [substituidoPor, setSubstituidoPor] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    async function carregar() {
      try {
        const [capacidade, detalhe] = await Promise.all([
          capacidadeCorrecaoContainerAction(),
          carregarContainerAction(id),
        ]);
        if (!ativo) return;
        if (!capacidade.ok || capacidade.data !== true) {
          setMensagem("A correção de serviço não está disponível neste banco.");
          return;
        }
        if (!detalhe.ok) {
          setMensagem(detalhe.mensagem);
          return;
        }
        if (detalhe.data.substituidoPor) {
          setSubstituidoPor(detalhe.data.substituidoPor);
          return;
        }
        if (detalhe.data.servico.situacao !== "disponivel") {
          setMensagem("Só um serviço disponível para faturamento pode ser corrigido.");
          return;
        }
        setCorrecao({ servicoId: id, lote: loteParaCorrecao(detalhe.data) });
      } catch {
        if (ativo) setMensagem("Não foi possível carregar o serviço. Tente novamente.");
      }
    }
    void carregar();
    return () => {
      ativo = false;
    };
  }, [id]);
  if (substituidoPor) {
    return (
      <div className="space-y-4">
        <p>Este serviço já foi corrigido. O histórico identifica o substituto.</p>
        <Link className="underline" href={caminhoDoAvulsoAntigo(substituidoPor)}>
          Abrir serviço corrigido
        </Link>
      </div>
    );
  }
  if (correcao) return <FormularioContainer correcao={correcao} />;
  return (
    <div className="space-y-4">
      <p role={mensagem ? "alert" : "status"}>{mensagem || "Carregando serviço…"}</p>
      <Link className="underline" href={caminhoDoAvulsoAntigo(id)}>
        Voltar para o serviço
      </Link>
    </div>
  );
}
