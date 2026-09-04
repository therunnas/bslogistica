# Apontamento sobrescreve o horário digitado

**Levantado em:** 04/09/2026
**Situação:** diagnóstico apenas. Nada foi corrigido.
**Gravidade:** alta — perde receita sem aviso.
**Correção prevista:** depois da migração para Next.js.

## Causa técnica

Na tela de apontamentos, um `useEffect` reconstrói o rascunho inteiro:

```js
useEffect(() => {
  const base = teamMembers.map((member) => {
    const existing = existingEntries.find((e) => e.employee_id === member.employee_id);
    return {
      ...
      checkOut: existing?.check_out?.slice(0, 5) ?? shift?.end_time.slice(0, 5) ?? "",
      ...
    };
  });
  setDraft([...base, ...extras]);
}, [teamMembers, existingEntries, shift?.start_time, shift?.end_time, shift?.break_minutes]);
```

`teamMembers` e `existingEntries` são `useMemo` sobre dados do React Query.
Sempre que um refetch devolve arrays novos, as identidades mudam, o efeito
dispara e `setDraft` **substitui o que o usuário digitou**.

Quando ainda não existe apontamento gravado, `existing` é indefinido, e o
`checkOut` volta ao `end_time` do turno. O horário digitado desaparece.

O efeito não é idempotente em relação à edição em andamento: ele trata o estado
do servidor como única fonte de verdade e descarta o trabalho local.

## Comportamento confirmado nas duas aplicações

Mesma entrada — Felipe, presente, 06:00 às **17:30**, intervalo 60 — em datas
diferentes para não interferir uma na outra:

| Aplicação | Data | Gravado |
|---|---|---|
| Next.js | 21/10/2026 | 15:00 · 480 min · 0 extra · R$ 180,00 · custo R$ 120,00 |
| TanStack | 22/10/2026 | 15:00 · 480 min · 0 extra · R$ 180,00 · custo R$ 120,00 |

Idênticos. **Não é regressão da migração** — o defeito já existe na aplicação em
uso, e a versão Next.js o reproduz fielmente.

No TanStack o `updated_at` ficou 14 segundos depois do `created_at`: houve duas
escritas, e a segunda gravou por cima com o padrão do turno.

O Next.js torna o defeito mais fácil de disparar, porque o App Router liga
`reactStrictMode` por padrão e o StrictMode invoca efeitos duas vezes em
desenvolvimento. O StrictMode **revela** o problema, não o cria — desligá-lo
esconderia uma perda real de dados.

## Impacto financeiro

O valor perdido é justamente a hora extra. No caso observado, 2h30 de trabalho
deixaram de ser apontadas: **R$ 264,38 viraram R$ 180,00**, uma diferença de
R$ 84,38 num único apontamento.

A perda é invisível: a tela mostra o cálculo correto enquanto se digita, e o
usuário salva acreditando ter registrado o que via. Quem confere depois encontra
número menor, sem nada indicando que houve sobrescrita.

Também explica um resultado que parecia bom: o apontamento de 04/09 com 630 min
e R$ 264,38 só ficou correto porque foi salvo duas vezes, e na segunda o efeito
reaproveitou o valor já gravado. Foi sequência favorável, não robustez.

## Como reproduzir

1. Abrir apontamentos numa operação com turno cadastrado.
2. Alterar a saída para um horário maior que o fim do turno.
3. Aguardar alguns segundos, ou trocar de aba e voltar.
4. Salvar. O valor gravado é o `end_time` do turno, não o digitado.

## Direção da correção

O efeito precisa parar de descartar edição em andamento:

- reconstruir o rascunho apenas quando muda a **identidade do contexto**
  (operação, data, turno), e não a cada chegada de dados;
- ou preservar as linhas já tocadas pelo usuário, mesclando em vez de
  substituir;
- ou marcar o formulário como "sujo" e suspender a reconstrução enquanto houver
  alteração não salva.

Vale também alertar antes de sair da tela com alteração pendente.

Como o cálculo é feito no navegador e enviado pronto, essa correção conversa
com a do faturamento transacional: mover o cálculo para o servidor tiraria do
frontend a autoridade sobre o valor.
