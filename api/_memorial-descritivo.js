"use strict";

// Monta o XML do memorial descritivo de UM modelo IFC a partir do JSON enviado pelo viewer.
// O roteiro (títulos, textos, normas e materiais) é montado no navegador por 3D/memorial-core.js
// a partir da memorial_descritivo.xlsx; aqui só validamos, limitamos e desenhamos no modelo Word.

const { textoSeguro, criarEspacoAposTabelaXml } = require("./_docx-tabelas");

const MARCADORES_XML = ["SUMARIO", "CORPO_MEMORIAL", "ANEXO"];

const LIMITES = Object.freeze({
  texto: 6000,
  curto: 300,
  blocosPorTitulo: 80,
  titulos: 200,
  normas: 80,
  materiaisPorTitulo: 1500,
  gruposAnexo: 200,
  itensAnexo: 8000
});

const LARGURA_UTIL = 8455; // A4 com as margens do modelo (1701/1750 dxa)
const NUM_ID_TITULOS = 23; // lista do "Título 1" do modelo: 1. / 1.1. / 1.1.1.
const NUM_ID_MARCADOR = 22; // marcador "●" do modelo
const ESTILO_TITULO = { 1: "Ttulo1", 2: "Ttulo2", 3: "Ttulo3" };

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

function numeroOuNulo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function normalizarMemorial(body = {}) {
  const obra = limparTexto(body.obra, LIMITES.curto);
  if (!obra) throw erro400("Informe o nome da obra.");

  const titulosEntrada = Array.isArray(body.titulos) ? body.titulos : [];
  if (!titulosEntrada.length) throw erro400("O roteiro do memorial está vazio para este IFC.");
  if (titulosEntrada.length > LIMITES.titulos) throw erro400("Títulos demais no memorial.");

  const titulos = titulosEntrada.map((t) => ({
    nivel: Math.min(3, Math.max(1, Math.round(Number(t?.nivel) || 1))),
    titulo: limparTexto(t?.titulo, LIMITES.curto),
    conteudo: (Array.isArray(t?.conteudo) ? t.conteudo : []).slice(0, LIMITES.blocosPorTitulo).map((b) => ({
      tipo: ["paragrafo", "item", "normas"].includes(b?.tipo) ? b.tipo : "paragrafo",
      texto: limparTexto(b?.texto)
    })).filter((b) => b.tipo === "normas" || b.texto),
    materiais: (Array.isArray(t?.materiais) ? t.materiais : []).slice(0, LIMITES.materiaisPorTitulo).map((m) => limparTexto(m, 600)).filter(Boolean)
  })).filter((t) => t.titulo);
  if (!titulos.length) throw erro400("Nenhum título válido no memorial.");

  let totalAnexo = 0;
  const anexo = (Array.isArray(body.anexo) ? body.anexo : []).slice(0, LIMITES.gruposAnexo).map((g) => {
    const itens = (Array.isArray(g?.itens) ? g.itens : []).map((item) => ({
      descricao: limparTexto(item?.descricao, 600),
      referencia: limparTexto(item?.referencia, 120),
      unidade: limparTexto(item?.unidade, 20),
      quantidade: numeroOuNulo(item?.quantidade)
    })).filter((i) => i.descricao);
    totalAnexo += itens.length;
    return { titulo: limparTexto(g?.titulo, LIMITES.curto), itens };
  }).filter((g) => g.itens.length);
  if (totalAnexo > LIMITES.itensAnexo) throw erro400("Materiais demais no anexo.");

  const normas = (Array.isArray(body.normas) ? body.normas : []).slice(0, LIMITES.normas).map((n) => ({
    norma: limparTexto(n?.norma, LIMITES.curto),
    descricao: limparTexto(n?.descricao ?? n?.titulo, 600)
  })).filter((n) => n.norma);

  const opcoes = body.opcoes || {};
  return {
    obra,
    cliente: limparTexto(body.cliente, LIMITES.curto),
    endereco: limparTexto(body.endereco, LIMITES.curto),
    local: limparTexto(body.local, LIMITES.curto),
    revisao: limparTexto(body.revisao, 30) || "R00",
    disciplina: limparTexto(body.disciplina, LIMITES.curto),
    dataEmissao: limparTexto(body.dataEmissao, 60),
    titulos,
    normas,
    anexo,
    opcoes: {
      mostrarQuantidades: opcoes.mostrarQuantidades !== false,
      mostrarReferencias: opcoes.mostrarReferencias !== false
    }
  };
}

