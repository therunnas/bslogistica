"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Power, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  useAlterarSituacaoDaFuncao,
  useCriarFuncao,
  useRenomearFuncao,
  useVincularFuncoesExatas,
} from "@/lib/funcoes-dados";
import {
  pendentesDeFuncao,
  pendentesResolviveis,
  validarNomeDaFuncao,
  type FuncaoDoCatalogo,
} from "@/lib/funcoes";
import type { Employee } from "@/lib/types";

const INPUT_CLASS =
  "h-10 rounded-xl border-input bg-secondary/50 text-foreground focus-visible:border-primary/60 focus-visible:ring-primary/20";

export interface CatalogoDeFuncoesProps {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  funcoes: readonly FuncaoDoCatalogo[];
  colaboradores: readonly Employee[];
  carregando: boolean;
  erro: boolean;
}

/**
 * Catálogo institucional de funções (migration 039): cadastro, renomeação e inativação (nunca
 * exclusão), e a revisão dos colaboradores cujo cargo em texto ainda não tem função vinculada. Sem
 * preço nem percentual: tarifas por função são do FIN-PR-07.
 */
export function CatalogoDeFuncoes({
  aberto,
  aoMudar,
  funcoes,
  colaboradores,
  carregando,
  erro,
}: CatalogoDeFuncoesProps) {
  const criar = useCriarFuncao();
  const renomear = useRenomearFuncao();
  const situacao = useAlterarSituacaoDaFuncao();
  const vincular = useVincularFuncoesExatas();

  const [novoNome, setNovoNome] = useState("");
  const [editando, setEditando] = useState<string | null>(null);
  const [nomeEditado, setNomeEditado] = useState("");

  const errosDoNovo = novoNome.trim() === "" ? [] : validarNomeDaFuncao(novoNome, funcoes);
  const errosDaEdicao =
    editando === null ? [] : validarNomeDaFuncao(nomeEditado, funcoes, editando);

  const pendentes = pendentesDeFuncao(colaboradores);
  const resolviveis = pendentesResolviveis(colaboradores, funcoes);

  function cadastrar() {
    if (novoNome.trim() === "" || errosDoNovo.length > 0) return;
    criar.mutate(novoNome, { onSuccess: () => setNovoNome("") });
  }

  function salvarNome() {
    if (editando === null || errosDaEdicao.length > 0 || nomeEditado.trim() === "") return;
    renomear.mutate({ id: editando, nome: nomeEditado }, { onSuccess: () => setEditando(null) });
  }

  return (
    <Dialog open={aberto} onOpenChange={aoMudar}>
      <DialogContent className="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl tracking-[-0.025em]">Catálogo de funções</DialogTitle>
          <DialogDescription>
            Funções padronizadas para colaboradores e equipes. Uma função inativa não pode ser
            escolhida de novo, mas permanece onde já foi usada. Nenhuma função é excluída.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            cadastrar();
          }}
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="nova-funcao">Nova função</Label>
            <Input
              id="nova-funcao"
              value={novoNome}
              onChange={(event) => setNovoNome(event.target.value)}
              placeholder="Ex.: Motorista de empilhadeira"
              className={INPUT_CLASS}
              aria-invalid={errosDoNovo.length > 0}
              aria-describedby={errosDoNovo.length > 0 ? "nova-funcao-erro" : undefined}
            />
          </div>
          <Button
            type="submit"
            className="h-10 rounded-xl"
            disabled={novoNome.trim() === "" || errosDoNovo.length > 0 || criar.isPending}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Cadastrar
          </Button>
        </form>
        {errosDoNovo.length > 0 ? (
          <p id="nova-funcao-erro" className="text-xs text-destructive">
            {errosDoNovo[0]}
          </p>
        ) : null}

        {erro ? (
          <p className="text-sm text-destructive">Não foi possível carregar o catálogo.</p>
        ) : carregando ? (
          <p className="text-sm text-muted-foreground">Carregando funções…</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="border-border bg-secondary/30 hover:bg-secondary/30">
                  <TableHead>Função</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funcoes.map((funcao) => (
                  <TableRow key={funcao.id} className="border-border">
                    <TableCell className="text-sm font-medium">
                      {editando === funcao.id ? (
                        <form
                          className="flex items-center gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            salvarNome();
                          }}
                        >
                          <Input
                            aria-label={`Novo nome de ${funcao.name}`}
                            value={nomeEditado}
                            onChange={(event) => setNomeEditado(event.target.value)}
                            className={INPUT_CLASS}
                            autoFocus
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="outline"
                            aria-label="Salvar nome"
                            disabled={errosDaEdicao.length > 0 || nomeEditado.trim() === ""}
                          >
                            <Check className="h-4 w-4" aria-hidden />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label="Cancelar edição"
                            onClick={() => setEditando(null)}
                          >
                            <X className="h-4 w-4" aria-hidden />
                          </Button>
                        </form>
                      ) : (
                        funcao.name
                      )}
                      {editando === funcao.id && errosDaEdicao.length > 0 ? (
                        <p className="mt-1 text-xs text-destructive">{errosDaEdicao[0]}</p>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{funcao.code}</TableCell>
                    <TableCell>
                      <Badge variant={funcao.active ? "default" : "secondary"}>
                        {funcao.active ? "Ativa" : "Inativa"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditando(funcao.id);
                          setNomeEditado(funcao.name);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" aria-hidden />
                        Renomear
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={situacao.isPending}
                        onClick={() => situacao.mutate({ id: funcao.id, ativa: !funcao.active })}
                      >
                        <Power className="h-3.5 w-3.5" aria-hidden />
                        {funcao.active ? "Inativar" : "Reativar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <section
          className="rounded-xl border border-border bg-secondary/30 p-4"
          aria-labelledby="funcoes-pendentes"
        >
          <h3 id="funcoes-pendentes" className="text-sm font-semibold">
            Cargos em texto sem função vinculada
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            O texto original do cargo é preservado. Só a correspondência exata com o nome de uma
            função ativa (ignorando maiúsculas, acentos e espaços) é vinculada de uma vez; o resto
            fica para você escolher em cada colaborador.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Badge variant="secondary">
              {pendentes.length} {pendentes.length === 1 ? "pendente" : "pendentes"}
            </Badge>
            <Button
              type="button"
              size="sm"
              className="rounded-xl"
              disabled={resolviveis.length === 0 || vincular.isPending}
              onClick={() => vincular.mutate()}
            >
              Vincular correspondências exatas ({resolviveis.length})
            </Button>
          </div>
          {pendentes.length > 0 ? (
            <ul className="mt-3 max-h-40 list-disc space-y-1 overflow-y-auto pl-5 text-xs text-muted-foreground">
              {pendentes.map((colaborador) => (
                <li key={colaborador.id}>
                  {colaborador.name} — “{colaborador.role}”
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <DialogFooter>
          <Button type="button" className="rounded-xl" onClick={() => aoMudar(false)}>
            Concluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
