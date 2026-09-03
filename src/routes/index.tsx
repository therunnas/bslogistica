import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, CalendarCheck, FileText, Users } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "BS Logística | Gestão de diárias, horas extras e faturamento" },
      {
        name: "description",
        content:
          "Controle operações fixas e avulsas de mão de obra terceirizada: apontamento de diárias, horas extras, custos e faturamento por cliente.",
      },
      { property: "og:title", content: "BS Logística | Gestão de diárias e faturamento" },
      {
        property: "og:description",
        content:
          "Do apontamento diário ao faturamento: diárias, horas extras, custos e margem por cliente e operação.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const features = [
  {
    icon: CalendarCheck,
    title: "Apontamento diário",
    text: "Presença, falta, substituição, entrada, saída e intervalo por turno.",
  },
  {
    icon: BarChart3,
    title: "Cálculo automático",
    text: "Uma diária por colaborador presente e hora extra proporcional à diária.",
  },
  {
    icon: FileText,
    title: "Faturamento",
    text: "Fechamento por período e por cliente, com diárias e horas extras separadas.",
  },
  {
    icon: Users,
    title: "Custos e margem",
    text: "Custo por diária do colaborador e resultado por cliente e operação.",
  },
];

function Landing() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="grid size-8 place-items-center rounded-md bg-primary font-display text-sm font-bold text-primary-foreground">
            BS
          </div>
          <span className="font-display text-lg font-semibold">BS Logística</span>
        </div>
        <Button asChild>
          <Link to="/auth">Entrar</Link>
        </Button>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="py-16">
          <p className="font-medium text-primary">Gestão operacional e financeira</p>
          <h1 className="mt-3 max-w-3xl font-display text-4xl font-semibold tracking-tight md:text-5xl">
            Da equipe em campo ao faturamento do cliente, sem planilha
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-muted-foreground">
            Controle operações fixas e avulsas de carga e descarga: quem trabalhou, em qual turno,
            quantas diárias, quantas horas extras e quanto cobrar de cada cliente.
          </p>
          <div className="mt-8 flex gap-3">
            <Button asChild size="lg">
              <Link to="/auth">Acessar o painel</Link>
            </Button>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-lg border border-border bg-card p-5">
              <Icon className="size-5 text-primary" />
              <h2 className="mt-3 font-display text-base font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
