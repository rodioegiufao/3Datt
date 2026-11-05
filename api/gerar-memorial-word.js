"use strict";

const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { parseRequestBody, requireInternalUser, sendJson } = require("./_auth");
const { montarValores, nomeArquivo, normalizarMemorial, prepararTemplate } = require("./_memorial-descritivo");

// Caminho relativo a este arquivo: o Vercel rastreia esse require estático e empacota o .docx
// junto com a função. O process.cwd() fica como reserva para rodar local.
const TEMPLATE_PATHS = [
  path.join(__dirname, "..", "memorial", "template", "Memorial-Descritivo.docx"),
  path.join(process.cwd(), "memorial", "template", "Memorial-Descritivo.docx")
];

function localizarTemplate() {
  return TEMPLATE_PATHS.find((caminho) => fs.existsSync(caminho)) || null;
}

function criarHandler(dependencias = {}) {
  const autenticar = dependencias.requireUser || requireInternalUser;

  return async function gerarMemorialWordHandler(req, res) {
    try {
      if (req.method !== "POST") return sendJson(res, 405, { error: "Método não suportado." });
      await autenticar(req);
      const templatePath = dependencias.templatePath || localizarTemplate();
      if (!templatePath || !fs.existsSync(templatePath)) {
        console.error("[memorial] Modelo não encontrado. Procurado em:", TEMPLATE_PATHS);
        return sendJson(res, 404, { error: "Modelo Memorial-Descritivo.docx não foi incluído no deploy (memorial/template). Confira o includeFiles no vercel.json." });
      }

      const memorial = normalizarMemorial(parseRequestBody(req));
      const zip = new PizZip(fs.readFileSync(templatePath));
      prepararTemplate(zip);
      const doc = new Docxtemplater(zip, {
        delimiters: { start: "[", end: "]" },
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => ""
      });
      doc.render(montarValores(memorial));

      const buffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${nomeArquivo(memorial)}"`);
      res.status(200).send(buffer);
    } catch (error) {
      console.error("Erro ao gerar memorial descritivo:", error);
      sendJson(res, error.statusCode || 500, { error: error.message || "Erro interno ao gerar o memorial descritivo." });
    }
  };
}

module.exports = criarHandler();
module.exports.criarHandler = criarHandler;
