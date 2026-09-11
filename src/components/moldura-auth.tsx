import Image from "next/image";
import type { ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Moldura das telas de autenticação que ficam fora do painel.
 *
 * Repete o enquadramento do /login — marca fora do card, card centralizado —
 * para que recuperar a senha não pareça outro sistema. O login em si não usa
 * este componente de propósito: aquela tela já estava aprovada e não havia
 * motivo para mexer nela só por simetria de código.
 *
 * Sem hook nem estado, então serve tanto a Server quanto a Client Component.
 */
export function MolduraAuth({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao?: string;
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center gap-8 bg-muted/40 px-4 py-12">
      <Image
        src="/branding/bs-logo-temp.png"
        alt="BS Soluções Logísticas"
        width={1000}
        height={625}
        priority
        className="h-auto w-36 self-start object-contain lg:absolute lg:top-8 lg:left-10 lg:w-40"
      />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-xl">{titulo}</CardTitle>
          {descricao ? <CardDescription>{descricao}</CardDescription> : null}
        </CardHeader>
        <CardContent className="space-y-4">{children}</CardContent>
      </Card>
    </div>
  );
}
