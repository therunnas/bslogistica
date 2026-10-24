"use server";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { ErroDeAutorizacaoAdministrativa, exigirAdminAal2 } from "@/lib/admin-usuarios/autorizacao";
import { ligarMotorDeVigencia, type ResultadoDaAtivacao } from "@/lib/ativacao-motor";

/**
 * Liga o motor por vigência (C05-B8.6). A única escrita da tela de implantação.
 *
 * `exigirAdminAal2()` vem ANTES de qualquer consulta: quem não é administrador com acesso liberado
 * (o que, para admin, é sempre AAL2) recebe a recusa sem que o banco seja tocado. Depois disso, a
 * RPC roda com o cliente da SESSÃO (cookies do próprio admin): o JWT dele é o que o banco avalia,
 * e `alterar_motor_vigencia` repete admin + AAL2 por dentro e grava a trilha. Não há `service_role`
 * aqui, nem identidade vinda do cliente.
 */
export async function ligarMotorAction(entrada: {
  motivo: unknown;
  confirmacao: unknown;
}): Promise<ResultadoDaAtivacao> {
  try {
    await exigirAdminAal2();
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacaoAdministrativa) {
      return {
        ok: false,
        codigo: "nao-autorizado",
        mensagem: "Ligar o motor exige administrador com segundo fator.",
      };
    }
    throw erro;
  }

  const supabase = await criarClienteServidor();
  return ligarMotorDeVigencia(
    { rpc: (nome, argumentos) => supabase.rpc(nome as never, argumentos as never) },
    entrada,
  );
}