// ---------- blocos de XML ----------

function paragrafoXml(texto) {
  return `<w:p><w:pPr><w:spacing w:after="160"/><w:ind w:firstLine="567"/></w:pPr>${runsComNegrito(texto)}</w:p>`;
}

function marcadorXml(runs, { recuo = 600, depois = 80 } = {}) {
  return `<w:p><w:pPr><w:pStyle w:val="PargrafodaLista"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${NUM_ID_MARCADOR}"/></w:numPr><w:spacing w:after="${depois}"/><w:ind w:left="${recuo}" w:hanging="360"/></w:pPr>${runs}</w:p>`;
}

const run = (texto, negrito = false) => `<w:r>${negrito ? "<w:rPr><w:b/><w:bCs/></w:rPr>" : ""}<w:t xml:space="preserve">${textoSeguro(texto)}</w:t></w:r>`;

// "**Execução.** texto" -> trecho em negrito + texto normal
function runsComNegrito(texto) {
  return String(texto).split(/(\*\*[^*]+\*\*)/).filter(Boolean)
    .map((parte) => (/^\*\*[^*]+\*\*$/.test(parte) ? run(parte.slice(2, -2), true) : run(parte))).join("");
}

function tituloXml(nivel, texto) {
  const estilo = ESTILO_TITULO[nivel];
  const conteudo = nivel === 1 ? texto.toUpperCase() : texto;
  // Títulos 2 e 3 do modelo usam outras listas; forçamos a do Título 1 para numerar 4.1, 4.1.1...
  const numeracao = nivel === 1 ? "" : `<w:numPr><w:ilvl w:val="${nivel - 1}"/><w:numId w:val="${NUM_ID_TITULOS}"/></w:numPr>`;
  const recuo = nivel === 1 ? "" : `<w:ind w:left="${nivel === 2 ? 567 : 794}" w:hanging="${nivel === 2 ? 567 : 794}"/>`;
  return `<w:p><w:pPr><w:pStyle w:val="${estilo}"/><w:keepNext/>${numeracao}<w:spacing w:before="${nivel === 1 ? 240 : 160}" w:after="100"/>${recuo}</w:pPr><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t xml:space="preserve">${textoSeguro(conteudo)}</w:t></w:r></w:p>`;
}

function formatarQuantidade(quantidade, unidade) {
  if (quantidade === null) return "";
  const inteiro = /^(un|und|pç|pc|cj|jg|vb)$/i.test(unidade) || Number.isInteger(quantidade);
  return quantidade.toLocaleString("pt-BR", {
    minimumFractionDigits: inteiro ? 0 : 2,
    maximumFractionDigits: inteiro ? 0 : 2
  });
}

// Tabela com os elementos na ordem exigida pelo schema do Word (mesmo visual do _docx-tabelas.js).
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
    + `<w:tcMar><w:top w:w="60" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar>`
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

function tabelaAnexoXml(prefixo, itens, opcoes) {
  const fixas = 760 + 650 + (opcoes.mostrarReferencias ? 1500 : 0) + (opcoes.mostrarQuantidades ? 1050 : 0);
  const colunas = [{ titulo: "Item", largura: 760, alinhamento: "center" }, { titulo: "Descrição", largura: LARGURA_UTIL - fixas }];
  if (opcoes.mostrarReferencias) colunas.push({ titulo: "Referência", largura: 1500, alinhamento: "center" });
  colunas.push({ titulo: "Und.", largura: 650, alinhamento: "center" });
  if (opcoes.mostrarQuantidades) colunas.push({ titulo: "Quant.", largura: 1050, alinhamento: "right" });
  const linhas = itens.map((item, i) => {
    const linha = [`${prefixo}.${i + 1}`, item.descricao];
    if (opcoes.mostrarReferencias) linha.push(item.referencia || "—");
    linha.push(item.unidade);
    if (opcoes.mostrarQuantidades) linha.push(formatarQuantidade(item.quantidade, item.unidade));
    return linha;
  });
  return tabelaXml(colunas, linhas) + criarEspacoAposTabelaXml(10);
}

