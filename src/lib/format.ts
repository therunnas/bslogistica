export const brl = (value: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value ?? 0));

export const num = (value: number | null | undefined, digits = 1) =>
  new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(value ?? 0));

export const pct = (value: number | null | undefined) => `${num(value, 1)}%`;

/** 95 -> "1h35" */
export function minutesToLabel(minutes: number | null | undefined) {
  const total = Math.max(0, Math.round(Number(minutes ?? 0)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h${String(m).padStart(2, "0")}`;
}

export const minutesToHours = (minutes: number | null | undefined) =>
  Math.max(0, Number(minutes ?? 0)) / 60;

/** "2026-09-03" -> "03/09/2026" */
export function dateBR(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

const dataNoFusoDaOperacao = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** Instante (timestamptz em UTC) -> dia em Brasília. Para colunas date, use dateBR. */
export function instanteBR(iso: string | null | undefined) {
  if (!iso) return "—";
  const instante = new Date(iso);
  return Number.isNaN(instante.getTime()) ? "—" : dataNoFusoDaOperacao.format(instante);
}

const horaNoFusoDaOperacao = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Instante (timestamptz em UTC) -> "dd/mm/aaaa hh:mm" em Brasília. */
export function instanteDataHoraBR(iso: string | null | undefined) {
  const dia = instanteBR(iso);
  return dia === "—" ? dia : `${dia} ${horaNoFusoDaOperacao.format(new Date(iso as string))}`;
}

export const todayISO = () => {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
};

export function monthRange(reference = new Date()) {
  const start = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const end = new Date(reference.getFullYear(), reference.getMonth() + 1, 0);
  const iso = (d: Date) =>
    new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
