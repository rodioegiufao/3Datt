"use strict";

// Monta o XML do memorial descritivo de UM modelo IFC a partir do JSON enviado pelo viewer.
// O agrupamento (classificação dos materiais, textos, normas) é feito no navegador
// por 3D/memorial-core.js; aqui só validamos, limitamos e desenhamos no modelo Word.

const { textoSeguro, criarEspacoAposTabelaXml } = require("./_docx-tabelas");

const MARCADORES_XML = ["SUMARIO", "APRESENTACAO", "DISPOSICOES_GERAIS", "NORMAS", "CORPO_MEMORIAL", "CONSIDERACOES_FINAIS"];
const TITULOS_FIXOS_ANTES = ["APRESENTAÇÃO", "DISPOSIÇÕES GERAIS", "NORMAS TÉCNICAS DE REFERÊNCIA"];
const TITULO_FIXO_DEPOIS = "CONSIDERAÇÕES FINAIS";

const LIMITES = Object.freeze({
  texto: 4000,
  curto: 200,
  paragrafos: 40,
  normas: 80,
  secoes: 120,
  itensPorSecao: 1500,
  itensTotal: 6000
});

// Largura útil da página do modelo (A4, margens 1701/1750 dxa)
const LARGURA_UTIL = 8455;
const NUM_ID_MARCADOR = 22; // marcador "●" do modelo

function erro400(mensagem) {
  const error = new Error(mensagem);
  error.statusCode = 400;
  return error;
}

function limparTexto(valor, max = LIMITES.texto) {
  return String(valor ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, max);
}

function listaParagrafos(valor) {
  const lista = Array.isArray(valor) ? valor : String(valor ?? "").split(/\n+/);
  return lista.map((p) => limparTexto(p)).filter(Boolean).slice(0, LIMITES.paragrafos);
}

function numeroOuNulo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function normalizarMemorial(body = {}) {
  const obra = limparTexto(body.obra, LIMITES.curto);
  if (!obra) throw erro400("Informe o nome da obra.");

  const secoesEntrada = Array.isArray(body.secoes) ? body.secoes : [];
  if (!secoesEntrada.length) throw erro400("Nenhum material do IFC foi associado a uma seção do memorial.");
  if (secoesEntrada.length > LIMITES.secoes) throw erro400("Seções demais no memorial.");

  let totalItens = 0;
  const secoes = secoesEntrada.map((sec) => {
    const itens = (Array.isArray(sec?.itens) ? sec.itens : []).slice(0, LIMITES.itensPorSecao).map((item) => ({
      descricao: limparTexto(item?.descricao, 600),
      referencia: limparTexto(item?.referencia, 120),
      unidade: limparTexto(item?.unidade, 20),
      quantidade: numeroOuNulo(item?.quantidade)
    })).filter((item) => item.descricao);
    totalItens += itens.length;
    return {
      titulo: limparTexto(sec?.titulo, LIMITES.curto),
      paragrafos: listaParagrafos(sec?.paragrafos),
      itens
    };
  }).filter((sec) => sec.titulo);

  if (!secoes.length) throw erro400("Nenhuma seção válida para o memorial.");
  if (totalItens > LIMITES.itensTotal) throw erro400("Itens demais no memorial.");

  const normas = (Array.isArray(body.normas) ? body.normas : []).slice(0, LIMITES.normas).map((n) => ({
    norma: limparTexto(n?.norma, LIMITES.curto),
    titulo: limparTexto(n?.titulo, 400)
  })).filter((n) => n.norma);

  const opcoes = body.opcoes || {};
  return {
    obra,
    local: limparTexto(body.local, LIMITES.curto),
    revisao: limparTexto(body.revisao, 30) || "R00",
    disciplina: limparTexto(body.disciplina, LIMITES.curto),
    dataEmissao: limparTexto(body.dataEmissao, 60),
    apresentacao: listaParagrafos(body.apresentacao),
    disposicoesGerais: listaParagrafos(body.disposicoesGerais),
    consideracoesFinais: listaParagrafos(body.consideracoesFinais),
    normas,
    secoes,
    opcoes: {
      mostrarQuantidades: opcoes.mostrarQuantidades !== false,
      mostrarReferencias: opcoes.mostrarReferencias !== false
    }
  };
}

// ---------- blocos de XML ----------

function paragrafoTextoXml(texto) {
  return `<w:p><w:pPr><w:spacing w:after="200"/><w:ind w:firstLine="567"/><w:rPr><w:szCs w:val="24"/></w:rPr></w:pPr><w:r><w:rPr><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${textoSeguro(texto)}</w:t></w:r></w:p>`;
}

