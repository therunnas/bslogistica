/**
 * C07 — salvamento do administrador: rascunho, contexto e concorrência.
 *
 * COMO RODAR:  npm run test:apontamentos-c07
 *
 * Funções puras de `src/lib/apontamentos-salvar.ts` (sem rede nem banco). O lado do banco
 * (folha e linhas atômicas, retry sem duplicar, falha parcial sem folha vazia) é da suíte SQL
 * `supabase/tests/030_integridade_folha_e_historico.sql`.
 *
 *   A  edição desfeita deixa de ser pendência
 *   B  duas edições concorrentes e edição durante o salvamento
 *   C  retorno atrasado de outro contexto (operação, turno, data)
 *   D  carga da RPC e "só linhas alteradas, sem presença artificial"
 *   E  forma da tela
 */

import { readFileSync } from "node:fs";

import {
  assinaturaDaLinha,
  assinaturasSalvas,
  deveAplicarResultado,
  dirtyAposEdicao,
  dirtyAposSalvar,
  linhasParaSalvar,
  montarCargaDaRpc,
} from "../src/lib/apontamentos-salvar.ts";

let passou = 0;
const falhas = [];
function verificar(caso, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    passou++;
    console.log(`  PASS  ${caso}`);
  } else {
    falhas.push(`${caso} — esperado ${b}, obtido ${a}`);
    console.log(`  FAIL  ${caso} — esperado ${b}, obtido ${a}`);
  }
}
const lista = (s) => [...s].sort();

const linha = (o = {}) => ({
  employeeId: "e1",
  entryId: "id-1",
  status: "present",
  checkIn: "06:00",
  checkOut: "15:00",
  breakMinutes: 60,
  notes: "",
  ...o,
});
const gravado = (o = {}) => ({
  id: "id-1",
  employee_id: "e1",
  status: "present",
  check_in: "06:00:00",
  check_out: "15:00:00",
  break_minutes: 60,
  notes: null,
  invoice_id: null,
  ...o,
});

console.log("\nA. Edição desfeita\n");
{
  const sujo = dirtyAposEdicao(new Set(), linha({ checkOut: "16:00" }), gravado());
  verificar("A1. editar a saída: a linha fica pendente", lista(sujo), ["e1"]);
  verificar(
    "A2. voltar à saída gravada: deixa de ser pendência",
    lista(dirtyAposEdicao(sujo, linha(), gravado())),
    [],
  );
  verificar(
    "A3. mudar o status e voltar: deixa de ser pendência",
    lista(
      dirtyAposEdicao(
        dirtyAposEdicao(new Set(), linha({ status: "absent" }), gravado()),
        linha(),
        gravado(),
      ),
    ),
    [],
  );
  verificar(
    "A4. nota digitada e apagada: deixa de ser pendência",
    lista(
      dirtyAposEdicao(
        dirtyAposEdicao(new Set(), linha({ notes: "x" }), gravado()),
        linha({ notes: "" }),
        gravado(),
      ),
    ),
    [],
  );
  verificar(
    "A5. nota só com espaço continua diferente (não se apara em silêncio)",
    lista(dirtyAposEdicao(new Set(), linha({ notes: " " }), gravado())),
    ["e1"],
  );
  verificar(
    "A6. '06:00' e '06:00:00' são o mesmo horário: nada pendente",
    lista(
      dirtyAposEdicao(new Set(), linha({ checkIn: "06:00" }), gravado({ check_in: "06:00:00" })),
    ),
    [],
  );
  verificar(
    "A7. desfazer uma linha não limpa a pendência de OUTRA",
    lista(dirtyAposEdicao(new Set(["e2"]), linha(), gravado())),
    ["e2"],
  );
  verificar(
    "A8. linha nova (sem registro no servidor) com decisão: pendente",
    lista(dirtyAposEdicao(new Set(), linha({ entryId: undefined, status: "present" }), undefined)),
    ["e1"],
  );
  verificar(
    "A9. linha nova que volta a 'não apontado': deixa de ser pendência",
    lista(dirtyAposEdicao(new Set(["e1"]), linha({ entryId: undefined, status: null }), undefined)),
    [],
  );
  verificar(
    "A10. intervalo NaN conta como 0 e difere de 60",
    lista(dirtyAposEdicao(new Set(), linha({ breakMinutes: Number.NaN }), gravado())),
    ["e1"],
  );
  verificar(
    "A11. a função não muta o conjunto recebido",
    (() => {
      const s = new Set(["e1"]);
      dirtyAposEdicao(s, linha(), gravado());
      return lista(s);
    })(),
    ["e1"],
  );
}

