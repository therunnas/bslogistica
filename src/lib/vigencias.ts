/**
 * Contrato das RPCs de vigência financeira, para as telas que vão usá-las (C05-B4.3C).
 *
 * Este módulo NÃO chama nada: só nomeia as funções do banco, descreve os parâmetros e o
 * retorno e fixa o significado dos SQLSTATE. As telas de contratos, colaboradores,
 * operações e a ativação do motor (U3 a U7) entram numa etapa própria e importam daqui.
 *
 * Os nomes dos parâmetros são os do PostgREST (`.rpc(nome, { p_... })`). A suíte
 * `test:motor-vigencia` confere cada nome e cada parâmetro contra as migrations 023, 024 e
 * 025: renomear uma coluna do SQL sem atualizar este arquivo falha lá.
 *
 * Todas exigem administrador, AAL2 e sessão válida; o operacional não executa nenhuma.
 */

export const RPC_VIGENCIAS = {
  contrato: {
    registrar: "registrar_condicao_contrato",
    corrigir: "corrigir_condicao_contrato",
    encerrar: "encerrar_condicao_contrato",
    aposentar: "aposentar_condicao_contrato",
    naData: "condicao_contrato_na_data",
  },
  colaborador: {
    registrar: "registrar_custo_colaborador",
    corrigir: "corrigir_custo_colaborador",
    encerrar: "encerrar_custo_colaborador",
    aposentar: "aposentar_custo_colaborador",
    naData: "custo_colaborador_na_data",
  },
  operacao: {
    registrar: "registrar_valor_acordado_operacao",
    corrigir: "corrigir_valor_acordado_operacao",
    encerrar: "encerrar_valor_acordado_operacao",
    aposentar: "aposentar_valor_acordado_operacao",
    naData: "valor_acordado_operacao_na_data",
  },
  motor: {
    estado: "estado_motor_vigencia",
    pendencias: "pendencias_implantacao_vigencias",
    divergencias: "divergencias_implantacao_vigencias",
    alterar: "alterar_motor_vigencia",
    sincronizarColunas: "sincronizar_colunas_legadas",
    regularizarApontamento: "regularizar_apontamento_legado",
  },
} as const;

/** Datas em `YYYY-MM-DD`. A vigência é o intervalo semiaberto [início, fim). */
export interface ParametrosRegistrarCondicaoContrato {
  p_contract_id: string;
  p_valid_from: string;
  p_daily_rate: number;
  p_shift_hours: number;
  p_ot_factor: number;
  p_ot_tolerance_min: number;
  p_reason: string;
  p_valid_to?: string | null;
  /** Fecha a versão aberta anterior na data de início da nova. */
  p_encerrar_anterior?: boolean;
}

export interface ParametrosCorrigirCondicaoContrato {
  p_term_id: string;
  p_valid_from: string;
  p_valid_to: string | null;
  p_daily_rate: number;
  p_shift_hours: number;
  p_ot_factor: number;
  p_ot_tolerance_min: number;
  p_reason: string;
}

export interface ParametrosRegistrarCustoColaborador {
  p_employee_id: string;
  p_valid_from: string;
  p_daily_cost: number;
  p_reason: string;
  p_valid_to?: string | null;
  p_encerrar_anterior?: boolean;
}

export interface ParametrosRegistrarValorAcordadoOperacao {
  p_operation_id: string;
  p_valid_from: string;
  p_agreed_amount: number;
  p_reason: string;
  p_valid_to?: string | null;
  p_encerrar_anterior?: boolean;
}

export interface ParametrosEncerrarVigencia {
  p_term_id: string;
  p_valid_to: string;
  p_reason: string;
}

export interface ParametrosAposentarVigencia {
  p_term_id: string;
  p_reason: string;
}

/** Liga ou desliga o motor por vigência. Desligar ressincroniza as colunas antigas. */
export interface ParametrosAlterarMotor {
  p_ativar: boolean;
  p_reason: string;
  /** Ligar com cadastros em uso sem vigência hoje exige confirmação explícita. */
  p_aceitar_pendencias?: boolean;
}

export interface ParametrosRegularizarApontamento {
  p_entry_id: string;
  p_reason: string;
  /** `false` (padrão) só devolve a prévia; nada é gravado. */
  p_aplicar?: boolean;
}

export interface EstadoDoMotor {
  ativo: boolean;
  ativada_em: string | null;
  alterado_em: string;
  motivo: string | null;
  /** As chaves de trigger estão como a linha de configuração diz? Falso = intervenção manual. */
  consistente: boolean;
}

export interface PendenciaDeImplantacao {
  tipo: "contrato" | "colaborador" | "operacao_sem_contrato";
  id: string;
  nome: string;
}

export interface ResultadoDaRegularizacao {
  aplicado: boolean;
  fonte: "versao" | "valor_acordado";
  antes: Record<string, unknown>;
  depois: Record<string, unknown>;
}

/** Significado dos SQLSTATE financeiros (a mensagem em português vem do banco). */
export const CODIGOS_FINANCEIROS = {
  /** Sem vigência na data: registre a vigência com motivo; não há fallback para a taxa atual. */
  semVigencia: "P0002",
  /** Estado que não permite a ação: legado, fonte ambígua, vínculo congelado, motor já ligado... */
  estadoInvalido: "55000",
  /** Período sobrepõe outra versão ativa. */
  sobreposicao: "23P01",
  /** Parâmetro inválido: motivo vazio, intervalo vazio, casas decimais demais. */
  parametroInvalido: "22023",
  /** Regra de validação ou turno com apontamentos (congelamento da jornada). */
  regraDeValidacao: "23514",
  /** Sem permissão: não é admin, AAL1, sessão inválida, ou apontamento faturado. */
  permissao: "42501",
  /** Sessão não autenticada. */
  semSessao: "28000",
} as const;
