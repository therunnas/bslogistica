# Sistema de Gestão Operacional e Financeira — Mão de Obra Terceirizada

SaaS interno para controlar o fluxo completo: Cliente → Contrato/Regra → Operação → Turno → Equipe → Apontamento diário → Horas extras → Cálculo → Faturamento → Resultado.

## Módulos

1. **Clientes** — cadastro, contatos, CNPJ, status.
2. **Contratos / Regras de cobrança** — por cliente: valor da diária, jornada padrão (horas do turno), fator de hora extra, tolerância em minutos, vigência.
3. **Operações** — dois tipos:
   - *Fixa* (ex.: Ludovico): local, turnos recorrentes, equipe planejada.
   - *Avulsa* (carga/descarga): data, tipo de demanda, valor acordado.
4. **Turnos** — horário de entrada/saída e intervalo (ex.: 06:00–15:00 com 12:00–13:00; 15:00–00:00, com virada de dia tratada).
5. **Colaboradores** — dados, função, custo de diária pago.
6. **Equipes / Alocação** — quem está planejado em cada operação/turno.
7. **Apontamento diário** — por data e turno: presente / falta / substituição, entrada, saída, intervalo. Gera 1 diária por colaborador presente + horas excedentes.
8. **Fechamento e Faturamento** — consolida período por cliente/operação: diárias, horas extras, valores, prévia de fatura, exportação (CSV/PDF).
9. **Financeiro / Resultado** — receita, custo com colaboradores, margem por cliente, operação e período.
10. **Dashboard** — visão executiva e operacional.
11. **Usuários e permissões** — apenas equipe interna: Admin (tudo) e Operacional (lança apontamentos, sem valores sensíveis).

## Regras de cálculo

- **Diárias faturadas** = colaboradores efetivamente presentes × dias trabalhados. Faltas não geram cobrança.
- **Hora extra** = (valor_diaria ÷ horas_do_turno) × horas excedentes, com tolerância em minutos configurável no contrato.
- **Horas trabalhadas** = (saída − entrada) − intervalo; turno que cruza a meia-noite é calculado corretamente.
- **Receita da operação** = Σ diárias + Σ horas extras (+ valores acordados avulsos).
- **Custo** = Σ (diárias realizadas × custo de diária do colaborador) + custo proporcional das horas extras.
- **Margem** = Receita − Custo; % sobre receita.
- Valores usados no cálculo são **congelados no apontamento** (snapshot), para que mudanças futuras de tabela não alterem históricos já fechados.

## Dashboard

- KPIs do período: diárias realizadas, horas extras, receita, custo, margem, taxa de absenteísmo.
- Gráficos: receita por cliente, receita por operação, evolução mensal, diárias por turno, ranking de horas extras.
- Painel operacional do dia: operações ativas, presenças pendentes de lançamento, faltas.
- Relatórios filtráveis por período, cliente, operação e colaborador, com exportação.

## Estrutura de dados (técnico)

Backend no Lovable Cloud (Postgres + autenticação), acesso somente para usuários internos autenticados, com RLS em todas as tabelas e papéis em tabela separada (`user_roles` + função `has_role`).

Tabelas principais:

```text
clients(id, name, doc, contact, status)
contracts(id, client_id, daily_rate, shift_hours, ot_factor, ot_tolerance_min, valid_from, valid_to)
employees(id, name, doc, role, daily_cost, status)
operations(id, client_id, contract_id, type[fixed|spot], name, site, status)
shifts(id, operation_id, name, start_time, end_time, break_start, break_end, crosses_midnight)
operation_team(id, operation_id, shift_id, employee_id, active)
timesheets(id, operation_id, shift_id, work_date, status[open|closed], created_by)
timesheet_entries(id, timesheet_id, employee_id, status[present|absent|replacement],
                  check_in, check_out, break_min, worked_min, overtime_min,
                  daily_rate_snapshot, ot_rate_snapshot, daily_cost_snapshot, notes)
invoices(id, client_id, period_start, period_end, status[draft|closed|issued],
         total_dailies, total_overtime, total_amount)
invoice_items(id, invoice_id, operation_id, description, qty, unit_price, amount)
```

Cada `CREATE TABLE` acompanha os GRANTs necessários e políticas RLS restritas a usuários autenticados internos. Cálculos ficam em server functions (`createServerFn`) para garantir consistência, com views/consultas agregadas alimentando o dashboard.

## Fases de entrega

1. Backend (Cloud), autenticação interna, schema completo, papéis e RLS.
2. Cadastros: clientes, contratos, colaboradores, operações, turnos, equipes.
3. Apontamento diário com cálculo automático de diárias e horas extras.
4. Fechamento, prévia de fatura e exportação.
5. Custos, margem e dashboard com KPIs e relatórios.