function sumarioEntradaXml(numero, texto, nivel) {
  const estilo = nivel === 1 ? "Sumrio1" : "Sumrio2";
  const recuo = nivel === 1 ? 0 : (nivel === 2 ? 240 : 480);
  const tab = nivel === 1 ? 720 : (nivel === 2 ? 1080 : 1440);
  return `<w:p><w:pPr><w:pStyle w:val="${estilo}"/><w:tabs><w:tab w:val="left" w:pos="${tab}"/><w:tab w:val="right" w:leader="dot" w:pos="8445"/></w:tabs><w:spacing w:after="40" w:line="264" w:lineRule="auto"/>${recuo ? `<w:ind w:left="${recuo}"/>` : ""}</w:pPr>${numero ? `<w:r><w:t xml:space="preserve">${textoSeguro(numero)}</w:t></w:r><w:r><w:tab/></w:r>` : ""}<w:r><w:t xml:space="preserve">${textoSeguro(texto)}</w:t></w:r></w:p>`;
}

function montarValores(memorial) {
  const sumario = [];
  const contador = [0, 0, 0];
  const corpo = memorial.titulos.map((t) => {
    contador[t.nivel - 1] += 1;
    for (let i = t.nivel; i < 3; i += 1) contador[i] = 0;
    const numero = `${contador.slice(0, t.nivel).join(".")}.`;
    sumario.push(sumarioEntradaXml(numero, t.nivel === 1 ? t.titulo.toUpperCase() : t.titulo, t.nivel));

    const blocos = t.conteudo.map((b) => {
      if (b.tipo === "item") return marcadorXml(runsComNegrito(b.texto));
      if (b.tipo === "normas") {
        return memorial.normas.map((n) => marcadorXml(run(n.norma, true) + (n.descricao ? run(` — ${n.descricao}`) : ""))).join("");
      }
      return paragrafoXml(b.texto);
    }).join("");

    const materiais = t.materiais.length
      ? `<w:p><w:pPr><w:keepNext/><w:spacing w:before="60" w:after="60"/><w:ind w:firstLine="0"/></w:pPr>${run("Materiais previstos neste projeto:", true)}</w:p>`
        + t.materiais.map((m) => marcadorXml(run(m), { depois: 40 })).join("")
        + criarEspacoAposTabelaXml(8)
      : "";
    return tituloXml(t.nivel, t.titulo) + blocos + materiais;
  }).join("");

  let anexo = "";
  if (memorial.anexo.length) {
    sumario.push(sumarioEntradaXml("", "ANEXO A — RELAÇÃO DE MATERIAIS", 1));
    anexo = `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
      + `<w:p><w:pPr><w:keepNext/><w:spacing w:after="120"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/></w:pPr>${run("ANEXO A — RELAÇÃO DE MATERIAIS", true)}</w:p>`
      + paragrafoXml(`Relação dos materiais extraídos do modelo IFC da disciplina ${memorial.disciplina || "do projeto"}, com as respectivas especificações${memorial.opcoes.mostrarReferencias ? ", referências de composição" : ""}${memorial.opcoes.mostrarQuantidades ? " e quantitativos" : ""}.`)
      + memorial.anexo.map((g, i) => `<w:p><w:pPr><w:keepNext/><w:spacing w:before="120" w:after="80"/><w:ind w:firstLine="0"/></w:pPr>${run(`A.${i + 1} – ${g.titulo}`, true)}</w:p>`
        + tabelaAnexoXml(`A.${i + 1}`, g.itens, memorial.opcoes)).join("");
  }

  return {
    OBRA: memorial.obra,
    CLIENTE: memorial.cliente,
    ENDERECO: memorial.endereco,
    LOCAL: memorial.local,
    LOCAL_CAPA: memorial.local.toUpperCase(),
    REVISAO: memorial.revisao,
    DISCIPLINA: memorial.disciplina,
    DISCIPLINA_CAPA: (memorial.disciplina || "").toUpperCase(),
    DATA_EMISSAO: memorial.dataEmissao.toUpperCase(),
    SUMARIO: sumario.join(""),
    CORPO_MEMORIAL: corpo,
    ANEXO: anexo
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
    .slice(0, 100);
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
