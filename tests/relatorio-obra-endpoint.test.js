"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const PizZip = require("pizzip");
const { criarGeradorRelatorioObraWord } = require("../api/gerar-relatorio-obra-word");

const obra = { id: "obra-20", codigo: "OBR-000020", nome: "IPER" };
const entrega = { id: "entrega-1", obra_id: obra.id, tipo_emissao: "revisao", revisao: "REV01", data_entrega: "2026-09-29", periodo_inicio: "2026-09-29", periodo_fim: "2026-09-29", link_processo: "https://exemplo.com/documentacao", observacoes: "" };
const dados = {
  obra,
  entrega,
  projetosFicha: [{ projeto: "Elétrico Baixa Tensão", projeto_chave: "eletrico-baixa-tensao" }],
  atividades: [{ id: "atividade-1", obra_id: obra.id, projeto: "Elétrico Baixa Tensão", colaborador: "Rodrigo", trabalhos: "Desenvolvimento do projeto", data_inicio: "2026-09-29", hora_inicio: "08:00", data_termino: "2026-09-29", hora_termino: "18:00", status: "Finalizado", prioridade: "P2", classificacoes: [] }],
  planner: [], entregas: [entrega], projetosEntrega: []
};

const handler = criarGeradorRelatorioObraWord({
  requireUser: async () => ({ perfil: "admin" }),
  parseRequestBody: (req) => req.body,
  carregarDadosObra: async () => dados
});
const resposta = { statusCode: 0, headers: {}, body: null, setHeader(nome, valor) { this.headers[nome] = valor; }, status(codigo) { this.statusCode = codigo; return this; }, send(body) { this.body = body; return this; }, json(body) { this.body = body; return this; } };

(async () => {
  await handler({ method: "POST", body: { obraId: obra.id, entregaId: entrega.id } }, resposta);
  assert.equal(resposta.statusCode, 200);
  assert.match(resposta.headers["Content-Disposition"], /relatorio-entrega-OBR-000020-IPER-REV01\.docx/);
  assert.ok(Buffer.isBuffer(resposta.body));
  const arquivo = path.join("/tmp", "relatorio-entrega-OBR-000020-IPER-REV01.docx"); fs.writeFileSync(arquivo, resposta.body);
  const zip = new PizZip(resposta.body); const xml = zip.file("word/document.xml").asText();
  assert.match(xml, /Elétrico Baixa Tensão/); assert.match(xml, /10,00 h/); assert.match(xml, /w:fill="1F4E78"/); assert.match(xml, /w:color w:val="FFFFFF"/);
  assert.match(xml, /https:\/\/exemplo\.com\/documentacao/); assert.doesNotMatch(xml, /\[(?:KKKK|LLLL)\]/);
  console.log("✓ endpoint do relatório de entrega: DOCX completo retornado com status 200");
})().catch((error) => { console.error(error); process.exitCode = 1; });