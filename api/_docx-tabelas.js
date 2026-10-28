"use strict";

const textoSeguro = (valor) => String(valor ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));

function criarBordasCelulaXml({ cor = "B4C6E7", tamanho = 4 } = {}) {
  return `<w:tcBorders><w:top w:val="single" w:sz="${tamanho}" w:color="${cor}"/><w:left w:val="single" w:sz="${tamanho}" w:color="${cor}"/><w:bottom w:val="single" w:sz="${tamanho}" w:color="${cor}"/><w:right w:val="single" w:sz="${tamanho}" w:color="${cor}"/></w:tcBorders>`;
}

function criarCelulaTabelaXml(conteudo, isHeader = false, coluna = {}, tamanhoFonte = 9) {
  const alinhamento = isHeader ? (coluna.alinhamentoCabecalho || "center") : (coluna.alinhamento || "left");
  const fonte = coluna.tamanhoFonte || (isHeader ? coluna.tamanhoFonteCabecalho : 0) || tamanhoFonte;
  const fill = coluna.fill || (isHeader ? "1F4E78" : "");
  const color = coluna.color || coluna.cor || (isHeader ? "FFFFFF" : "000000");
  const bold = coluna.bold ?? isHeader;
  const partes = String(conteudo ?? "").replace(/\r\n?/g, "\n").split("\n");
  const texto = partes.map((parte, indice) => `${indice ? "<w:br/>" : ""}<w:t xml:space="preserve">${textoSeguro(parte)}</w:t>`).join("");
  return `<w:tc><w:tcPr>${coluna.largura ? `<w:tcW w:w="${coluna.largura}" w:type="dxa"/>` : ""}<w:tcMar><w:top w:w="${coluna.margemVertical || 90}" w:type="dxa"/><w:left w:w="${coluna.margemHorizontal || 100}" w:type="dxa"/><w:bottom w:w="${coluna.margemVertical || 90}" w:type="dxa"/><w:right w:w="${coluna.margemHorizontal || 100}" w:type="dxa"/></w:tcMar>${criarBordasCelulaXml(coluna.bordas)}${fill ? `<w:shd w:fill="${fill}"/>` : ""}<w:vAlign w:val="${coluna.verticalAlign || "center"}"/>${coluna.noWrap ? "<w:noWrap/>" : ""}</w:tcPr><w:p><w:pPr>${coluna.keepNext || isHeader ? "<w:keepNext/>" : ""}<w:jc w:val="${alinhamento}"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:sz w:val="${fonte * 2}"/>${bold ? "<w:b/>" : ""}<w:color w:val="${color}"/></w:rPr>${texto}</w:r></w:p></w:tc>`;
}

function criarLinhaTabelaXml(celulas, isHeader = false, opcoes = {}) {
  const pr = `${isHeader && opcoes.repetirCabecalho !== false ? "<w:tblHeader/>" : ""}${!isHeader && opcoes.evitarQuebraLinha !== false ? "<w:cantSplit/>" : ""}`;
  return `<w:tr><w:trPr>${pr}</w:trPr>${celulas.map((c, i) => criarCelulaTabelaXml(c, isHeader, opcoes.colunas[i] || {}, isHeader ? opcoes.tamanhoFonteCabecalho : opcoes.tamanhoFonte)).join("")}</w:tr>`;
}

function criarTabelaXml(cabecalhos, linhas, opcoes = {}) {
  opcoes = { tamanhoFonte: 9, tamanhoFonteCabecalho: 8, alinhamentoTabela: "center", ...opcoes };
  opcoes.colunas = opcoes.colunas || (opcoes.larguras || []).map((largura) => ({ largura }));
  const larguraCalculada = opcoes.colunas.reduce((soma, coluna) => soma + Number(coluna.largura || 0), 0) || 9000;
  const larguraTotal = Number(opcoes.larguraTotal || larguraCalculada);
  return `<w:tbl><w:tblPr><w:tblW w:w="${larguraTotal}" w:type="dxa"/><w:jc w:val="${opcoes.alinhamentoTabela}"/><w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellSpacing w:w="0" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B4C6E7"/><w:left w:val="single" w:sz="4" w:color="B4C6E7"/><w:bottom w:val="single" w:sz="4" w:color="B4C6E7"/><w:right w:val="single" w:sz="4" w:color="B4C6E7"/><w:insideH w:val="single" w:sz="4" w:color="B4C6E7"/><w:insideV w:val="single" w:sz="4" w:color="B4C6E7"/></w:tblBorders></w:tblPr><w:tblGrid>${opcoes.colunas.map((c) => `<w:gridCol w:w="${c.largura || 0}"/>`).join("")}</w:tblGrid>${cabecalhos.length ? criarLinhaTabelaXml(cabecalhos, true, opcoes) : ""}${linhas.map((linha) => criarLinhaTabelaXml(linha, false, opcoes)).join("")}</w:tbl>`;
}

function criarEspacoAposTabelaXml(alturaPontos = 8) {
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${Math.round(alturaPontos * 20)}" w:lineRule="exact"/></w:pPr></w:p>`;
}

function criarParagrafoXml(conteudo, opcoes = {}) {
  const alinhamento = opcoes.alignment || "left";
  const firstLine = Number(opcoes.firstLine ?? 0);
  const run = opcoes.xmlBruto ? conteudo : `<w:r><w:rPr>${opcoes.bold ? "<w:b/>" : ""}${opcoes.tamanhoFonte ? `<w:sz w:val="${opcoes.tamanhoFonte * 2}"/>` : ""}</w:rPr><w:t xml:space="preserve">${textoSeguro(conteudo)}</w:t></w:r>`;
  return `<w:p><w:pPr>${opcoes.style ? `<w:pStyle w:val="${textoSeguro(opcoes.style)}"/>` : ""}${opcoes.keepNext ? "<w:keepNext/>" : ""}${opcoes.keepLines ? "<w:keepLines/>" : ""}<w:jc w:val="${textoSeguro(alinhamento)}"/><w:ind w:left="0" w:right="0" w:firstLine="${firstLine}"/><w:spacing w:before="${Number(opcoes.before || 0)}" w:after="${Number(opcoes.after ?? 120)}"/></w:pPr>${run}</w:p>`;
}

module.exports = { textoSeguro, criarBordasCelulaXml, criarCelulaTabelaXml, criarLinhaTabelaXml, criarTabelaXml, criarEspacoAposTabelaXml, criarParagrafoXml };