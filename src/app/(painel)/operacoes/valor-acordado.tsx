"use client";

import { ValorAtualComAlteracao } from "../_components/valor-atual";
import type { EstadoDoMotorUI } from "@/lib/vigencias-ui";

/** Motivo gravado na trilha quando o valor é alterado por esta tela. */
export const MOTIVO_ALTERACAO_VALOR = "Alteração do valor acordado pela tela da operação";

/**
 * Valor acordado da operação sem contrato: o valor que vale hoje e um "Alterar valor" que só pede o
 * novo valor e a partir de quando (componente comum `ValorAtualComAlteracao`, mesma vigência da
 * operação). O histórico fica recolhido em "Ver histórico", sem um segundo caminho de registro.
 */
export function ValorAcordadoDaOperacao({
  operacaoId,
  estado,
}: {
  operacaoId: string;
  estado: EstadoDoMotorUI;
}) {
  return (
    <ValorAtualComAlteracao
      tipo="operacao"
      entidadeId={operacaoId}
      estado={estado}
      titulo="Valor acordado por diária"
      rotuloDoBotao="Alterar valor"
      motivo={MOTIVO_ALTERACAO_VALOR}
    />
  );
}
