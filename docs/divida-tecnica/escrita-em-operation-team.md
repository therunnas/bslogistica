# Escrita em operation_team permitida a qualquer usuário com papel

**Levantado em:** 04/09/2026
**Situação:** **RESOLVIDA** pela migration `016`.

## O que foi observado

A tabela `public.operation_team`, que guarda a alocação de colaboradores em
operações e turnos, tinha uma única policy permissiva:

```
ALL | operation_team_staff | USING: is_staff()
```

`is_staff()` devolve verdadeiro para qualquer usuário com **alguma** linha em
`user_roles`, de modo que um `operacional` poderia incluir, alterar e remover
alocações, ao contrário das demais tabelas de cadastro, em que a escrita exige
`has_role(admin)`. A tabela também não guarda autor nem histórico: uma remoção de
alocação não deixa rastro.

Como a alocação alimenta o apontamento, e o apontamento vira diária faturada,
quem altera equipe influencia indiretamente o que é cobrado e pago.

## Como foi resolvido

A migration `016` acrescentou a policy RESTRICTIVE `operation_team_exige_admin`,
ao lado das de outras nove tabelas de negócio. O acesso direto de `authenticated`
passou a exigir **`aal2` e `admin`**. A permissiva original não foi tocada.

O operador não depende mais dessa tabela por acesso direto: a superfície que ele
usa são as cinco RPCs operacionais, que não escrevem em `operation_team`.
Remanejar equipe é, hoje, decisão administrativa.

## O que permanece

A tabela continua sem autor e sem histórico por linha. Como só `admin` escreve,
o que existe de rastro é o das ações administrativas de usuário em
`admin_audit_log`, que **não** cobre alocação de equipe. Se a rastreabilidade de
quem alocou quem passar a ser necessária, é requisito de produto novo, com
migration própria.

Detalhes da camada de acesso em [`../SEGURANCA.md`](../SEGURANCA.md).
