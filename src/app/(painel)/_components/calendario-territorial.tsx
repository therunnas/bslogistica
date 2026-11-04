"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCalendarioTerritorial } from "@/lib/vigencias-dados";
import {
  useAlterarCalendario,
  useCoberturas,
  useLocaisDaOperacao,
  useMunicipios,
  useMunicipiosCatalogados,
} from "@/lib/calendario-dados";
import {
  UFS,
  validarFeriadoTerritorial,
  validarCoberturaTerritorial,
  lerSnapshotCalendario,
  situacaoCobertura,
  periodoLocalValido,
  type FormularioTerritorial,
  type Ambito,
  type Municipio,
} from "@/lib/calendario-territorial";
import { useFeriados } from "@/lib/regras-definitivas-dados";
import { dateBR } from "@/lib/format";

const SELECT = "h-10 w-full rounded-xl border border-input bg-secondary/50 px-3 text-sm";

function Campo({ id, nome, children }: { id: string; nome: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{nome}</Label>
      {children}
    </div>
  );
}

export function SeletorTerritorial({
  uf,
  municipio,
  onUf,
  onMunicipio,
  ambito,
}: {
  uf: string;
  municipio: Municipio | null;
  onUf: (uf: string) => void;
  onMunicipio: (m: Municipio | null) => void;
  ambito?: Ambito;
}) {
  const id = useId();
  const municipal = !ambito || ambito === "municipal";
  const ufs = ambito === "distrital" ? ["DF"] : ambito ? UFS.filter((u) => u !== "DF") : UFS;
  const lista = useMunicipios(municipal ? uf : "");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo id={`${id}-uf`} nome="UF do local de trabalho">
        <select
          id={`${id}-uf`}
          className={SELECT}
          value={uf}
          onChange={(e) => {
            onUf(e.target.value);
            onMunicipio(null);
          }}
        >
          <option value="">Selecione a UF</option>
          {ufs.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </Campo>
      {municipal && (
        <Campo
          id={`${id}-municipio`}
          nome={uf === "DF" ? "Localidade oficial (IBGE)" : "Município oficial (IBGE)"}
        >
          <select
            id={`${id}-municipio`}
            className={SELECT}
            value={municipio?.codigo ?? ""}
            disabled={!uf || !lista.isSuccess}
            onChange={(e) =>
              onMunicipio(lista.data?.find((m) => m.codigo === e.target.value) ?? null)
            }
          >
            <option value="">
              {uf && lista.isPending
                ? "Consultando IBGE…"
                : uf === "DF"
                  ? "Selecione a localidade"
                  : "Selecione o município"}
            </option>
            {(lista.data ?? []).map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.nome} ({m.codigo})
              </option>
            ))}
          </select>
          {lista.isError && (
            <div role="alert" className="text-xs text-destructive">
              IBGE indisponível.{" "}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void lista.refetch()}
              >
                Tentar novamente
              </Button>
            </div>
          )}
          {municipio && (
            <a
              className="text-xs underline"
              href={municipio.fonteUrl}
              target="_blank"
              rel="noreferrer"
            >
              {uf === "DF" ? "Conferir localidade no IBGE" : "Conferir município no IBGE"}
            </a>
          )}
        </Campo>
      )}
    </div>
  );
}

const INICIAL: FormularioTerritorial = {
  data: "",
  nome: "",
  motivo: "",
  ambito: "nacional",
  uf: "",
  municipio: "",
  norma: "",
  fonte: "",
  confirmado: false,
  tipo: "feriado",
  movel: false,
};