console.log("\nB. Concorrência: edição durante o salvamento e duas edições\n");
{
  const enviada = linha({ checkOut: "16:00" });
  const salvas = assinaturasSalvas([enviada]);
  const dirty = new Set(["e1", "e2"]);
  const agoraIgual = [enviada, linha({ employeeId: "e2", entryId: "id-2" })];
  verificar(
    "B1. linha salva e inalterada sai da pendência; a que não entrou no lote fica",
    lista(dirtyAposSalvar(dirty, agoraIgual, salvas)),
    ["e2"],
  );
  const editouDuranteOSave = [
    linha({ checkOut: "17:00" }),
    linha({ employeeId: "e2", entryId: "id-2" }),
  ];
  verificar(
    "B2. edição feita ENQUANTO salvava continua pendente (a alteração nova não se perde)",
    lista(dirtyAposSalvar(dirty, editouDuranteOSave, salvas)),
    ["e1", "e2"],
  );
  verificar(
    "B3. salvamento vazio não limpa nada",
    lista(dirtyAposSalvar(dirty, agoraIgual, new Map())),
    ["e1", "e2"],
  );
  verificar(
    "B4. duas edições concorrentes em colaboradores diferentes: só a salva sai",
    lista(
      dirtyAposSalvar(
        new Set(["e1", "e2"]),
        [
          linha({ checkOut: "16:00" }),
          linha({ employeeId: "e2", entryId: "id-2", checkOut: "18:00" }),
        ],
        assinaturasSalvas([linha({ checkOut: "16:00" })]),
      ),
    ),
    ["e2"],
  );
  verificar(
    "B5. a assinatura ignora o que o salvamento não leva (id da linha) e normaliza horário",
    assinaturaDaLinha(linha({ entryId: "outro", checkIn: "06:00" })) ===
      assinaturaDaLinha(linha({ checkIn: "06:00" })),
    true,
  );
  verificar(
    "B6. falta com horários digitados tem a mesma assinatura (falta não grava horário)",
    assinaturaDaLinha(linha({ status: "absent", checkIn: "07:00", checkOut: "09:00" })) ===
      assinaturaDaLinha(linha({ status: "absent", checkIn: "", checkOut: "" })),
    true,
  );
}

console.log("\nC. Retorno atrasado de outro contexto\n");
{
  const contexto = (op, turno, data) => `${op}|${turno}|${data}`;
  const original = contexto("op1", "t1", "2026-03-02");
  verificar(
    "C1. mesmo contexto: aplica",
    deveAplicarResultado(original, contexto("op1", "t1", "2026-03-02")),
    true,
  );
  verificar(
    "C2. trocou a operação: NÃO aplica",
    deveAplicarResultado(original, contexto("op2", "t1", "2026-03-02")),
    false,
  );
  verificar(
    "C3. trocou o turno: NÃO aplica",
    deveAplicarResultado(original, contexto("op1", "t2", "2026-03-02")),
    false,
  );
  verificar(
    "C4. trocou a data: NÃO aplica",
    deveAplicarResultado(original, contexto("op1", "t1", "2026-03-03")),
    false,
  );
  verificar(
    "C5. voltou ao contexto original: aplica (e a comparação das assinaturas ainda protege)",
    deveAplicarResultado(original, original),
    true,
  );
}