function paragrafosXml(lista) {
  return lista.length ? lista.map(paragrafoTextoXml).join("") : paragrafoTextoXml("—");
}

function titulo1Xml(texto) {
  return `<w:p><w:pPr><w:pStyle w:val="Ttulo1"/><w:keepNext/><w:spacing w:before="240"/></w:pPr><w:r><w:t xml:space="preserve">${textoSeguro(texto.toUpperCase())}</w:t></w:r></w:p>`;
}

function marcadorXml(norma, titulo) {
  const resto = titulo ? ` — ${titulo}` : "";
  return `<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${NUM_ID_MARCADOR}"/></w:numPr><w:spacing w:after="60"/><w:ind w:left="600" w:hanging="360"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${textoSeguro(norma)}</w:t></w:r><w:r><w:t xml:space="preserve">${textoSeguro(resto)}</w:t></w:r></w:p>`;
}

function formatarQuantidade(quantidade, unidade) {
  if (quantidade === null) return "";
  const inteiro = /^(un|und|pç|pc|cj|jg|vb)$/i.test(unidade) || Number.isInteger(quantidade);
  return quantidade.toLocaleString("pt-BR", {
    minimumFractionDigits: inteiro ? 0 : 2,
    maximumFractionDigits: inteiro ? 0 : 2
  });
}

// Tabela própria (mesmo visual do _docx-tabelas.js), com os elementos na ordem exigida pelo schema do Word.
const COR_BORDA = "B4C6E7";
const borda = (lado) => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="${COR_BORDA}"/>`;

function celulaXml(texto, coluna, cabecalho) {
  const alinhamento = cabecalho ? "center" : (coluna.alinhamento || "left");
  const cor = cabecalho ? "FFFFFF" : "000000";
  const linhas = String(texto ?? "").split("\n")
    .map((parte, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${textoSeguro(parte)}</w:t>`).join("");
  return `<w:tc><w:tcPr><w:tcW w:w="${coluna.largura}" w:type="dxa"/>`
    + `<w:tcBorders>${borda("top")}${borda("left")}${borda("bottom")}${borda("right")}</w:tcBorders>`
    + (cabecalho ? `<w:shd w:val="clear" w:color="auto" w:fill="1F4E78"/>` : "")
    + `<w:tcMar><w:top w:w="70" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="70" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar>`
    + `<w:vAlign w:val="center"/></w:tcPr>`
    + `<w:p><w:pPr>${cabecalho ? "<w:keepNext/>" : ""}<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="${alinhamento}"/></w:pPr>`
    + `<w:r><w:rPr>${cabecalho ? "<w:b/><w:bCs/>" : ""}<w:color w:val="${cor}"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>${linhas}</w:r></w:p></w:tc>`;
}

