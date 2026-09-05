# "Registro salvo." quando a RLS bloqueou a gravação

**Levantado em:** 04/09/2026
**Situação:** diagnóstico apenas. Nada foi corrigido.
**Gravidade:** alta — engana o usuário de forma ativa.
**Correção prevista:** depois da migração para Next.js.

## Causa técnica

No Postgres, uma policy de RLS que impede a escrita pode agir de duas formas
distintas, e a diferença importa:

- num `INSERT`, a cláusula `WITH CHECK` **levanta erro**:
  `new row violates row-level security policy`;
- num `UPDATE`, a cláusula `USING` apenas **filtra as linhas visíveis**. O
  comando roda com sucesso e afeta **zero linhas**. Nenhum erro é levantado.

O `useSaveRow`, em `src/lib/mutations.ts`, só observa o erro:

```js
const { error } = await query;
if (error) throw error;
```

Sem erro, o `onSuccess` dispara e mostra `toast.success("Registro salvo.")`. O
número de linhas afetadas nunca é consultado.

## Comportamento observado

Testado no banco, simulando a sessão de cada perfil e revertendo com rollback:

| Ação               | Admin   | Operacional            |
| ------------------ | ------- | ---------------------- |
| `UPDATE clients`   | 1 linha | **0 linhas, sem erro** |
| `UPDATE employees` | 1 linha | **0 linhas, sem erro** |
| `UPDATE contracts` | —       | **0 linhas, sem erro** |
| `INSERT clients`   | —       | erro de RLS            |
| `INSERT invoices`  | —       | erro de RLS            |

Ou seja: a RLS **protege os dados corretamente**. O problema é só o que a
interface diz ao usuário sobre o que aconteceu.

## Impacto

Um usuário operacional que edita um cliente ou um colaborador recebe a
confirmação verde de sucesso e sai acreditando que alterou o cadastro. Nada foi
gravado. A informação errada só aparece se alguém recarregar a tela e reparar
que o valor antigo continua lá.

É pior que uma mensagem de erro técnica em inglês: o erro ao menos avisa que
algo deu errado. Aqui o sistema afirma o contrário do que ocorreu.

O caso do `INSERT` não sofre disso, porque levanta erro de verdade e cai no
`onError`. A falha é específica de `UPDATE` — justamente a operação mais comum
numa tela de cadastro.

## Por que só apareceu agora

Até 04/09/2026 o projeto tinha **um único usuário, e ele é admin**. Como o admin
tem permissão de escrita em todas as tabelas, o caminho de bloqueio nunca era
percorrido. O defeito surgiu no primeiro teste com um perfil operacional.

Comportamento preexistente e idêntico nas duas aplicações — o `useSaveRow` é o
mesmo arquivo compartilhado, e não foi alterado na migração.

## Direção da correção

Pedir ao PostgREST a contagem de linhas afetadas e tratar zero como falha:

```js
const { error, count } = await query.select("*", { count: "exact", head: true });
if (error) throw error;
if (!count) throw new Error("Você não tem permissão para alterar este registro.");
```

Vale desenhar a mensagem em português e explicando o motivo, em vez de repassar
o texto do Postgres. E vale revisar se a interface deveria sequer oferecer o
botão de salvar a quem não tem permissão — esconder a ação é melhor que
bloqueá-la depois da tentativa.

Ao corrigir, conferir também o `useDeleteRow`, que tem a mesma estrutura e
provavelmente o mesmo comportamento em exclusões bloqueadas.
