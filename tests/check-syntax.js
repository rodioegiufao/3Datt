"use strict";

const { spawnSync } = require("node:child_process");

const arquivos = [
  "atividades/dados-gerenciais-relatorio.js",
  "atividades/graficos-relatorio.js",
  "atividades/payload-relatorio.js",
  "atividades/planner-gantt-relatorio.js",
  "api/obras-admin.js",
  "api/_obra-ficha.js",
  "atividades/dashboard-classificacao.js",
  "atividades/atividades-api.js",
  "atividades/atividade-tempo.js",
  "atividades/atividade-semanal-ordenacao.js",
  "atividades/planner-gantt.js",
  "api/_auth.js",
  "api/_obras.js",
  "api/_planner-sync.js",
  "api/obras.js",
  "api/auth.js",
  "api/clash.js",
  "api/usuarios.js",
  "api/atividades.js",
  "api/atividades-semanais.js",
  "api/planner-checklist.js",
  "api/gerar-relatorio-word.js",
  "api/_docx-tabelas.js",
  "api/_relatorio-obra.js",
  "api/gerar-relatorio-obra-word.js",
  "api/gerar-memorando-word.js",
  "api/ifc-to-xkt.js",
  "api/ifc-storage-upload-url.js",
  "api/supabase-public-config.js",
  "atividades/fase-item.js",
  "atividades/classificacoes.js",
  "atividades/atividade-continuacao.js",
  "atividades/classificacoes-ui.js",
  "atividades/planner-modelos.js",
  "atividades/script.js",
  "admin/script.js",
  "memo/script.js",
  "Memorial/memorial-calculo-parser.js",
  "Memorial/docx-memorial-calculo.js",
  "Memorial/script.js"
];

for (const arquivo of arquivos) {
  const resultado = spawnSync(process.execPath, ["--check", arquivo], { stdio: "inherit" });
  if (resultado.status !== 0) process.exit(resultado.status || 1);
}

console.log(`✓ Sintaxe validada em ${arquivos.length} arquivos de produção.`);