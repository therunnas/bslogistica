/**
 * Interface simples (FIN-01): sem controles técnicos na rotina, e Faturamento sem mensagem presa.
 *
 * COMO RODAR:  npm run test:interface-simples
 *
 * Sem rede nem navegador. Duas metades: o comportamento das funções puras (textos do aviso,
 * mensagens de indisponibilidade) e a forma literal dos arquivos.
 *
 *   A  navegação: a implantação sai do menu, a rota continua protegida no servidor
 *   B  textos: nenhum "motor" nas telas comerciais; alertas e falhas preservados
 *   C  Faturamento: consulta desabilitada orienta, consulta real continua "carregando"
 *   D  preservado: ações com AAL2, travas, reversão, Fechamento
 */

import { readFileSync } from "node:fs";

import { avisoDoMotor, interpretarEstadoDoMotor } from "../src/lib/vigencias-ui.ts";
import {
  MENSAGEM_DE_INDISPONIBILIDADE,
  decidirDisponibilidade,
} from "../src/lib/fechamento/disponibilidade.ts";

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
const ler = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const semComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PAINEL = "src/app/(painel)";

console.log("\nA. Navegação\n");
const shell = ler(`${PAINEL}/_components/app-shell.tsx`);
const shellCodigo = semComentarios(shell);
verificar(
  "A1. 'Implantação das vigências' não está em nenhum menu de conta",
  /MENU_DE_CONTA = \{\s*admin: \[ITEM_USUARIOS, ITEM_SEGURANCA\],\s*operacional: \[ITEM_SEGURANCA\],\s*"sem-papel": \[\],\s*\} as const;/.test(
    shellCodigo,
  ),
  true,
);
verificar(
  "A2. nem na navegação principal",
  /NAVEGACAO[\s\S]*?\} as const;/.test(shellCodigo) &&
    !/NAVEGACAO[\s\S]*?implantacao[\s\S]*?\} as const;\s*\nconst ITEM_USUARIOS/.test(shellCodigo),
  true,
);
verificar(
  "A3. a rota técnica só nomeia o título da página (não gera link)",
  /const ROTA_TECNICA_IMPLANTACAO = \{\s*href: "\/implantacao-vigencias"/.test(shellCodigo) &&
    (shellCodigo.match(/ROTA_TECNICA_IMPLANTACAO/g) ?? []).length === 2,
  true,
);
verificar(
  "A4. nenhum Link/href renderiza a rota técnica",
  !/href=\{?"?\/implantacao-vigencias/.test(
    shellCodigo.replace(/const ROTA_TECNICA_IMPLANTACAO = \{[\s\S]*?\} as const;/, ""),
  ),
  true,
);
verificar(
  "A5. o Fechamento segue no menu do admin, condicionado ao banco",
  /href: "\/fechamento"/.test(shellCodigo) &&
    /useFechamentoDisponivel\(papel === "admin"\)/.test(shellCodigo),
  true,
);
const pagina = semComentarios(ler(`${PAINEL}/implantacao-vigencias/page.tsx`));
verificar(
  "A6. a rota segue protegida NO SERVIDOR: guard crítico (admin com AAL2 de fato) antes de qualquer conteúdo",
  /const bloqueio = await exigirAdmin\(\);\s*if \(bloqueio\) return bloqueio;/.test(pagina),
  true,
);

console.log("\nB. Textos\n");
const estados = [
  { tag: "carregando" },
  { tag: "desligado" },
  { tag: "ligado", ativadaEm: "2026-10-29" },
  { tag: "desconhecido", motivo: "Falha qualquer." },
];
const avisos = estados.map((e) => avisoDoMotor(e));
verificar(
  "B1. nenhum aviso comercial cita 'motor', 'gatilho' ou 'migration'",
  avisos.some((a) => /motor|gatilho|migration/i.test(`${a.titulo} ${a.texto}`)),
  false,
);
verificar(
  "B2. o aviso do estado normal fala de vigência por data e de reajuste",
  [
    /vigência da data trabalhada/.test(avisos[2].texto),
    /nova vigência/.test(avisos[2].texto),
    avisos[2].titulo,
  ],
  [true, true, "Valores por data de vigência"],
);
verificar(
  "B3. estado desconhecido continua sendo ALERTA e mostra o motivo",
  [avisos[3].nivel, avisos[3].texto.includes("Falha qualquer.")],
  ["alerta", true],
);
verificar(
  "B4. o aviso do estado anterior (sem vigências aplicadas) continua existindo, em linguagem simples",
  [avisos[1].titulo, /motor/i.test(avisos[1].texto)],
  ["Vigências ainda não aplicadas", false],
);
const respostas = [
  interpretarEstadoDoMotor(null, { code: "42501" }),
  interpretarEstadoDoMotor(null, { code: "XX000" }),
  interpretarEstadoDoMotor("x", null),
  interpretarEstadoDoMotor({ ativo: "sim" }, null),
  interpretarEstadoDoMotor({ ativo: true, consistente: false }, null),
];
verificar(
  "B5. falhas e inconsistência seguem 'desconhecido' (nunca viram 'ligado') e sem a palavra 'motor'",
  respostas.map((r) => [r.tag, /motor/i.test(r.motivo ?? "")]),
  respostas.map(() => ["desconhecido", false]),
);
verificar(
  "B6. estado ligado e consistente continua 'ligado'",
  interpretarEstadoDoMotor({ ativo: true, consistente: true, ativada_em: "2026-10-29" }, null).tag,
  "ligado",
);
verificar(
  "B7. mensagens de indisponibilidade do Fechamento: sem 'motor' e todas presentes",
  [
    Object.keys(MENSAGEM_DE_INDISPONIBILIDADE).length,
    Object.values(MENSAGEM_DE_INDISPONIBILIDADE).some((m) => /motor/i.test(m)),
  ],
  [4, false],
);
verificar(
  "B8. a regra de disponibilidade não mudou (ligado + 030 = disponível; desligado = não)",
  [
    decidirDisponibilidade({ ativo: true, consistente: true, regras_definitivas: true }, null)
      .disponivel,
    decidirDisponibilidade({ ativo: false, consistente: true, regras_definitivas: true }, null)
      .disponivel,
  ],
  [true, false],
);
const telas = [
  "clientes/painel-clientes.tsx",
  "colaboradores/painel-colaboradores.tsx",
  "operacoes/painel-operacoes.tsx",
  "apontamentos/painel-apontamentos.tsx",
  "_components/vigencias.tsx",
];
for (const t of telas) {
  const codigo = semComentarios(ler(`${PAINEL}/${t}`));
  const literais = [...codigo.matchAll(/"([^"\n]*)"|`([^`\n]*)`|>([^<>{}\n]+)</g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? "",
  );
  verificar(
    `B9. ${t}: nenhuma frase visível cita 'motor'`,
    literais.filter((l) => /\bmotor\b/i.test(l)),
    [],
  );
}
verificar(
  "B10. a prévia de apontamento: mensagens sem 'motor'",
  /motor/i.test(
    semComentarios(ler("src/lib/apontamentos-financeiro.ts")).match(
      /INDISPONIVEL\(\s*estado\.tag[\s\S]*?false,/,
    )?.[0] ?? "motor",
  ),
  false,
);

console.log("\nC. Faturamento\n");
const painelFat = semComentarios(ler(`${PAINEL}/faturamento/painel-faturamento.tsx`));
const arred = semComentarios(ler(`${PAINEL}/faturamento/arredondamento.tsx`));
const adic = semComentarios(ler(`${PAINEL}/faturamento/adicionais.tsx`));
verificar(
  "C1. consulta desabilitada vira 'aguardando' (pendente e sem busca), não 'carregando'",
  /aguardando=\{ajustes\.isPending && !ajustes\.isFetching\}/.test(painelFat) &&
    /aguardando=\{adicionais\.isPending && !adicionais\.isFetching\}/.test(painelFat),
  true,
);
verificar(
  "C2. o loading real é isLoading (há consulta em curso), nunca isPending",
  /carregando=\{ajustes\.isLoading\}/.test(painelFat) &&
    /carregando=\{adicionais\.isLoading\}/.test(painelFat) &&
    !/carregando=\{(ajustes|adicionais)\.isPending\}/.test(painelFat),
  true,
);
verificar(
  "C3. sem cliente: orientação neutra nos dois blocos",
  /Selecione um cliente e um período válido para ver o arredondamento acumulado\./.test(arred) &&
    /Selecione um cliente e um período válido para ver os adicionais\./.test(adic),
  true,
);
verificar(
  "C4. a ordem é erro > aguardando > carregando > conteúdo (falha nunca fica escondida)",
  /erro \? \([\s\S]*?\) : aguardando \? \([\s\S]*?\) : carregando \? \(/.test(arred) &&
    /erro \? \([\s\S]*?\) : aguardando \? \([\s\S]*?\) : carregando \? \(/.test(adic),
  true,
);
verificar(
  "C5. o loading real continua com texto próprio",
  /Calculando o arredondamento…/.test(arred) && /Carregando adicionais…/.test(adic),
  true,
);
verificar(
  "C6. cálculo e geração intactos: a fatura ainda exige as leituras concluídas (isSuccess)",
  /adicionaisProntos = !regrasBs \|\| adicionais\.isSuccess/.test(painelFat) &&
    /ajustesProntos = !regrasDefinitivas \|\| ajustes\.isSuccess/.test(painelFat) &&
    /round2\(totals\.billed \+ totalAdicionais \+ totalAjustes\)/.test(painelFat),
  true,
);
verificar(
  "C7. o bloco de arredondamento continua escondido quando há cliente e nada a mostrar",
  /if \(!aguardando && !carregando && !erro && ajustes\.length === 0\) return null;/.test(arred),
  true,
);
// UX-FATURA-01: a fatura emitida é imutável; "Gerar fatura" só abre a confirmação, e a
// emissão (generate.mutate) acontece apenas em "Emitir fatura", uma vez, sem consulta nova.
// CP-07 (D4): antes de abrir, a confirmação relê os dados (`abrirConfirmacao`); ela continua só
// abrindo o diálogo — nenhuma emissão dentro dela.
const abrirConfirmacaoFat =
  /async function abrirConfirmacao\(\) \{([\s\S]*?)\n {2}\}/.exec(painelFat)?.[1] ?? "";
verificar(
  "C8. 'Gerar fatura' abre a confirmação e não emite direto",
  /onClick=\{\(\) => void abrirConfirmacao\(\)\}/.test(painelFat) &&
    /setConfirmarFatura\(true\)/.test(abrirConfirmacaoFat) &&
    !/generate\.mutate|\.rpc\(/.test(abrirConfirmacaoFat) &&
    !/onClick=\{\(\) => generate\.mutate\(\)\}/.test(painelFat),
  true,
);
verificar(
  "C9. a confirmação é um AlertDialog controlado",
  /from "@\/components\/ui\/alert-dialog"/.test(painelFat) &&
    /<AlertDialog\s+open=\{confirmarFatura\}/.test(painelFat),
  true,
);
verificar(
  "C10. generate.mutate só é chamado dentro de emitirFatura, uma única vez no arquivo",
  (painelFat.match(/generate\.mutate\(/g) ?? []).length === 1 &&
    /function emitirFatura\(\)[\s\S]{0,400}generate\.mutate\(/.test(painelFat),
  true,
);
verificar(
  "C11. a confirmação mostra cliente, período, apontamentos, adicionais e total com os dados da tela",
  /clientName\(selectedClient\)/.test(painelFat) &&
    /dateBR\(start\)[\s\S]{0,40}dateBR\(end\)/.test(painelFat) &&
    /\{period\.length\}/.test(painelFat) &&
    /\{adicionaisElegiveis\.length\}/.test(painelFat) &&
    /\{brl\(totalAFaturar\)\}/.test(painelFat),
  true,
);
verificar(
  "C12. aviso de imutabilidade",
  painelFat.includes("A fatura emitida não pode ser alterada nem apagada."),
  true,
);
verificar(
  "C13. botões 'Cancelar' (foco inicial) e 'Emitir fatura'",
  /<AlertDialogCancel[^>]*ref=\{cancelarFaturaRef\}/.test(painelFat) &&
    /onOpenAutoFocus=\{[\s\S]{0,120}cancelarFaturaRef\.current\?\.focus\(\)/.test(painelFat) &&
    /Cancelar\s*<\/AlertDialogCancel>/.test(painelFat) &&
    /Emitir fatura/.test(painelFat),
  true,
);
verificar(
  "C14. em andamento, os dois botões ficam desabilitados e o diálogo não fecha",
  /<AlertDialogCancel[^>]*disabled=\{generate\.isPending\}/.test(painelFat) &&
    /<AlertDialogAction[^>]*disabled=\{generate\.isPending\}/.test(painelFat) &&
    /onOpenChange=\{\(aberto\) => \{\s*if \(!generate\.isPending\) setConfirmarFatura\(aberto\);/.test(
      painelFat,
    ),
  true,
);
verificar(
  "C15. a confirmação não dispara duas emissões (trava antes do mutate e evento padrão anulado)",
  /if \(emitindoRef\.current \|\| generate\.isPending\) return;\s*emitindoRef\.current = true;/.test(
    painelFat,
  ) && /event\.preventDefault\(\);\s*emitirFatura\(\);/.test(painelFat),
  true,
);

console.log("\nE. Apontamento faturado (UX-FATURA-02)\n");
// O lançamento faturado é imutável no banco. A tela já travava os campos; agora diz por quê:
// a linha mostra "Faturado", o cabeçalho conta quantos estão faturados e "Salvar" fica
// indisponível quando nenhuma linha do dia é editável. "Fechar dia" segue igual (é só status).
const painelApont = semComentarios(ler(`${PAINEL}/apontamentos/painel-apontamentos.tsx`));
verificar(
  "E1. conta as linhas faturadas do dia a partir do conjunto que já trava os campos",
  /const qtdFaturados = linhas\.filter\(\(linha\) => faturados\.has\(linha\.employeeId\)\)\.length;/.test(
    painelApont,
  ) &&
    /const todasFaturadas = linhas\.length > 0 && qtdFaturados === linhas\.length;/.test(
      painelApont,
    ),
  true,
);
verificar(
  "E2. 'Salvar' indisponível quando todas as linhas do dia estão faturadas",
  /linhasBloqueadas\.length > 0 \|\|\s*todasFaturadas\s*\}/.test(painelApont),
  true,
);
verificar(
  "E3. a linha faturada mostra o rótulo 'Faturado'",
  /faturados\.has\(row\.employeeId\) \? \(\s*<Badge[\s\S]{0,400}?Faturado\s*<\/Badge>/.test(
    painelApont,
  ),
  true,
);
verificar(
  "E4. o cabeçalho informa quantos lançamentos do dia estão faturados",
  /qtdFaturados > 0 \? \(\s*<Badge[\s\S]{0,400}?\{qtdFaturados\} de \{linhas\.length\} faturado/.test(
    painelApont,
  ),
  true,
);
verificar(
  "E5. aviso quando o dia inteiro está faturado",
  painelApont.includes(
    "Todos os lançamentos deste dia já foram faturados e não podem ser alterados.",
  ),
  true,
);
verificar(
  "E6. 'Fechar dia' / 'Reabrir' preservado (mesma condição de antes)",
  /onClick=\{\(\) => toggleStatus\.mutate\(isClosed \? "open" : "closed"\)\}\s*disabled=\{!timesheet \|\| leitura\.estado !== "pronto"\}/.test(
    painelApont,
  ),
  true,
);

console.log("\nD. Preservado\n");
const acoes = semComentarios(ler(`${PAINEL}/implantacao-vigencias/_acoes.ts`));
verificar(
  "D1. ativação e reversão seguem exigindo admin AAL2 antes de qualquer outra coisa",
  [
    /ligarMotorAction[\s\S]*?exigirAdminAtor\(\)/.test(acoes),
    /desligarMotorAction[\s\S]*?exigirAdminAtor\(\)/.test(acoes),
  ],
  [true, true],
);
verificar(
  "D2. as duas travas de servidor continuam independentes",
  /VARIAVEL_DE_ATIVACAO/.test(acoes) && /VARIAVEL_DE_REVERSAO/.test(acoes),
  true,
);
verificar(
  "D3. os controles continuam na rota técnica (ativar e desligar)",
  /<AtivarMotor/.test(
    semComentarios(ler(`${PAINEL}/implantacao-vigencias/painel-implantacao.tsx`)),
  ) &&
    /<DesligarMotor/.test(semComentarios(ler(`${PAINEL}/implantacao-vigencias/ativar-motor.tsx`))),
  true,
);
verificar(
  "D4. o runbook de reversão continua versionado",
  ler("docs/runbooks/reversao-do-motor.md").includes("alterar_motor_vigencia"),
  true,
);
verificar(
  "D5. nenhum controle de motor foi para outra tela",
  telas.some((t) =>
    /ligarMotorAction|desligarMotorAction|AtivarMotor|DesligarMotor/.test(ler(`${PAINEL}/${t}`)),
  ),
  false,
);

console.log("");
if (falhas.length > 0) {
  console.log(`${passou} passaram, ${falhas.length} falharam.`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`${passou} asserções passaram, 0 falharam.`);
