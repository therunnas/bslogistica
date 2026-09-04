# Escrita em operation_team permitida a qualquer usuário com papel

**Levantado em:** 04/09/2026
**Situação:** observação apenas. A policy não foi alterada.

## O que foi observado

A tabela `public.operation_team`, que guarda a alocação de colaboradores em
operações e turnos, tem uma única policy:

```
ALL | operation_team_staff | USING: is_staff()
```

`is_staff()` devolve verdadeiro para qualquer usuário com **alguma** linha em
`user_roles` — admin ou operacional, indistintamente.

Em comparação, as demais tabelas de cadastro separam leitura de escrita:

| Tabela | Leitura | Escrita |
|---|---|---|
| `clients` | `is_staff()` | `has_role(admin)` |
| `employees` | `is_staff()` | `has_role(admin)` |
| `contracts` | `is_staff()` | `has_role(admin)` |
| `invoices` | `is_staff()` | `has_role(admin)` |
| **`operation_team`** | `is_staff()` | **`is_staff()`** |

Ou seja, um usuário `operacional` pode incluir, alterar e remover alocações de
equipe, enquanto não consegue mexer em cliente, colaborador ou contrato.

## Por que pode ser intencional

Alocação de equipe é decisão de rotina: quem coordena a operação em campo
remaneja gente conforme falta, atraso ou substituição. Exigir um administrador
para cada troca engessaria o uso diário.

## Por que merece decisão explícita

A alocação alimenta o apontamento, e o apontamento vira diária faturada. Quem
altera equipe influencia, de forma indireta, o que é cobrado do cliente e o que
é pago ao colaborador.

Hoje não há registro de quem fez a alteração: a tabela tem `created_at`, mas não
guarda autor nem histórico. Uma remoção de alocação não deixa rastro.

## Encaminhamento

Nada a fazer nesta etapa. É decisão de negócio, não de migração:

- manter como está, se a intenção é que o time operacional remaneje equipe; ou
- restringir a escrita a `has_role(admin)`, se alocação for decisão administrativa.

Caso se mantenha permissivo, vale considerar registrar autor e histórico das
alterações, para que a origem de uma diária faturada seja rastreável.
