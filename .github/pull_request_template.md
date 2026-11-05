## Escopo

<!-- Descreva o problema, a solução e o que ficou explicitamente fora do escopo. -->

## Classificação da entrega

- [ ] Aplicação sem mudança de banco
- [ ] Migration nova
- [ ] Documentação/processo
- [ ] Segurança/autorização
- [ ] Financeiro

## Gate e ambiente-alvo

- Gate atual: <!-- desenvolvimento | CI | Preview | HML | homologação | integração | Production -->
- Ambiente-alvo autorizado: <!-- nenhum | local | Preview/HML | Production -->
- Ambientes que **não** foram alterados:
  - [ ] Preview
  - [ ] HML
  - [ ] Production

Referências: [Workflow](../docs/WORKFLOW.md) ·
[Ambientes](../docs/AMBIENTES.md) · [Handoff](../docs/HANDOFF.md).

## Evidências

| Verificação         | Resultado | Evidência/limitação |
| ------------------- | --------- | ------------------- |
| Teste RED           |           |                     |
| Testes direcionados |           |                     |
| Regressões Node     |           |                     |
| SQL local           |           |                     |
| Lint                |           |                     |
| TypeScript          |           |                     |
| Prettier            |           |                     |
| Build               |           |                     |
| Preview real        |           |                     |
| Homologação real    |           |                     |

Não preencher PASS para teste não executado. CI verde não substitui homologação.

## Banco e migrations

- Migration head local:
- Migration head Preview/HML:
- Migration head Production:
- [ ] Nenhuma migration existente foi editada.
- [ ] Nenhuma migration remota foi executada por este PR.
- Compatibilidade e rollback:

## Segurança e dados

- [ ] Nenhum segredo, token ou dado pessoal foi incluído.
- [ ] RLS, grants, RPCs, Auth e regras financeiras não mudaram ou estão descritos
      e testados no escopo autorizado.
- [ ] Fixtures e evidências usam apenas dados sintéticos.

## Aprovações separadas

- [ ] Homologação aprovada explicitamente, quando aplicável.
- [ ] Merge autorizado explicitamente.
- [ ] Production autorizada explicitamente — **merge não marca este item**.

## Riscos, rollback e próximo gate

- Riscos residuais:
- Procedimento de recuperação:
- Próxima ação autorizada:
- Ações ainda proibidas:
