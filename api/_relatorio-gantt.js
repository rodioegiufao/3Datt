"use strict";

const CORES = { cabecalho: "1F4E78", atividade: "286D9F", obra: "EAF2F8", fimSemana: "F3F5F7", borda: "B4C6E7" };
const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const SEMANAS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const xmlEscape = (v) => String(v ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
const data = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null; };
const iso = (d) => d.toISOString().slice(0, 10);
function listarDias(inicio, fim) { const a = data(inicio), b = data(fim), r = []; if (!a || !b || b < a) return r; for (let d = a; d <= b; d = new Date(d.getTime() + 864e5)) r.push(iso(d)); return r; }
function formatarData(v) { return String(v || "").split("-").reverse().join("/"); }
function formatarHoras(v) { return `${Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`; }
function calcularCoberturaGantt(horasTotais, horasRepresentadas) { return Number(horasTotais) > 0 ? Number((Number(horasRepresentadas || 0) / Number(horasTotais) * 100).toFixed(1)) : 0; }
function formatarTituloObraAnexoGantt(indice, codigo, nome) { return [`B.${indice}`, codigo, nome].map((x) => String(x || "").replace(/^\s*[—–-]+\s*|\s*[—–-]+\s*$/g, "").trim()).filter(Boolean).join(" — "); }
function periodosTemporais(periodo) {
  const todos = listarDias(periodo?.inicio, periodo?.fim); if (todos.length <= 31 && todos[0]?.slice(0, 7) === todos.at(-1)?.slice(0, 7)) return todos.length ? [{ inicio: todos[0], fim: todos.at(-1), dias: todos }] : [];
  const grupos = new Map(); todos.forEach((dia) => { const chave = dia.slice(0, 7); if (!grupos.has(chave)) grupos.set(chave, []); grupos.get(chave).push(dia); });
  return [...grupos.values()].map((dias) => ({ inicio: dias[0], fim: dias.at(-1), dias }));
}
function bordas() { return `<w:tcBorders>${["top", "left", "bottom", "right"].map((x) => `<w:${x} w:val="single" w:sz="4" w:color="${CORES.borda}"/>`).join("")}</w:tcBorders>`; }
function run(texto, { bold = false, cor = "000000", tamanho = 16 } = {}) { const partes = String(texto ?? "").split("\n"); return `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/>${bold ? "<w:b/>" : ""}<w:color w:val="${cor}"/><w:sz w:val="${tamanho}"/></w:rPr>${partes.map((parte, i) => `${i ? "<w:br/>" : ""}<w:t xml:space="preserve">${xmlEscape(parte)}</w:t>`).join("")}</w:r>`; }
function paragrafo(texto, op = {}) { return `<w:p><w:pPr>${op.keepNext ? "<w:keepNext/>" : ""}<w:jc w:val="${op.align || "left"}"/><w:spacing w:before="${op.before || 0}" w:after="${op.after ?? 100}"/>${op.indent ? `<w:ind w:left="${op.indent}"/>` : ""}</w:pPr>${run(texto, op)}</w:p>`; }
function celula(conteudo, largura, op = {}) {
  const fill = op.fill ? `<w:shd w:val="clear" w:color="auto" w:fill="${op.fill}"/>` : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>${op.span ? `<w:gridSpan w:val="${op.span}"/>` : ""}${bordas()}${fill}<w:vAlign w:val="center"/>${op.noWrap ? "<w:noWrap/>" : ""}<w:tcMar><w:left w:w="70" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tcMar></w:tcPr>${typeof conteudo === "string" && conteudo.startsWith("<w:p") ? conteudo : paragrafo(conteudo, { align: op.align || "center", bold: op.bold, cor: op.cor, tamanho: op.tamanho, indent: op.indent, after: 0 })}</w:tc>`;
}
function linha(celulas, cabecalho = false) { return `<w:tr><w:trPr>${cabecalho ? "<w:tblHeader/>" : "<w:cantSplit/>"}</w:trPr>${celulas.join("")}</w:tr>`; }
function larguras(quantidade, paisagem) { const total = paisagem ? 15120 : 9026, processo = Math.round(total * (paisagem ? .33 : .47)), horas = Math.round(total * (paisagem ? .08 : .1)); return { total, processo, horas, dia: Math.floor((total - processo - horas) / quantidade) }; }
function cabecalho(dias, l, { mensal = false } = {}) {
  const d = data(dias[0]), titulo = `${MESES[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
  const primeira = linha([celula("PROCESSO", l.processo, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true }), celula("HORAS", l.horas, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true }), celula(titulo, l.dia * dias.length, { span: dias.length, fill: CORES.cabecalho, cor: "FFFFFF", bold: true })], true);
  const segunda = linha([celula("PROCESSO", l.processo, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true }), celula("HORAS", l.horas, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true }), ...dias.map((x) => { const dt = data(x), textoDia = mensal ? x.slice(8) : `${x.slice(8)}\n${SEMANAS[dt.getUTCDay()]}`; return celula(textoDia, l.dia, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true, tamanho: 14, noWrap: true }); })], true);
  return primeira + segunda;
}
function linhaGantt(item, dias, l) { const ativos = new Set(item.dias || []), nivel = item.nivel || "fase", obra = nivel === "obra"; return linha([
  celula(item.nome || "—", l.processo, { align: "left", indent: nivel === "projeto" ? 200 : nivel === "fase" ? 420 : 0, bold: obra || nivel === "projeto", tamanho: obra ? 19 : nivel === "projeto" ? 17 : 16, fill: obra ? CORES.obra : "" }),
  celula(formatarHoras(item.horas), l.horas, { bold: obra, tamanho: 16, fill: obra ? CORES.obra : "", noWrap: true }),
  ...dias.map((x) => celula("", l.dia, { fill: ativos.has(x) ? CORES.atividade : [0, 6].includes(data(x).getUTCDay()) ? CORES.fimSemana : "" }))
  ]); }
function tabelaObra(obra, dias, paisagem, { mensal = false } = {}) { const l = larguras(dias.length, paisagem), projetos = obra.projetos || [], linhas = [obra.linha || { nivel: "obra", nome: obra.nome, horas: obra.horas, dias: obra.dias }, ...projetos.flatMap((p) => [p.linha, ...(p.fases || [])])].filter(Boolean); return `<w:tbl><w:tblPr><w:tblW w:w="${l.total}" w:type="dxa"/><w:jc w:val="center"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="${l.processo}"/><w:gridCol w:w="${l.horas}"/>${dias.map(() => `<w:gridCol w:w="${l.dia}"/>`).join("")}</w:tblGrid>${cabecalho(dias, l, { mensal })}${linhas.map((x) => linhaGantt(x, dias, l)).join("")}</w:tbl>`; }
function sintese(obras) { const rows = [linha([celula("Obra", 6000, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true }), celula("Horas", 1700, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true }), celula("Dias ativos", 1700, { fill: CORES.cabecalho, cor: "FFFFFF", bold: true })], true), ...obras.map((o) => linha([celula(o.nome, 6000, { align: "left" }), celula(formatarHoras(o.horas), 1700), celula(String(new Set(o.dias || []).size), 1700)]))]; return `<w:tbl><w:tblPr><w:tblW w:w="9400" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid><w:gridCol w:w="6000"/><w:gridCol w:w="1700"/><w:gridCol w:w="1700"/></w:tblGrid>${rows.join("")}</w:tbl>`; }
function gerarGanttTabelaXml(gantt = {}) {
  const obras = (gantt.obras || []).filter((o) => (o.dias || []).length); if (!obras.length) { const total = Number(gantt.horasTotaisRelatorio ?? gantt.totalHoras ?? 0); return { xml: paragrafo(`Período: ${formatarData(gantt.periodo?.inicio)} a ${formatarData(gantt.periodo?.fim)}`, { bold: true, after: 40 }) + paragrafo(`Horas totais do relatório: ${formatarHoras(total)}`, { bold: true, after: 40 }) + paragrafo("Horas representadas no Gantt: 0,00 h", { bold: true, after: 40 }) + paragrafo("Cobertura do Gantt: 0,0%", { bold: true, after: 140 }) + paragrafo("Não foram identificadas atividades com intervalo válido para representação no Gantt no período analisado."), paisagem: false }; }
  const blocos = periodosTemporais(gantt.periodo), paisagem = listarDias(gantt.periodo.inicio, gantt.periodo.fim).length > 14, mensal = gantt.modoRelatorio === "mensal";
  let xml = paragrafo("O Gantt apresenta a distribuição temporal das atividades efetivamente registradas no período analisado. As células destacadas representam os dias em que houve execução registrada e não constituem programação futura ou linha de base contratual.", { after: 140 });
  const horasTotais = Number(gantt.horasTotaisRelatorio ?? gantt.totalHoras ?? 0), horasGantt = Number(gantt.horasRepresentadasGantt ?? obras.reduce((s, o) => s + Number(o.horas || 0), 0)), cobertura = Number(gantt.coberturaGantt ?? calcularCoberturaGantt(horasTotais, horasGantt));
  xml += paragrafo(`Período: ${formatarData(gantt.periodo.inicio)} a ${formatarData(gantt.periodo.fim)}`, { bold: true, after: 40 }) + paragrafo(`Horas totais do relatório: ${formatarHoras(horasTotais)}`, { bold: true, after: 40 }) + paragrafo(`Horas representadas no Gantt: ${formatarHoras(horasGantt)}`, { bold: true, after: 40 }) + paragrafo(`Cobertura do Gantt: ${cobertura.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`, { bold: true, after: 140 }) + paragrafo("SÍNTESE TEMPORAL", { bold: true, keepNext: true }) + sintese(obras);
  let indice = 0; blocos.forEach((bloco, bi) => { if (blocos.length > 1) xml += paragrafo(`${MESES[data(bloco.inicio).getUTCMonth()]}/${data(bloco.inicio).getUTCFullYear()}`, { bold: true, keepNext: true, before: 220 }); obras.forEach((obra) => { const diasAtivos = (obra.dias || []).filter((x) => x >= bloco.inicio && x <= bloco.fim); if (!diasAtivos.length) return; indice += 1; xml += paragrafo(formatarTituloObraAnexoGantt(indice, obra.codigo, obra.nome), { bold: true, keepNext: true, before: 220, after: 80 }) + tabelaObra(obra, bloco.dias, paisagem, { mensal }); }); });
  return { xml, paisagem };
}
function aplicarPaisagemUltimaSecao(documentXml) { return documentXml.replace(/<w:sectPr([^>]*)>(?:(?!<w:sectPr)[\s\S])*?<\/w:sectPr>(?=\s*<\/w:body>)/, '<w:sectPr$1><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr>'); }

module.exports = { gerarGanttTabelaXml, aplicarPaisagemUltimaSecao, periodosTemporais, listarDias, formatarHoras, calcularCoberturaGantt, formatarTituloObraAnexoGantt, CORES };