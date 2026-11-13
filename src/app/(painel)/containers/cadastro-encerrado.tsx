import Link from "next/link";

import { Button } from "@/components/ui/button";
import { MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO } from "@/lib/container-servico-ui";

/**
 * D7 (QA-BS-01, CP-06): o cadastro NOVO de containers por este caminho está encerrado. Contêiner é
 * um tipo de serviço avulso, registrado como operação avulsa. O formulário antigo continua no código
 * (`formulario-container.tsx`), mas não é mais oferecido; o servidor também recusa o registro
 * (`registrarContainerAction`). Os registros antigos seguem em /containers.
 */
export function CadastroDeContainerEncerrado() {
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Contêiner é um serviço avulso</h1>
      <p className="text-sm text-muted-foreground">{MENSAGEM_CADASTRO_DE_CONTAINER_ENCERRADO}</p>
      <p className="text-sm">
        Para registrar um novo serviço de contêiner, use{" "}
        <strong>Operações → Nova operação → tipo Avulsa</strong>, com o valor por diária e a data do
        serviço. Os participantes entram pelo apontamento do dia.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/operacoes">Ir para Operações</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/containers">Ver registros antigos de contêiner</Link>
        </Button>
      </div>
    </div>
  );
}
