"use server";

import { criarClienteServidor } from "@/integrations/supabase/server";
import { ErroDeAutorizacaoAdministrativa, exigirAdminAal2 } from "@/lib/admin-usuarios/autorizacao";
import {
  MENSAGEM_ATIVACAO_DESABILITADA,
  MENSAGEM_REVERSAO_DESABILITADA,
  VARIAVEL_DE_ATIVACAO,
  VARIAVEL_DE_REVERSAO,
  ativacaoHabilitada,
  desligarMotorDeVigencia,
  ligarMotorDeVigencia,
  reversaoHabilitada,
  type ResultadoDaAtivacao,
  type ResultadoDaReversao,
} from "@/lib/ativacao-motor";

/**
 * Liga o motor por vigência (C05-B8.6). A única escrita da tela de implantação.
 *
 * `exigirAdminAal2()` vem ANTES de qualquer consulta: quem não é administrador com acesso liberado
 * (o que, para admin, é sempre AAL2) recebe a recusa sem que o banco seja tocado. Depois disso, a
 * RPC roda com o cliente da SESSÃO (cookies do próprio admin): o JWT dele é o que o banco avalia,
 * e `alterar_motor_vigencia` repete admin + AAL2 por dentro e grava a trilha. Não há `service_role`
 * aqui, nem identidade vinda do cliente.
 *
 * Depois da autorização e ANTES de criar o cliente do banco, a trava de servidor decide se a janela
 * de ativação está aberta (C05-B8.12). Fechada é o padrão: ocultar o botão não bastaria, porque a
 * Server Action é uma rota que qualquer admin autenticado pode chamar.
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

  if (!ativacaoHabilitada(process.env[VARIAVEL_DE_ATIVACAO])) {
    return { ok: false, codigo: "desabilitada", mensagem: MENSAGEM_ATIVACAO_DESABILITADA };
  }

  const supabase = await criarClienteServidor();
  return ligarMotorDeVigencia(
    { rpc: (nome, argumentos) => supabase.rpc(nome as never, argumentos as never) },
    entrada,
  );
}

/**
 * Desliga o motor por vigência (RB-01): a reversão da ativação, pelo mesmo caminho seguro.
 *
 * Mesma ordem da ativação: `exigirAdminAal2()` primeiro; depois a trava de servidor PRÓPRIA da
 * reversão (`BS_REVERSAO_MOTOR_HABILITADA`, fechada por padrão); só então o cliente da SESSÃO
 * (JWT do próprio admin) chama `alterar_motor_vigencia(false, ...)`. Sem `service_role`, sem
 * identidade vinda do cliente.
 */
export async function desligarMotorAction(entrada: {
  motivo: unknown;
  confirmacao: unknown;
}): Promise<ResultadoDaReversao> {
  try {
    await exigirAdminAal2();
  } catch (erro) {
    if (erro instanceof ErroDeAutorizacaoAdministrativa) {
      return {
        ok: false,
        codigo: "nao-autorizado",
        mensagem: "Desligar o motor exige administrador com segundo fator.",
      };
    }
    throw erro;
  }

  if (!reversaoHabilitada(process.env[VARIAVEL_DE_REVERSAO])) {
    return { ok: false, codigo: "desabilitada", mensagem: MENSAGEM_REVERSAO_DESABILITADA };
  }

  const supabase = await criarClienteServidor();
  return desligarMotorDeVigencia(
    { rpc: (nome, argumentos) => supabase.rpc(nome as never, argumentos as never) },
    entrada,
  );
}