function tabelaXml(colunas, linhas) {
  const cab = `<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>${colunas.map((c) => celulaXml(c.titulo, c, true)).join("")}</w:tr>`;
  const corpo = linhas.map((l) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${l.map((v, i) => celulaXml(v, colunas[i], false)).join("")}</w:tr>`).join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA_UTIL}" w:type="dxa"/><w:jc w:val="center"/>`
    + `<w:tblBorders>${borda("top")}${borda("left")}${borda("bottom")}${borda("right")}${borda("insideH")}${borda("insideV")}</w:tblBorders>`
    + `<w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>`
    + `<w:tblGrid>${colunas.map((c) => `<w:gridCol w:w="${c.largura}"/>`).join("")}</w:tblGrid>${cab}${corpo}</w:tbl>`;
}

function tabelaItensXml(numeroSecao, itens, opcoes) {
  const colunas = [{ titulo: "Item", largura: 760, alinhamento: "center" }];
  const fixas = 760 + 650 + (opcoes.mostrarReferencias ? 1500 : 0) + (opcoes.mostrarQuantidades ? 1050 : 0);
  colunas.push({ titulo: "Especificação", largura: LARGURA_UTIL - fixas });
  if (opcoes.mostrarReferencias) colunas.push({ titulo: "Referência", largura: 1500, alinhamento: "center" });
  colunas.push({ titulo: "Und.", largura: 650, alinhamento: "center" });
  if (opcoes.mostrarQuantidades) colunas.push({ titulo: "Quant.", largura: 1050, alinhamento: "right" });

  const linhas = itens.map((item, i) => {
    const linha = [`${numeroSecao}.${i + 1}`, item.descricao];
    if (opcoes.mostrarReferencias) linha.push(item.referencia || "—");
    linha.push(item.unidade);
    if (opcoes.mostrarQuantidades) linha.push(formatarQuantidade(item.quantidade, item.unidade));
    return linha;
  });

  return tabelaXml(colunas, linhas) + criarEspacoAposTabelaXml(10);
}

function sumarioEntradaXml(numero, texto, nivel) {
  const estilo = nivel === 1 ? "Sumrio1" : "Sumrio2";
  const recuo = nivel === 1 ? "" : `<w:ind w:left="240"/>`;
  return `<w:p><w:pPr><w:pStyle w:val="${estilo}"/><w:tabs><w:tab w:val="left" w:pos="${nivel === 1 ? 720 : 960}"/><w:tab w:val="right" w:leader="dot" w:pos="8445"/></w:tabs>${recuo}</w:pPr><w:r><w:t xml:space="preserve">${textoSeguro(numero)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">${textoSeguro(texto)}</w:t></w:r></w:p>`;
}

function montarValores(memorial) {
  const sumario = [];
  let numero = 0;
  TITULOS_FIXOS_ANTES.forEach((titulo) => sumario.push(sumarioEntradaXml(`${++numero}.`, titulo, 1)));

  // Um IFC = uma disciplina: cada seção vira um item numerado do memorial (4., 5., ...)
  const corpo = memorial.secoes.map((sec) => {
    const numSec = ++numero;
    sumario.push(sumarioEntradaXml(`${numSec}.`, sec.titulo.toUpperCase(), 1));
    return titulo1Xml(sec.titulo)
      + sec.paragrafos.map(paragrafoTextoXml).join("")
      + (sec.itens.length ? tabelaItensXml(String(numSec), sec.itens, memorial.opcoes) : "");
  }).join("");
  sumario.push(sumarioEntradaXml(`${++numero}.`, TITULO_FIXO_DEPOIS, 1));

  const normas = memorial.normas.length
    ? memorial.normas.map((n) => marcadorXml(n.norma, n.titulo)).join("") + criarEspacoAposTabelaXml(6)
    : paragrafoTextoXml("Normas técnicas brasileiras aplicáveis aos sistemas descritos.");

  return {
    OBRA: memorial.obra,
    LOCAL: memorial.local,
    LOCAL_CAPA: memorial.local.toUpperCase(),
    REVISAO: memorial.revisao,
    DISCIPLINA: memorial.disciplina || "—",
    DATA_EMISSAO: memorial.dataEmissao.toUpperCase(),
    SUMARIO: sumario.join(""),
    APRESENTACAO: paragrafosXml(memorial.apresentacao),
    DISPOSICOES_GERAIS: paragrafosXml(memorial.disposicoesGerais),
    NORMAS: normas,
    CORPO_MEMORIAL: corpo,
    CONSIDERACOES_FINAIS: paragrafosXml(memorial.consideracoesFinais)
  };
}

// Se o modelo for editado no Word, um marcador pode ficar quebrado em vários "runs".
// Reescreve qualquer parágrafo que contenha [@MARCADOR] como um parágrafo limpo.
function prepararTemplate(zip) {
  const arquivo = zip.file("word/document.xml");
  let doc = arquivo.asText();
  const textoVisivel = (trecho) => [...trecho.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join("");
  doc = doc.replace(/<w:p\b[^>]*>(?:(?!<w:p[ >])[\s\S])*?<\/w:p>/g, (paragrafo) => {
    const visivel = textoVisivel(paragrafo);
    const marcador = MARCADORES_XML.find((m) => visivel.includes(`[@${m}]`));
    return marcador ? `<w:p><w:r><w:t>[@${marcador}]</w:t></w:r></w:p>` : paragrafo;
  });
  zip.file("word/document.xml", doc);

  const settings = zip.file("word/settings.xml");
  if (settings && !settings.asText().includes("<w:updateFields")) {
    // A posição importa para o schema do Word: antes de hdrShapeDefaults/footnotePr/compat/rsids...
    const xml = settings.asText();
    const m = xml.match(/<w:(hdrShapeDefaults|footnotePr|endnotePr|compat|docVars|rsids)\b|<m:mathPr/);
    const tag = '<w:updateFields w:val="true"/>';
    zip.file("word/settings.xml", m ? xml.slice(0, m.index) + tag + xml.slice(m.index) : xml.replace("</w:settings>", `${tag}</w:settings>`));
  }
}

function nomeArquivo(memorial) {
  const slug = [memorial.obra, memorial.disciplina, memorial.revisao].filter(Boolean).join("-")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")
    .slice(0, 80);
  return `memorial-descritivo-${slug || "obra"}.docx`;
}

module.exports = {
  LIMITES,
  MARCADORES_XML,
  formatarQuantidade,
  montarValores,
  nomeArquivo,
  normalizarMemorial,
  prepararTemplate
};