console.log("\nD. Carga da RPC e só linhas alteradas\n");
{
  const carga = montarCargaDaRpc([
    linha({ checkOut: "16:30" }),
    linha({
      employeeId: "e2",
      status: "absent",
      checkIn: "08:00",
      checkOut: "09:00",
      notes: "faltou",
    }),
  ]);
  verificar(
    "D1. a carga leva só as colunas editáveis, sem id, folha, contexto nem derivados",
    Object.keys(carga[0]).sort(),
    ["break_minutes", "check_in", "check_out", "employee_id", "notes", "status"],
  );
  verificar(
    "D2. horário com segundos; nota vazia vira null",
    [carga[0].check_in, carga[0].check_out, carga[0].notes],
    ["06:00:00", "16:30:00", null],
  );
  verificar(
    "D3. falta não grava horário e preserva a nota",
    [carga[1].check_in, carga[1].check_out, carga[1].notes],
    [null, null, "faltou"],
  );
  const linhas = [
    linha(),
    linha({ employeeId: "e2", entryId: "id-2", checkOut: "17:00" }),
    linha({ employeeId: "e3", entryId: undefined }),
  ];
  const gravados = [gravado(), gravado({ id: "id-2", employee_id: "e2" })];
  verificar(
    "D4. só entra a linha alterada e tocada, e a nova; a equipe intacta não gera presença artificial",
    linhasParaSalvar(linhas, new Set(["e2"]), gravados).map((l) => l.employeeId),
    ["e2", "e3"],
  );
  verificar(
    "D5. linha tocada e desfeita (fora do dirty) não entra no lote",
    linhasParaSalvar(
      linhas,
      dirtyAposEdicao(
        new Set(["e2"]),
        linha({ employeeId: "e2", entryId: "id-2" }),
        gravado({ id: "id-2", employee_id: "e2" }),
      ),
      gravados,
    ).map((l) => l.employeeId),
    ["e3"],
  );
  verificar(
    "D6. linha faturada nunca entra",
    linhasParaSalvar([linha({ checkOut: "18:00" })], new Set(["e1"]), [
      gravado({ invoice_id: "inv" }),
    ]).length,
    0,
  );
}

console.log("\nE. Forma da tela\n");
{
  const fonte = readFileSync(
    new URL("../src/app/(painel)/apontamentos/painel-apontamentos.tsx", import.meta.url),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  verificar(
    "E1. o salvamento chama a RPC atômica com a carga montada pelo módulo",
    /\.rpc\("salvar_apontamento_admin"/.test(fonte) && /montarCargaDaRpc\(/.test(fonte),
    true,
  );
  verificar(
    "E2. o resultado volta com o contexto e as assinaturas do ENVIO",
    /contexto: contextKey,\s*salvas: assinaturasSalvas\(/.test(fonte),
    true,
  );
  verificar(
    "E3. onSuccess só aplica no mesmo contexto e só limpa quem foi salvo sem mudança",
    /deveAplicarResultado\(contexto, atual\.key\)/.test(fonte) &&
      /dirtyAposSalvar\(atual\.dirty/.test(fonte),
    true,
  );
  verificar(
    "E4. o onSuccess não zera o conjunto inteiro",
    /dirty: new Set<string>\(\)\s*,?\s*\}\s*:\s*atual/.test(fonte),
    false,
  );
  verificar(
    "E5. a edição passa por dirtyAposEdicao (desfazer limpa)",
    /dirtyAposEdicao\(atual\.dirty/.test(fonte) && !/dirty\.add\(employeeId\)/.test(fonte),
    true,
  );
  verificar(
    "E6. falha relê as consultas (a tela fica fiel ao banco para o retry)",
    /onError[\s\S]{0,200}invalidateQueries\(\{ queryKey: \["timesheets"\]/.test(fonte),
    true,
  );
  verificar(
    "E7. banco sem a 031: caminho anterior só quando a função não existe (PGRST202)",
    /error\.code === CODIGO_DA_RPC_AUSENTE/.test(fonte),
    true,
  );
}

console.log(`\n${passou} asserções passaram, ${falhas.length} falharam.\n`);
if (falhas.length > 0) {
  for (const f of falhas) console.log(`  FALHA  ${f}`);
  process.exit(1);
}
