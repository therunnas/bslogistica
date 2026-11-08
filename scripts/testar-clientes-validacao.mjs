/**
 * Executa o componente e os handlers reais do cadastro/edição de cliente.
 * Hooks de dados são substituídos para não acessar rede, banco ou sessão.
 * A validade nativa é a fronteira controlada: não simulamos a gramática de
 * e-mail. A ligação form/input/botão também é conferida na árvore React real.
 * Não é teste de navegador nem de persistência.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(import.meta.url);
function load(file, resolve = nativeRequire) {
  const source = readFileSync(path.join(root, file), "utf8");
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "exports", "module", output)(resolve, module.exports, module);
  return module.exports;
}

const format = load("src/lib/format.ts");
const vigencias = load("src/lib/vigencias-ui.ts");
const contratoPeriodo = load("src/lib/contrato-periodo.ts");
const base = {
  id: "",
  name: "Cliente sintético",
  doc: "",
  contact_name: "",
  email: "",
  phone: "",
  status: "active",
  notes: "",
};

function clientPanel(client, { contract, motor = "desligado" } = {}) {
  const saved = [];
  const visual = new Proxy({}, { get: (_, name) => name });
  const query = () => ({ data: [] });
  const resolve = (id) => {
    if (id === "react") {
      return {
        useMemo: (fn) => fn(),
        useState: (initial) => [
          initial && typeof initial === "object" && "contact_name" in initial
            ? { ...base, ...client }
            : initial && typeof initial === "object" && "shift_hours" in initial
              ? { ...initial, ...contract }
              : initial,
          () => {},
        ],
      };
    }
    if (id.startsWith("@/components/ui/") || id === "../_components/app-shell") return visual;
    if (
      [
        "../_components/vigencias",
        "../_components/confirmar-acao-irreversivel",
        "./tarifas-do-contrato",
        "./feriados",
      ].includes(id)
    ) {
      return visual;
    }
    const modules = {
      "@/lib/format": format,
      "@/lib/contrato-periodo": contratoPeriodo,
      "@/lib/vigencias-ui": vigencias,
      "@/lib/queries": {
        useClients: query,
        useContracts: query,
        useEmployees: query,
        useOperations: query,
      },
      "@/lib/mutations": {
        useSaveRow: (table) => ({
          isPending: false,
          mutate: (payload) => {
            assert.equal(table, contract ? "contracts" : "clients");
            saved.push(payload);
          },
        }),
        useDeleteRow: () => ({}),
      },
      "@/lib/funcoes-dados": { useFuncoes: query },
      "@/lib/vigencias-dados": {
        useCriarComVigencia: (tipo) => ({
          isPending: false,
          mutate: (payload) => {
            assert.equal(tipo, "contrato");
            saved.push(payload);
          },
        }),
        useEstadoDoMotor: () => ({ tag: motor }),
        useFuncoesTurno: () => false,
        usePeriodoContratual: () => false,
        useRegrasDefinitivas: () => false,
        useDiariaIndividual: () => false,
        useResolucaoDeTarifas: () => false,
        usePrecoBaseRecuo: () => false,
        useTarifasPorFuncao: () => "indisponivel",
      },
    };
    return id in modules ? modules[id] : nativeRequire(id);
  };
  const tree = load("src/app/(painel)/clientes/painel-clientes.tsx", resolve).PainelClientes();
  return { tree, saved };
}

function nodes(tree) {
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}

function submission(panel, valid) {
  const all = nodes(panel.tree);
  const save = all.find((n) => n.type === "Button" && n.props.children === "Salvar cliente");
  assert.ok(save, "ação real Salvar cliente presente");
  const form = all.find((n) => n.type === "form" && n.props.id === save.props.form);
  const handler = form?.props.onSubmit ?? save.props.onClick;
  assert.equal(typeof handler, "function", "handler real da ação presente");
  let prevented = 0;
  let checked = 0;
  handler({
    preventDefault: () => prevented++,
    currentTarget: {
      reportValidity: () => {
        checked++;
        return valid;
      },
    },
  });
  return { form, save, prevented, checked };
}

for (const [mode, id] of [
  ["cadastro", ""],
  ["edição", "synthetic-client"],
]) {
  test(`${mode}: formulário inválido não envia cliente para persistência`, () => {
    const panel = clientPanel({ id, email: "email-invalido" });
    const result = submission(panel, false);
    assert.deepEqual(panel.saved, [], "formulário inválido deve barrar a mutação");
    assert.equal(result.prevented, 1);
    assert.equal(result.checked, 1);
  });

  test(`${mode}: e-mail opcional vazio continua aceito`, () => {
    const panel = clientPanel({ id, email: "" });
    submission(panel, true);
    assert.deepEqual(panel.saved, [
      {
        ...(id ? { id: "synthetic-client" } : {}),
        name: "Cliente sintético",
        doc: null,
        contact_name: null,
        email: null,
        phone: null,
        status: "active",
        notes: null,
      },
    ]);
  });
}

test("formulário válido preserva o e-mail e envia uma única mutação", () => {
  const panel = clientPanel({ email: "contato@example.invalid" });
  const result = submission(panel, true);
  assert.equal(panel.saved.length, 1);
  assert.equal(panel.saved[0].email, "contato@example.invalid");
  assert.equal(result.prevented, 1, "submit não deve navegar/recarregar a página");
});

test("clique e teclado submetem o mesmo form nativo com e-mail opcional", () => {
  const panel = clientPanel({ email: "" });
  const all = nodes(panel.tree);
  const { form, save } = submission(panel, true);
  assert.ok(form, "Salvar cliente deve pertencer a um formulário real");
  assert.equal(save.props.type, "submit");
  assert.equal(save.props.onClick, undefined, "clique não deve contornar o submit");
  assert.notEqual(form.props.noValidate, true);
  const email = nodes(form).find((n) => n.type === "Input" && n.props.type === "email");
  assert.ok(email, "a validade nativa deve incluir o campo de e-mail");
  assert.notEqual(email.props.required, true, "o e-mail continua opcional");
  const cancel = all.find((n) => n.type === "Button" && n.props.children === "Cancelar");
  assert.equal(cancel.props.type, "button", "cancelar não submete o formulário");
});

// Exercita o botão e o handler reais: remover a guarda de jornada volta a enviar 8 para zero.
function contractSubmission(contract, motor = "desligado") {
  const panel = clientPanel(
    {},
    {
      contract: { name: "Contrato sintético", client_id: "client-test", ...contract },
      motor,
    },
  );
  const all = nodes(panel.tree);
  const save = all.find((n) => n.type === "Button" && n.props.children === "Salvar contrato");
  assert.ok(save);
  save.props.onClick();
  return { ...panel, all, save };
}

for (const motor of ["desligado", "ligado"]) {
  for (const shift_hours of [0, -1, NaN, Infinity]) {
    test(`contrato ${motor}: jornada ${shift_hours} bloqueia botão e envio sem converter para 8`, () => {
      const panel = contractSubmission({ shift_hours }, motor);
      assert.deepEqual(panel.saved, [], "jornada inválida não deve alcançar persistência");
      assert.equal(panel.save.props.disabled, true);
      assert.ok(panel.all.some((n) => n.props?.role === "alert"));
    });
  }
  for (const shift_hours of [4, 7.5, 8]) {
    test(`contrato ${motor}: jornada válida ${shift_hours} é preservada`, () => {
      const panel = contractSubmission({ shift_hours }, motor);
      assert.equal(panel.saved.length, 1);
      const payload = motor === "ligado" ? panel.saved[0].linha : panel.saved[0];
      assert.equal(payload.shift_hours, shift_hours);
    });
  }
}

test("contrato legado: edição de metadados com motor ligado não regrava condições financeiras", () => {
  const panel = contractSubmission(
    { id: "contract-legacy", shift_hours: 7.5, ot_factor: 0.5 },
    "ligado",
  );
  assert.equal(panel.saved.length, 1);
  assert.equal(panel.saved[0].id, "contract-legacy");
  assert.equal(panel.saved[0].name, "Contrato sintético");
  assert.equal("shift_hours" in panel.saved[0], false);
  assert.equal("ot_factor" in panel.saved[0], false);
});
