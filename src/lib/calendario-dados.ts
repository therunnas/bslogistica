import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { criarClienteNavegador } from "@/integrations/supabase/browser";
import { mensagemDoErro } from "@/lib/erros-banco";
import { toast } from "@/lib/notificacoes";
import { lerConsultaPaginada } from "@/lib/paginacao";
import {
  dadosTerritoriais,
  lerCalendarioDaOperacao,
  validarFeriadoTerritorial,
  validarCoberturaTerritorial,
  periodoLocalValido,
  type FormularioTerritorial,
  type Municipio,
} from "./calendario-territorial";

const cliente = () => criarClienteNavegador();
const CHAVE = ["calendario-territorial"] as const;
export function useMunicipios(uf: string) {
  return useQuery({
    queryKey: ["municipios-ibge", uf],
    enabled: uf !== "",
    staleTime: 3_600_000,
    queryFn: async (): Promise<Municipio[]> => {
      const resposta = await fetch(`/api/calendario/municipios?uf=${encodeURIComponent(uf)}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!resposta.ok) throw new Error("IBGE indisponível. Tente novamente.");
      return resposta.json();
    },
  });
}
export function useCalendarioDaOperacao(id: string, data: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE, "operacao", id, data],
    enabled: habilitado && !!id && !!data,
    queryFn: async () => {
      const r = await cliente().rpc("consultar_calendario_operacao", {
        p_operation_id: id,
        p_data: data,
      });
      if (r.error) throw r.error;
      return lerCalendarioDaOperacao(r.data);
    },
  });
}
export function useCoberturas(habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE, "coberturas"],
    enabled: habilitado,
    queryFn: async () => {
      const db = cliente();
      return lerConsultaPaginada(
        ({ depoisDe, limite }) => {
          let q = db.from("financial_calendar_coverage").select("*");
          if (depoisDe) q = q.gt("id", depoisDe);
          return q.order("id").limit(limite);
        },
        () => db.from("financial_calendar_coverage").select("*", { count: "exact", head: true }),
      );
    },
  });
}
/** Catálogo persistido só para rotular o histórico; a seleção continua vindo do IBGE. */
export function useMunicipiosCatalogados(habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE, "municipios-catalogados"],
    enabled: habilitado,
    queryFn: async () => {
      const db = cliente();
      return lerConsultaPaginada(
        ({ depoisDe, limite }) => {
          let q = db.from("municipality_catalog").select("id:code,name,state_code");
          if (depoisDe) q = q.gt("code", depoisDe);
          return q.order("code").limit(limite);
        },
        () => db.from("municipality_catalog").select("code", { count: "exact", head: true }),
      );
    },
  });
}
export function useLocaisDaOperacao(id: string, habilitado: boolean) {
  return useQuery({
    queryKey: [...CHAVE, "locais", id],
    enabled: habilitado && !!id,
    queryFn: async () => {
      const db = cliente();
      return lerConsultaPaginada(
        ({ depoisDe, limite }) => {
          let q = db.from("operation_location_terms").select("*").eq("operation_id", id);
          if (depoisDe) q = q.gt("id", depoisDe);
          return q.order("id").limit(limite);
        },
        () =>
          db
            .from("operation_location_terms")
            .select("*", { count: "exact", head: true })
            .eq("operation_id", id),
      );
    },
  });
}
async function catalogar(m: Municipio | null, motivo: string) {
  if (!m) throw new Error("Selecione um município confirmado pelo IBGE.");
  const r = await cliente().rpc("catalogar_municipio", {
    p_codigo: m.codigo,
    p_nome: m.nome,
    p_uf: m.uf,
    p_fonte_url: m.fonteUrl,
    p_reason: motivo.trim(),
  });
  if (r.error) throw r.error;
}
export type AcaoCalendario =
  | { tipo: "feriado"; formulario: FormularioTerritorial; municipio: Municipio | null }
  | {
      tipo: "cobertura";
      formulario: FormularioTerritorial;
      municipio: Municipio | null;
      ano: number;
    }
  | { tipo: "aposentar-feriado"; id: string; motivo: string }
  | { tipo: "aposentar-cobertura"; id: string; motivo: string }
  | {
      tipo: "local";
      id: string;
      municipio: Municipio | null;
      inicio: string;
      fim: string;
      motivo: string;
      encerrar: boolean;
    };
export function useAlterarCalendario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: AcaoCalendario) => {
      const db = cliente();
      if (a.tipo === "aposentar-feriado" || a.tipo === "aposentar-cobertura") {
        if (!a.motivo.trim()) throw new Error("O motivo é obrigatório.");
        const r = await db.rpc(
          a.tipo === "aposentar-feriado" ? "aposentar_feriado" : "aposentar_cobertura_calendario",
          { p_id: a.id, p_reason: a.motivo.trim() },
        );
        if (r.error) throw r.error;
      } else if (a.tipo === "local") {
        if (!a.motivo.trim() || !periodoLocalValido(a.inicio, a.fim))
          throw new Error("Informe motivo e período válido.");
        await catalogar(a.municipio, a.motivo);
        const r = await db.rpc("registrar_local_operacao", {
          p_operation_id: a.id,
          p_municipality_code: a.municipio!.codigo,
          p_valid_from: a.inicio,
          ...(a.fim ? { p_valid_to: a.fim } : {}),
          p_reason: a.motivo.trim(),
          p_encerrar_anterior: a.encerrar,
        });
        if (r.error) throw r.error;
      } else {
        const f = a.formulario;
        const erros =
          a.tipo === "feriado"
            ? validarFeriadoTerritorial(f)
            : validarCoberturaTerritorial(f, a.ano);
        if (erros.length) throw new Error(erros[0]);
        if (f.ambito === "municipal") await catalogar(a.municipio, f.motivo);
        const dados = dadosTerritoriais(f);
        const r =
          a.tipo === "feriado"
            ? await db.rpc("registrar_feriado_territorial", {
                p_dados: {
                  ...dados,
                  holiday_date: f.data,
                  name: f.nome.trim(),
                  holiday_kind: f.tipo,
                  is_movable: f.movel,
                  verification_status: f.confirmado ? "confirmado" : "pendente",
                },
                p_reason: f.motivo.trim(),
              })
            : await db.rpc("confirmar_cobertura_calendario", {
                p_dados: { ...dados, calendar_year: a.ano },
                p_reason: f.motivo.trim(),
              });
        if (r.error) throw r.error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CHAVE });
      void qc.invalidateQueries({ queryKey: ["feriados"] });
      toast.success("Calendário atualizado. Apontamentos anteriores permanecem congelados.");
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : mensagemDoErro(e)),
  });
}