export function CalendarioTerritorial() {
  const feriados = useFeriados(true);
  const coberturas = useCoberturas(true);
  const alterar = useAlterarCalendario();
  const [modo, setModo] = useState<"feriado" | "cobertura" | null>(null);
  const [f, setF] = useState(INICIAL);
  const [municipio, setMunicipio] = useState<Municipio | null>(null);
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [aposentar, setAposentar] = useState<{
    tipo: "aposentar-feriado" | "aposentar-cobertura";
    id: string;
  } | null>(null);
  const [motivoApos, setMotivoApos] = useState("");
  const mudar = <K extends keyof FormularioTerritorial>(k: K, v: FormularioTerritorial[K]) =>
    setF((anterior) => ({ ...anterior, [k]: v }));
  const erros =
    modo === "feriado" ? validarFeriadoTerritorial(f) : validarCoberturaTerritorial(f, Number(ano));
  function abrir(m: "feriado" | "cobertura") {
    setF(INICIAL);
    setMunicipio(null);
    setModo(m);
  }
  function pedirAposentadoria(tipo: "aposentar-feriado" | "aposentar-cobertura", id: string) {
    setAposentar({ tipo, id });
    setMotivoApos("");
  }

  return (
    <Card className="mt-6 rounded-2xl">
      <CardHeader>
        <CardTitle>Calendário territorial</CardTitle>
        <p className="text-sm text-muted-foreground">
          Feriados exigem data, âmbito, norma e fonte oficial. O cadastro da localidade não confirma
          seu calendário. Nada é importado ou ativado automaticamente.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => abrir("feriado")}>Registrar feriado ou ponto facultativo</Button>
          <Button variant="outline" onClick={() => abrir("cobertura")}>
            Confirmar cobertura anual
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Antes de apontar, confira as coberturas do ano: no Distrito Federal, nacional e distrital
          (duas); nas demais UFs, nacional, estadual e municipal do local real de trabalho (três). A
          cobertura municipal precisa ser conferida com o cliente, inclusive quando não houver
          feriado municipal. Carnaval e Corpus Christi exigem norma específica; ponto facultativo
          não vira feriado. As regras financeiras continuam dependendo de ativação própria.
        </p>
        <div className="space-y-2">
          <h3 className="font-medium">Datas registradas</h3>
          {feriados.isError ? (
            <p role="alert">Não foi possível carregar as datas.</p>
          ) : feriados.isPending ? (
            <p>Carregando datas…</p>
          ) : !feriados.data?.length ? (
            <p>Nenhuma data registrada.</p>
          ) : (
            <ul className="divide-y">
              {feriados.data.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p>
                      {dateBR(r.holiday_date)} · {r.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {r.territory_scope ?? "legado"} {r.state_code} {r.municipality_code} ·{" "}
                      {r.holiday_kind ?? "feriado"} ·{" "}
                      {r.active
                        ? (r.verification_status ?? "legado sem comprovação territorial")
                        : "aposentado"}
                      {r.is_movable ? " · data móvel" : ""}
                    </p>
                    {r.official_url && (
                      <a
                        href={r.official_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                      >
                        {r.legal_act} · fonte oficial
                      </a>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!r.active}
                    onClick={() => pedirAposentadoria("aposentar-feriado", r.id)}
                  >
                    Aposentar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2">
          <h3 className="font-medium">Cobertura anual por território</h3>
          {coberturas.isError ? (
            <p role="alert">
              Não foi possível carregar as coberturas. Calendário permanece sem confirmação.
            </p>
          ) : coberturas.isPending ? (
            <p>Carregando coberturas…</p>
          ) : !coberturas.data?.length ? (
            <p>Pendente: nenhum âmbito confirmado.</p>
          ) : (
            <ul className="divide-y">
              {coberturas.data.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
                >
                  <div>
                    <p>
                      {r.calendar_year} · {r.territory_scope} {r.state_code} {r.municipality_code} ·{" "}
                      {situacaoCobertura(r)}
                    </p>
                    <a
                      href={r.official_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs underline"
                    >
                      {r.legal_act} · fonte oficial
                    </a>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!r.active}
                    onClick={() => pedirAposentadoria("aposentar-cobertura", r.id)}
                  >
                    Aposentar cobertura
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Dialog open={modo !== null} onOpenChange={(o) => !o && setModo(null)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>
                {modo === "feriado" ? "Registrar data territorial" : "Confirmar cobertura anual"}
              </DialogTitle>
              <DialogDescription>
                Confira a fonte oficial antes de confirmar. O histórico fica preservado; a correção
                exige aposentadoria com motivo.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4">
              <Campo id="cal-ambito" nome="Âmbito">
                <select
                  id="cal-ambito"
                  className={SELECT}
                  value={f.ambito}
                  onChange={(e) => {
                    mudar("ambito", e.target.value as FormularioTerritorial["ambito"]);
                    mudar("uf", e.target.value === "distrital" ? "DF" : "");
                    mudar("municipio", "");
                    setMunicipio(null);
                  }}
                >
                  <option value="nacional">Nacional</option>
                  <option value="estadual">Estadual</option>
                  <option value="municipal">Municipal</option>
                  <option value="distrital">Distrital (Distrito Federal)</option>
                </select>
              </Campo>
              {f.ambito !== "nacional" && (
                <SeletorTerritorial
                  uf={f.uf}
                  municipio={municipio}
                  ambito={f.ambito}
                  onUf={(v) => mudar("uf", v)}
                  onMunicipio={(m) => {
                    setMunicipio(m);
                    mudar("municipio", m?.codigo ?? "");
                  }}
                />
              )}
              {modo === "feriado" ? (
                <>
                  <Campo id="cal-data" nome="Data exata do ano">
                    <Input
                      id="cal-data"
                      type="date"
                      value={f.data}
                      onChange={(e) => mudar("data", e.target.value)}
                    />
                  </Campo>
                  <Campo id="cal-nome" nome="Nome">
                    <Input
                      id="cal-nome"
                      value={f.nome}
                      maxLength={120}
                      onChange={(e) => mudar("nome", e.target.value)}
                    />
                  </Campo>
                  <Campo id="cal-tipo" nome="Natureza">
                    <select
                      id="cal-tipo"
                      className={SELECT}
                      value={f.tipo}
                      onChange={(e) => {
                        mudar("tipo", e.target.value as FormularioTerritorial["tipo"]);
                        mudar("confirmado", false);
                      }}
                    >
                      <option value="feriado">Feriado previsto em norma</option>
                      <option value="ponto_facultativo">
                        Ponto facultativo (sem efeito de feriado)
                      </option>
                    </select>
                  </Campo>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={f.movel}
                      onChange={(e) => mudar("movel", e.target.checked)}
                    />
                    Data móvel: cadastrar e conferir cada ano
                  </label>
                </>
              ) : (
                <Campo id="cal-ano" nome="Ano da cobertura">
                  <Input
                    id="cal-ano"
                    type="number"
                    min="1900"
                    max="9999"
                    value={ano}
                    onChange={(e) => setAno(e.target.value)}
                  />
                </Campo>
              )}
              <Campo id="cal-norma" nome="Norma / ato oficial conferido">
                <Input
                  id="cal-norma"
                  value={f.norma}
                  onChange={(e) => mudar("norma", e.target.value)}
                />
              </Campo>
              <Campo id="cal-fonte" nome="URL da fonte oficial">
                <Input
                  id="cal-fonte"
                  type="url"
                  value={f.fonte}
                  onChange={(e) => mudar("fonte", e.target.value)}
                />
              </Campo>
              <Campo id="cal-motivo" nome="Motivo do registro">
                <Textarea
                  id="cal-motivo"
                  value={f.motivo}
                  onChange={(e) => mudar("motivo", e.target.value)}
                />
              </Campo>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.confirmado}
                  disabled={f.tipo === "ponto_facultativo" && modo === "feriado"}
                  onChange={(e) => mudar("confirmado", e.target.checked)}
                />
                {modo === "cobertura"
                  ? f.ambito === "municipal"
                    ? "Conferi o calendário municipal completo deste ano e as normas aplicáveis com o cliente (obrigatório)."
                    : "Conferência com o cliente (opcional neste âmbito). A norma e a fonte oficiais são obrigatórias."
                  : "Conferi a norma e a data com o cliente; confirmar como feriado. Sem marcar, fica pendente."}
              </label>
              {erros.length > 0 && (
                <ul className="list-disc pl-5 text-xs text-destructive">
                  {erros.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
              <Button
                disabled={erros.length > 0 || alterar.isPending}
                onClick={() =>
                  modo &&
                  alterar.mutate(
                    modo === "feriado"
                      ? { tipo: modo, formulario: f, municipio }
                      : { tipo: modo, formulario: f, municipio, ano: Number(ano) },
                    { onSuccess: () => setModo(null) },
                  )
                }
              >
                {modo === "feriado" ? "Registrar data" : "Confirmar cobertura"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        <Dialog open={aposentar !== null} onOpenChange={(o) => !o && setAposentar(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Aposentar registro</DialogTitle>
              <DialogDescription>
                Os apontamentos já precificados mantêm seus valores e sua proveniência. Novos
                apontamentos precisam de cobertura válida.
              </DialogDescription>
            </DialogHeader>
            <Campo id="cal-apos" nome="Motivo obrigatório">
              <Textarea
                id="cal-apos"
                value={motivoApos}
                onChange={(e) => setMotivoApos(e.target.value)}
              />
            </Campo>
            <Button
              variant="destructive"
              disabled={!motivoApos.trim() || alterar.isPending}
              onClick={() =>
                aposentar &&
                alterar.mutate(
                  { ...aposentar, motivo: motivoApos },
                  { onSuccess: () => setAposentar(null) },
                )
              }
            >
              Aposentar
            </Button>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

export function LocalidadeDaOperacao({ id }: { id: string }) {
  const capacidade = useCalendarioTerritorial();
  const locais = useLocaisDaOperacao(id, capacidade === "disponivel");
  const catalogo = useMunicipiosCatalogados(capacidade === "disponivel");
  const alterar = useAlterarCalendario();
  const [aberto, setAberto] = useState(false);
  const [uf, setUf] = useState("");
  const [municipio, setMunicipio] = useState<Municipio | null>(null);
  const [inicio, setInicio] = useState("");
  const [fim, setFim] = useState("");
  const [motivo, setMotivo] = useState("");
  const [encerrar, setEncerrar] = useState(false);
  if (capacidade === "indisponivel") return null;
  if (capacidade === "desconhecida")
    return (
      <p className="p-4 text-xs text-muted-foreground">
        Não foi possível confirmar a disponibilidade do calendário territorial.
      </p>
    );
  return (
    <div className="space-y-3 border-b p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Local real de trabalho · calendário territorial</p>
        <Button variant="outline" size="sm" onClick={() => setAberto(true)}>
          Registrar localidade com vigência
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Selecione explicitamente a localidade da operação: município nas demais UFs ou Brasília
        (IBGE 5300108) no Distrito Federal. O endereço ou a sede do cliente não definem a
        localidade.
      </p>
      {locais.isError ? (
        <p role="alert">Erro ao carregar localidades.</p>
      ) : locais.isPending ? (
        <p>Carregando localidades…</p>
      ) : !locais.data?.length ? (
        <p>Localidade ausente. Defina a vigência antes de apontar com o motor ligado.</p>
      ) : (
        <ul>
          {locais.data.map((l) => (
            <li key={l.id}>
              {catalogo.data?.find((m) => m.id === l.municipality_code)?.name ??
                l.municipality_code}
              {" · "}
              {l.municipality_code} · {dateBR(l.valid_from)} até{" "}
              {l.valid_to ? `${dateBR(l.valid_to)} (fim exclusivo)` : "sem término"} ·{" "}
              {l.active ? "vigência registrada" : "aposentada"}
            </li>
          ))}
        </ul>
      )}
      <Dialog open={aberto} onOpenChange={setAberto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Localidade da operação</DialogTitle>
            <DialogDescription>
              A localidade deve corresponder ao local efetivo de trabalho. No Distrito Federal,
              Brasília é a identidade IBGE do local, sem criar município jurídico. A nova vigência
              não altera o histórico dos apontamentos.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <SeletorTerritorial
              uf={uf}
              municipio={municipio}
              onUf={setUf}
              onMunicipio={setMunicipio}
            />
            <Campo id={`local-inicio-${id}`} nome="Início da vigência">
              <Input
                id={`local-inicio-${id}`}
                type="date"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
              />
            </Campo>
            <Campo id={`local-fim-${id}`} nome="Fim exclusivo da vigência (opcional)">
              <Input
                id={`local-fim-${id}`}
                type="date"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
              />
            </Campo>
            <Campo id={`local-motivo-${id}`} nome="Motivo obrigatório">
              <Textarea
                id={`local-motivo-${id}`}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
              />
            </Campo>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={encerrar}
                onChange={(e) => setEncerrar(e.target.checked)}
              />
              Encerrar a vigência anterior no dia anterior ao novo início
            </label>
            <Button
              disabled={
                !municipio ||
                !periodoLocalValido(inicio, fim) ||
                !motivo.trim() ||
                alterar.isPending
              }
              onClick={() =>
                alterar.mutate(
                  { tipo: "local", id, municipio, inicio, fim, motivo, encerrar },
                  { onSuccess: () => setAberto(false) },
                )
              }
            >
              Registrar localidade
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Exibe exclusivamente o JSON congelado na linha, sem leitura do calendário de hoje. */
export function SnapshotCalendarioDoApontamento({ valor }: { valor: unknown }) {
  if (valor === null || valor === undefined) return null;
  const snapshot = lerSnapshotCalendario(valor);
  if (!snapshot) {
    return (
      <p className="mt-2 text-xs text-muted-foreground">
        Proveniência do calendário indisponível: registro congelado em formato não reconhecido.
      </p>
    );
  }
  const tipoDoDia = { util: "Dia útil", sabado: "Sábado", domingo: "Domingo", feriado: "Feriado" };
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Calendário congelado na precificação</summary>
      <div className="mt-2 space-y-2">
        <p>
          {snapshot.location.municipality_name}/{snapshot.location.state_code} · IBGE{" "}
          {snapshot.location.municipality_code}
        </p>
        <ul className="space-y-2">
          {snapshot.days.map((dia, i) => (
            <li key={`${dia.date}-${i}`}>
              <p>
                {dateBR(dia.date)} · {tipoDoDia[dia.day_kind]} · calendário confirmado
              </p>
              <p>
                {dia.holiday_ids.length} feriado(s) e {dia.coverage_ids.length} cobertura(s) no
                registro.
              </p>
              <details className="mt-1">
                <summary className="cursor-pointer">Referências preservadas</summary>
                <p className="break-all">Localidade: {dia.location_term_id}</p>
                <p className="break-all">Feriados: {dia.holiday_ids.join(", ") || "nenhum"}</p>
                <p className="break-all">Coberturas: {dia.coverage_ids.join(", ") || "nenhuma"}</p>
              </details>
            </li>
          ))}
        </ul>
        <p>{snapshot.segments.worked_minutes} minutos trabalhados registrados.</p>
        {snapshot.segments.status !== "confirmado" && (
          <p>
            {snapshot.segments.status === "intervalo_sem_horario"
              ? "Intervalo sem horário definido: não há divisão confirmada dos minutos entre as datas."
              : "Segmentação incompleta no registro congelado."}
          </p>
        )}
        <ul>
          {snapshot.segments.segments.map((segmento, i) => (
            <li key={`${segmento.date}-${i}`}>
              {dateBR(segmento.date)} · {segmento.gross_minutes} minutos brutos ·{" "}
              {segmento.worked_minutes === null
                ? "minutos trabalhados não distribuídos"
                : `${segmento.worked_minutes} minutos trabalhados`}
            </li>
          ))}
        </ul>
        <p>Estes dados são históricos e não são recalculados pelo calendário atual.</p>
      </div>
    </details>
  );
}
