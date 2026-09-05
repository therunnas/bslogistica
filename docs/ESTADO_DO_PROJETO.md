# Estado do projeto

Fotografia em 04/09/2026.

## Arquitetura

**Next.js é a arquitetura definitiva.** TanStack Start, TanStack Router, Vite,
Nitro e as integrações com o Lovable foram removidos do repositório.

`@tanstack/react-query` permanece: é a camada de dados da aplicação e não tem
relação com o TanStack Router.

## Módulos

Sete concluídos e validados contra a versão anterior, com os mesmos registros do
banco:

| Módulo               | Situação |
| -------------------- | -------- |
| Dashboard            | ✅       |
| Clientes e contratos | ✅       |
| Colaboradores        | ✅       |
| Operações            | ✅       |
| Apontamentos         | ✅       |
| Faturamento          | ✅       |
| Relatórios           | ✅       |

Mais landing, login, layout protegido, logout e renovação de sessão.

Em apontamentos e faturamento a conferência foi por **leitura direta do banco**,
não pela tela — a interface mostra o valor calculado, não o gravado. Os CSVs de
faturamento e relatórios saem idênticos byte a byte à versão anterior.

## Validações

| Verificação        | Resultado                                      |
| ------------------ | ---------------------------------------------- |
| `npm run lint`     | 0 erros, 1 aviso preexistente                  |
| `npx tsc --noEmit` | limpo                                          |
| `npm run build`    | 10 rotas e o proxy                             |
| `npm audit`        | 0 vulnerabilidades                             |
| Perfis testados    | admin, operacional, sem papel, não autenticado |
| Segredos no bundle | nenhum                                         |

## Segurança

`disable_signup = true` — cadastro público bloqueado. Detalhes e pendências em
[SEGURANCA.md](SEGURANCA.md).

## Git e deploy

| Item               | Estado                                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| Branch de trabalho | `migration/nextjs`                                                               |
| `main`             | preservada como referência anterior, sem merge                                   |
| PR                 | [#1](https://github.com/therunnas/bslogistica/pull/1) — **aberto, não mergeado** |
| Preview            | Ready, protegida por Vercel Authentication                                       |
| Produção           | não publicada                                                                    |
| Domínio            | nenhum associado ao sistema                                                      |

## Dívidas técnicas abertas

Cinco documentos em [divida-tecnica/](divida-tecnica/). **Nenhuma foi introduzida
pela migração** — todas existem na versão anterior e se comportam igual nas
duas, o que foi verificado.

| Dívida                                                                                            | Impacto                                             |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [Faturamento não transacional](divida-tecnica/faturamento-nao-transacional.md)                    | faturas órfãs e cobrança repetida do mesmo trabalho |
| [Sobrescrita do rascunho](divida-tecnica/apontamento-sobrescreve-rascunho.md)                     | hora extra perdida sem aviso                        |
| [Folha duplicada por turno nulo](divida-tecnica/folha-duplicada-por-shift-null.md)                | mesmo colaborador contado duas vezes no dia         |
| [Escrita permissiva em operation_team](divida-tecnica/escrita-em-operation-team.md)               | alteração de equipe sem rastro                      |
| [Falso sucesso em escrita bloqueada](divida-tecnica/falso-sucesso-em-update-bloqueado-por-rls.md) | usuário acredita ter salvo o que não foi salvo      |

As duas primeiras afetam valores cobrados e merecem prioridade.

## Próximos passos

1. Commitar e enviar a consolidação
2. Validar a Preview com a aplicação já consolidada
3. Decidir sobre as dívidas de faturamento e apontamentos — corrigir antes ou
   depois do merge
4. Revisão final e merge do PR #1 em `main`
5. Publicar em produção

Itens menores pendentes: ativar a proteção contra senha vazada e decidir sobre
o projeto Vercel duplicado `bslogistica-sistema`, hoje desconectado do
repositório.

O histórico de migrations foi reconciliado em 05/09/2026: as versões
`20260903205051` e `20260905163000` tiveram os efeitos auditados no banco e
foram marcadas como aplicadas com `supabase migration repair`. Depois disso a
`20260905203000` foi aplicada pelo fluxo normal, com `supabase db push`, e
`supabase migration list --linked` mostra as **sete alinhadas**.
