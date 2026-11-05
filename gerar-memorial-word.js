"use strict";

const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { parseRequestBody, requireInternalUser, sendJson } = require("./_auth");
const { montarValores, nomeArquivo, normalizarMemorial, prepararTemplate } = require("./_memorial-descritivo");

const TEMPLATE_PATH = path.join(process.cwd(), "memorial", "template", "Memorial-Descritivo.docx");

function criarHandler(dependencias = {}) {
  const autenticar = dependencias.requireUser || requireInternalUser;
  const templatePath = dependencias.templatePath || TEMPLATE_PATH;

  return async function gerarMemorialWordHandler(req, res) {
    try {
      if (req.method !== "POST") return sendJson(res, 405, { error: "Método não suportado." });
      await autenticar(req);
      if (!fs.existsSync(templatePath)) {
        return sendJson(res, 404, { error: "Modelo Memorial-Descritivo.docx não encontrado em /memorial/template." });
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
