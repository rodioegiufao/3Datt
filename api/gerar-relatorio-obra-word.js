const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { parseRequestBody, requireUser, sendJson, supabaseRequest } = require("./_auth");
const { localizarObraPorId } = require("./_obras");
const { analisarObra, carregarDadosObra, montarXmlRelatorio, nomeArquivo, prepararTemplate, validarDocumento } = require("./_relatorio-obra");

const TEMPLATE_PATH = path.join(process.cwd(), "atividades", "template", "Relatorio-Obra.docx");

function criarGeradorRelatorioObraWord(dependencias = {}) {
  const autenticar = dependencias.requireUser || requireUser;
  const lerCorpo = dependencias.parseRequestBody || parseRequestBody;
  const buscarDados = dependencias.carregarDadosObra || carregarDadosObra;
  const requisitar = dependencias.supabaseRequest || supabaseRequest;
  const localizar = dependencias.localizarObraPorId || localizarObraPorId;
  const templatePath = dependencias.templatePath || TEMPLATE_PATH;
  return async function gerarRelatorioObraWord(req, res) {
  try {
    if (req.method !== "POST") return sendJson(res, 405, { error: "Método não suportado." }, { Allow: "POST" });
    const user = await autenticar(req); if (user.perfil !== "admin") return sendJson(res, 403, { error: "Apenas administradores podem gerar relatórios de entrega." });
    const { obraId, entregaId } = lerCorpo(req); if (!obraId || !entregaId) return sendJson(res, 400, { error: "Informe obraId e entregaId." });
    if (!fs.existsSync(templatePath)) return sendJson(res, 404, { error: "Modelo Relatorio-Obra.docx não encontrado em /atividades/template." });
    const dados = await buscarDados(obraId, requisitar, localizar, entregaId); const analise = analisarObra({ ...dados, periodoInicio: dados.entrega.periodo_inicio, periodoFim: dados.entrega.periodo_fim }); const entrega = { ...dados.entrega, projetos: dados.projetosEntrega };
    const zip = new PizZip(fs.readFileSync(templatePath)); prepararTemplate(zip); const valores = montarXmlRelatorio({ analise, entrega, zip });
    const doc = new Docxtemplater(zip, { delimiters: { start: "[", end: "]" }, paragraphLoop: true, linebreaks: true }); doc.render(valores); validarDocumento(doc.getZip());
    const buffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }); const arquivo = nomeArquivo(dados.obra, entrega.revisao);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); res.setHeader("Content-Disposition", `attachment; filename="${arquivo}"`); return res.status(200).send(buffer);
  } catch (error) { const status = error.statusCode || 500; console.error("Erro ao gerar relatório de entrega da obra:", error); return sendJson(res, status, { error: status >= 500 ? "Não foi possível gerar o relatório de entrega. Tente novamente ou contate o suporte." : error.message }); }
  };
}

module.exports = criarGeradorRelatorioObraWord();
module.exports.criarGeradorRelatorioObraWord = criarGeradorRelatorioObraWord;