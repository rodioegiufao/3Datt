const fs = require("fs");
const path = require("path");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const { parseRequestBody, requireUser, sendJson } = require("./_auth");
const {
  consolidarAtividades,
  consolidarAtividadesPorColaborador,
  obterChaveAtividadeConsolidada
} = require("../atividades/atividade-agrupamento");
const { construirDadosGerenciaisRelatorio } = require("../atividades/dados-gerenciais-relatorio");
const { gerarGanttTabelaXml, aplicarPaisagemUltimaSecao } = require("./_relatorio-gantt");
const { obterModoRelatorio } = require("../atividades/payload-relatorio");
const { obterClassificacoesAtividade, possuiRateioPersistido } = require("../atividades/classificacoes");

const TEMPLATE_PATH = path.join(process.cwd(), "atividades", "template", "Relatorio.docx");
const MESES = ["JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO", "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"];
const STATUS = ["Atrasado", "Em progresso", "Pausado", "Finalizado"];
const PRIORIDADES = ["P0", "P1", "P2", "P3"];
const SEM_REGISTROS = "Não foram identificados registros para o período analisado.";
const RECUO_PRIMEIRA_LINHA_TWIPS = 567;
const LARGURA_TABELAS_ANEXO = 13750;
const MARCADORES_XML_BRUTO = [
  "BBBB", "CCCC", "DDDD", "EEEE", "FFFF",
  "GGGG", "HHHH", "IIII", "JJJJ", "KKKK", "LLLL"
];

function normalizarTexto(texto) { return String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }
function textoSeguro(texto) { return String(texto || "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c])); }
function obterIntervaloAtividade(a) { if (!a.dataInicio || !a.horaInicio || !a.dataTermino || !a.horaTermino) return null; const i = new Date(`${a.dataInicio}T${a.horaInicio}`); const f = new Date(`${a.dataTermino}T${a.horaTermino}`); return Number.isNaN(i.getTime()) || Number.isNaN(f.getTime()) || f <= i ? null : { inicio: i, fim: f }; }
function calcularHorasAtividade(a) { if (a?.consolidada && Number.isFinite(Number(a.horasConsolidadas))) return Number(a.horasConsolidadas); const intervalo = obterIntervaloAtividade(a); return intervalo ? (intervalo.fim - intervalo.inicio) / 36e5 : Number(a.horas || 0) || 0; }
function pluralizar(valor, singular, plural) { return Number(valor) === 1 ? singular : plural; }
function formatarNumero(valor, casas = 2) { return Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas }); }
function formatarPercentual(valor) { return `${formatarNumero(valor, 0)}%`; }
function formatarHorasRelatorio(valor) { return `${Number(valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} h`; }
function percentual(parte, total) { return total ? Math.round((parte / total) * 100) : 0; }
function normalizarNomeObra(valor) { return normalizarTexto(valor).replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " "); }
function identidadeProjeto(a) { return `${a.obraId || `legado:${normalizarNomeObra(a.obra)}`}|${normalizarTexto(a.projeto)}`; }
function chaveProjeto(a) { const obra = (a.obra || "Obra não informada").trim(); const codigo = String(a.obraCodigo || "").trim(); const projeto = (a.projeto || "Projeto não informado").trim(); return `${codigo ? `${codigo} — ` : ""}${obra} — ${projeto}`; }
function contarProjetosTrabalhados(lista) { return new Set(lista.map(identidadeProjeto)).size; }
function contarObrasDistintas(atividades) { return new Set(atividades.map((a) => a.obraId || `legado:${normalizarNomeObra(a.obra)}`).filter((v) => v !== "legado:")).size; }
function contarFrentesTrabalho(atividades) { return new Set(atividades.map(identidadeProjeto)).size; }
function contarDisciplinasDistintas(atividades) { return new Set(atividades.map((a) => normalizarTexto(a.projeto)).filter(Boolean)).size; }
function contarPor(lista, campo, valor) { return lista.filter((a) => normalizarTexto(a[campo]) === normalizarTexto(valor)).length; }
function topDescricao(lista) { return [...new Set(lista.map((a) => a.descricao || a.atividade || a.titulo).filter(Boolean).map((t) => String(t).trim()).filter(Boolean))].slice(0, 4); }
function mapaOrdenado(obj) { return Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); }
function runXml(texto, bold = false) { return `<w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${textoSeguro(texto)}</w:t></w:r>`; }
function propriedadesParagrafo({ alignment = "both", firstLine = RECUO_PRIMEIRA_LINHA_TWIPS, before = 0, after = 160, line = 276, widowControl = true, keepNext = false } = {}) {
  const indent = firstLine ? `<w:ind w:firstLine="${firstLine}"/>` : "";
  return `<w:pPr>${widowControl ? "<w:widowControl/>" : ""}${keepNext ? "<w:keepNext/>" : ""}<w:jc w:val="${alignment}"/>${indent}<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/></w:pPr>`;
}
function criarParagrafoJustificado(segmentos) { return `<w:p>${propriedadesParagrafo()}${segmentos.map((seg) => runXml(seg.texto, seg.bold)).join("")}</w:p>`; }
function criarTituloGrafico(texto) { return `<w:p><w:pPr><w:keepNext/><w:jc w:val="left"/><w:spacing w:before="200" w:after="120"/></w:pPr>${runXml(texto, true)}</w:p>`; }
function criarLegendaGrafico(texto) { return `<w:p>${propriedadesParagrafo({ alignment: "both", firstLine: 0, before: 80, after: 200, line: 276 })}${runXml(texto)}</w:p>`; }
function paragrafoRichXml(segmentos) { return criarParagrafoJustificado(segmentos); }
function textoRichXml(segmentos) { return criarParagrafoJustificado(segmentos); }
function juntarComE(itens) {
  const lista = (itens || []).filter(Boolean);
  if (!lista.length) return "";
  if (lista.length === 1) return lista[0];
  if (lista.length === 2) return `${lista[0]} e ${lista[1]}`;
  return `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}



function valorPredominante(contagens, fallback = "Não informado") {
  return mapaOrdenado(contagens)[0]?.[0] || fallback;
}

function statusEh(a, status) { return normalizarTexto(a.status) === normalizarTexto(status); }
function prioridadeEh(a, prioridade) { return normalizarTexto(a.prioridade) === normalizarTexto(prioridade); }
function semPrazo(valor) { const texto = normalizarTexto(valor); return !texto || texto === "sem previsao" || texto === "sem previsão" || texto === "nao informado" || texto === "não informado"; }
function nomeProjeto(p) { return p?.chave || p?.projeto || p?.obra || "Projeto/obra não informado"; }

function pontoAtencaoProjeto(p, indicadores = {}) {
  const statusPred = p.statusPredominante || valorPredominante(p.status);
  const prioridadePred = p.prioridadePredominante || valorPredominante(p.prioridades);
  if (p.conclusao === 100 || (p.atividades > 0 && p.finalizadas === p.atividades)) return "Demanda concluída no período.";
  if ((p.atrasadas || 0) > 0) return "Requer regularização de prazo e identificação do impedimento.";
  if ((p.pausadas || 0) > 0 || normalizarTexto(statusPred) === "pausado") return "Verificar motivo da interrupção.";
  if (prioridadePred === "P3") return "Demanda prioritária; requer acompanhamento direto.";
  if (prioridadePred === "P2") return "Acompanhar no curto prazo.";
  if ((p.horas || 0) >= Math.max(8, (indicadores.horasTotais || 0) * 0.15) && !(p.finalizadas || 0)) return "Alto esforço acumulado; monitorar evolução da entrega.";
  if (normalizarTexto(statusPred) === "em progresso") return "Demanda em desenvolvimento.";
  return "Acompanhamento rotineiro.";
}

function pontoGerencialProjeto(p, indicadores = {}) {
  const ponto = pontoAtencaoProjeto(p, indicadores);
  if (ponto.includes("crítica")) return "Por se tratar de demanda crítica, recomenda-se acompanhamento gerencial direto até a estabilização das entregas.";
  if (ponto.includes("Alta prioridade")) return "Por envolver alta prioridade, recomenda-se acompanhamento no curto prazo e validação dos próximos marcos.";
  if (ponto.includes("regularização")) return "A existência de atraso indica necessidade de regularização de prazo e alinhamento dos impedimentos.";
  if (ponto.includes("Alto esforço")) return "Por se tratar de demanda com carga horária relevante ainda sem finalização registrada, recomenda-se monitoramento até a conclusão das entregas previstas.";
  if (ponto.includes("desenvolvimento")) return "Por se tratar de demanda em desenvolvimento, recomenda-se acompanhamento até a conclusão das entregas previstas.";
  if (ponto.includes("concluída")) return "A demanda apresenta registro predominante de conclusão, contribuindo para a consolidação das entregas do período.";
  return "Não foram identificados pontos críticos específicos, mantendo-se o acompanhamento rotineiro da evolução.";
}

function gerarAnalisePorProjeto(listaAtividades) {
  const mapa = new Map();
  listaAtividades.forEach((a) => {
    const identidade = identidadeProjeto(a);
    if (!mapa.has(identidade)) mapa.set(identidade, { chave: chaveProjeto(a), obra: a.obra || "Obra não informada", obraId: a.obraId, obraCodigo: a.obraCodigo, projeto: a.projeto || "Projeto não informado", atividades: 0, lancamentos: 0, horas: 0, colaboradores: new Set(), status: {}, prioridades: {}, trabalhos: [], finalizadas: 0, progresso: 0, atrasadas: 0, pausadas: 0 });
    const item = mapa.get(identidade);
    item.atividades += 1; item.lancamentos += Number(a.quantidadeRegistros || 1); item.horas += calcularHorasAtividade(a);
    (a.colaboradores || [a.colaborador]).filter(Boolean).forEach((nome) => item.colaboradores.add(nome));
    item.status[a.status || "Sem status"] = (item.status[a.status || "Sem status"] || 0) + 1;
    item.prioridades[a.prioridade || "Sem prioridade"] = (item.prioridades[a.prioridade || "Sem prioridade"] || 0) + 1;
    item.finalizadas += statusEh(a, "Finalizado") ? 1 : 0;
    item.progresso += statusEh(a, "Em progresso") ? 1 : 0;
    item.atrasadas += statusEh(a, "Atrasado") ? 1 : 0;
    item.pausadas += statusEh(a, "Pausado") ? 1 : 0;
    const descricoes = a.trabalhos || [a.descricao || a.atividade || a.titulo];
    (Array.isArray(descricoes) ? descricoes : [descricoes]).filter(Boolean).forEach((desc) => item.trabalhos.push(String(desc).trim()));
  });
  return [...mapa.values()].map((p) => ({ ...p, colaboradores: [...p.colaboradores].sort(), trabalhos: [...new Set(p.trabalhos)].slice(0, 5), statusPredominante: valorPredominante(p.status), prioridadePredominante: valorPredominante(p.prioridades), conclusao: percentual(p.finalizadas, p.atividades) }))
    .sort((a, b) => b.horas - a.horas || b.atividades - a.atividades || a.chave.localeCompare(b.chave));
}

function agruparPorColaborador(lista) { return lista.reduce((acc, a) => { const nomes = (a.colaboradores || [a.colaborador]).filter(Boolean); nomes.forEach((n) => { acc[n] ||= { total: 0, lancamentos: 0, finalizadas: 0, progresso: 0, atrasadas: 0, horas: 0, projetosSet: new Set() }; acc[n].total += 1; acc[n].lancamentos += Number(a.quantidadeRegistros || 1); acc[n].finalizadas += statusEh(a, "Finalizado") ? 1 : 0; acc[n].progresso += statusEh(a, "Em progresso") ? 1 : 0; acc[n].atrasadas += statusEh(a, "Atrasado") ? 1 : 0; acc[n].horas += calcularHorasAtividade(a); acc[n].projetosSet.add(identidadeProjeto(a)); }); return acc; }, {}); }
function itemMaximo(entries, campo) { return entries.reduce((max, atual) => (!max || atual[1][campo] > max[1][campo] ? atual : max), null); }

function identificarProjetosCriticos(atividades) {
  return gerarAnalisePorProjeto(atividades).filter((p) => ["P2", "P3"].includes(p.prioridadePredominante) || p.atrasadas > 0 || p.prioridades.P2 || p.prioridades.P3);
}
function identificarAtividadesSemPrazo(atividades, atividadesSemanais = []) {
  return [...atividades.filter((a) => semPrazo(a.prazo || a.entrega || a.entregaPrevista || a.dataTermino)), ...atividadesSemanais.filter((a) => semPrazo(a.entregas || a.entrega || a.entregaPrevista))];
}
function identificarProjetosSemFinalizacao(atividades) { return gerarAnalisePorProjeto(atividades).filter((p) => p.progresso > 0 && p.finalizadas === 0); }
function identificarConcentracaoColaborador(atividades) { const resumo = Object.entries(agruparPorColaborador(atividades)); const horasTotais = atividades.reduce((s, a) => s + calcularHorasAtividade(a), 0); const maior = itemMaximo(resumo, "horas"); return maior && horasTotais && maior[1].horas / horasTotais > 0.5 ? { colaborador: maior[0], horas: maior[1].horas, percentual: percentual(maior[1].horas, horasTotais) } : null; }

function calcularIndicadoresGerenciais(atividades = [], atividadesSemanais = []) {
  const projetos = gerarAnalisePorProjeto(atividades), colabs = Object.entries(agruparPorColaborador(atividades));
  const total = atividades.length, horas = atividades.reduce((s, a) => s + calcularHorasAtividade(a), 0);
  const finalizadas = contarPor(atividades, "status", "Finalizado"), progresso = contarPor(atividades, "status", "Em progresso"), atrasadas = contarPor(atividades, "status", "Atrasado");
  const statusCont = STATUS.map((s) => [s, contarPor(atividades, "status", s)]), priCont = PRIORIDADES.map((p) => [p, contarPor(atividades, "prioridade", p)]);
  return { colaboradores: Object.fromEntries(colabs), totalAtividades: total, totalAtividadesConsolidadas: total, totalLancamentos: atividades.reduce((soma, a) => soma + Number(a.quantidadeRegistros || 1), 0), totalHoras: horas, totalProjetos: projetos.length, totalObras: contarObrasDistintas(atividades), totalFrentes: contarFrentesTrabalho(atividades), totalDisciplinas: contarDisciplinasDistintas(atividades), totalColaboradores: colabs.length, horasTotais: horas, horasMediasPorAtividade: total ? horas / total : 0, horasMediasPorColaborador: colabs.length ? horas / colabs.length : 0, taxaConclusao: percentual(finalizadas, total), taxaAndamento: percentual(progresso, total), statusPredominante: statusCont.sort((a,b)=>b[1]-a[1])[0]?.[0] || "Não informado", prioridadePredominante: priCont.sort((a,b)=>b[1]-a[1])[0]?.[0] || "Não informado", projetoMaiorCarga: projetos[0] || null, projetoMaiorAtividades: [...projetos].sort((a,b)=>b.atividades-a.atividades)[0] || null, colaboradorMaiorCarga: itemMaximo(colabs, "horas"), colaboradorMaiorAtividades: itemMaximo(colabs, "total"), colaboradorMaiorFinalizadas: itemMaximo(colabs, "finalizadas"), atividadesFinalizadas: finalizadas, atividadesProgresso: progresso, atividadesAtrasadas: atrasadas, atividadesP0: contarPor(atividades, "prioridade", "P0"), atividadesP1: contarPor(atividades, "prioridade", "P1"), atividadesP2: contarPor(atividades, "prioridade", "P2"), atividadesP3: contarPor(atividades, "prioridade", "P3"), atividadesSemPrazo: identificarAtividadesSemPrazo(atividades, atividadesSemanais).length, projetosSemFinalizacao: identificarProjetosSemFinalizacao(atividades), projetosCriticos: identificarProjetosCriticos(atividades), concentracaoColaborador: identificarConcentracaoColaborador(atividades), projetos };
}

function gerarPontosAtencao(atividades, atividadesSemanais = []) { const ind = calcularIndicadoresGerenciais(atividades, atividadesSemanais); const pontos = []; if (ind.atividadesP3) pontos.push("Demandas P3 exigem acompanhamento direto."); if (ind.atividadesP2) pontos.push("Demandas P2 requerem atenção no curto prazo."); if (ind.atividadesAtrasadas) pontos.push("Há atividades atrasadas que requerem regularização de prazo."); if (ind.atividadesSemPrazo) pontos.push("Há atividades sem prazo ou previsão de entrega definida."); if (ind.concentracaoColaborador) pontos.push(`Há concentração relevante de carga horária em ${ind.concentracaoColaborador.colaborador}.`); if (ind.projetosSemFinalizacao.length) pontos.push("Há projetos em progresso sem finalização registrada."); return pontos; }
function gerarEncaminhamentosRecomendados(atividades, atividadesSemanais = []) { const ind = calcularIndicadoresGerenciais(atividades, atividadesSemanais); const e = []; if (ind.atividadesP3) e.push("Acompanhar diretamente as demandas classificadas como P3."); if (ind.atividadesSemPrazo) e.push("Definir previsão de entrega para atividades sem prazo informado."); if (ind.projetoMaiorCarga) e.push("Monitorar projetos com maior carga horária acumulada."); if (ind.atividadesProgresso) e.push("Priorizar a conversão de atividades em progresso em entregas finalizadas."); if (ind.concentracaoColaborador) e.push("Avaliar a distribuição de carga da equipe para preservar capacidade operacional."); if (ind.projetosSemFinalizacao.length) e.push("Acompanhar projetos em progresso sem finalização registrada."); e.push("Manter a atualização semanal da aba Semana e dos registros do sistema."); return [...new Set(e)].slice(0, 6); }

function xmlConteudoCelula(conteudo, isHeader) { return Array.isArray(conteudo) ? conteudo.map((seg) => runXml(seg.texto, isHeader || seg.bold)).join("") : runXml(conteudo, isHeader); }
function criarBordasCelulaXml({ cor = "B4C6E7", tamanho = 4 } = {}) {
  return `<w:tcBorders><w:top w:val="single" w:sz="${tamanho}" w:color="${cor}"/><w:left w:val="single" w:sz="${tamanho}" w:color="${cor}"/><w:bottom w:val="single" w:sz="${tamanho}" w:color="${cor}"/><w:right w:val="single" w:sz="${tamanho}" w:color="${cor}"/></w:tcBorders>`;
}
function criarCelulaTabelaXml(conteudo, isHeader = false, coluna = {}, tamanhoFonte = 9) {
  const alinhamento = isHeader ? (coluna.alinhamentoCabecalho || "center") : (coluna.alinhamento || "left");
  const fonte = coluna.tamanhoFonte || (isHeader ? coluna.tamanhoFonteCabecalho : 0) || tamanhoFonte;
  const fill = coluna.fill || (isHeader ? "1F4E78" : "");
  const color = coluna.color || (isHeader ? "FFFFFF" : "000000");
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
  return `<w:tbl><w:tblPr><w:tblW w:w="${larguraTotal}" w:type="dxa"/><w:jc w:val="${opcoes.alinhamentoTabela}"/><w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellSpacing w:w="0" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B4C6E7"/><w:left w:val="single" w:sz="4" w:color="B4C6E7"/><w:bottom w:val="single" w:sz="4" w:color="B4C6E7"/><w:right w:val="single" w:sz="4" w:color="B4C6E7"/><w:insideH w:val="single" w:sz="4" w:color="B4C6E7"/><w:insideV w:val="single" w:sz="4" w:color="B4C6E7"/></w:tblBorders></w:tblPr><w:tblGrid>${opcoes.colunas.map((c) => `<w:gridCol w:w="${c.largura || 0}"/>`).join("")}</w:tblGrid>${criarLinhaTabelaXml(cabecalhos, true, opcoes)}${linhas.map((linha) => criarLinhaTabelaXml(linha, false, opcoes)).join("")}</w:tbl>`;
}
function criarEspacoAposTabelaXml(alturaPontos = 8) {
  const alturaTwips = Math.round(alturaPontos * 20);
  return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${alturaTwips}" w:lineRule="exact"/></w:pPr></w:p>`;
}

function gerarResumoGeral(atividades, indicadores = calcularIndicadoresGerenciais(atividades)) {
  if (!atividades.length) return paragrafoXml(SEM_REGISTROS);
  const pausadas = contarPor(atividades, "status", "Pausado");
  const linhas = [["Atividades", indicadores.totalAtividades, "Lançamentos", indicadores.totalLancamentos], ["Obras", indicadores.totalObras, "Frentes", indicadores.totalFrentes], ["Disciplinas", indicadores.totalDisciplinas, "Colaboradores", indicadores.totalColaboradores], ["Horas", `${formatarNumero(indicadores.horasTotais)} h`, "Média/atividade", `${formatarNumero(indicadores.horasMediasPorAtividade)} h`], ["Finalizadas", indicadores.atividadesFinalizadas, "Em andamento", indicadores.atividadesProgresso], ["Atrasadas", indicadores.atividadesAtrasadas, "Pausadas", pausadas], ["Conclusão", formatarPercentual(indicadores.taxaConclusao), "Atraso", formatarPercentual(percentual(indicadores.atividadesAtrasadas, indicadores.totalAtividades))]];
  return paragrafoXml("Síntese Gerencial", true) + criarTabelaXml(["Indicador", "Resultado", "Indicador", "Resultado"], linhas, { colunas: [{ largura: 2800 }, { largura: 1500, alinhamento: "center", noWrap: true }, { largura: 2800 }, { largura: 1500, alinhamento: "center", noWrap: true }] }) + criarEspacoAposTabelaXml(8) + paragrafoCorpoXml(`Leitura gerencial: o status predominante foi ${indicadores.statusPredominante}, com taxa de andamento de ${formatarPercentual(indicadores.taxaAndamento)}. ${indicadores.atividadesAtrasadas ? "Os atrasos requerem regularização e acompanhamento de prazo." : "Não foram identificadas atividades atrasadas."}`);
}

function gerarDesempenhoColaboradores(atividades, indicadores = calcularIndicadoresGerenciais(atividades), dadosGerenciais) { const resumo=dadosGerenciais?.colaboradores || Object.entries(agruparPorColaborador(atividades)).map(([nome,d])=>({nome,atividades:d.total,lancamentos:d.lancamentos,horas:d.horas,frentes:d.projetosSet.size,finalizadas:d.finalizadas,atrasadas:d.atrasadas,conclusao:percentual(d.finalizadas,d.total)})).sort((a,b)=>b.horas-a.horas); if(!resumo.length)return paragrafoXml(SEM_REGISTROS); const colunas=[{largura:1900},{largura:750,alinhamento:"center",noWrap:true},{largura:750,alinhamento:"center",noWrap:true},{largura:850,alinhamento:"center",noWrap:true},{largura:750,alinhamento:"center",noWrap:true},{largura:800,alinhamento:"center",noWrap:true},{largura:750,alinhamento:"center",noWrap:true},{largura:950,alinhamento:"center",noWrap:true}]; return criarTabelaXml(["Colaborador","Ativ.","Lanç.","Horas","Frentes","Finaliz.","Atras.","Conclusão"],resumo.map((d)=>[d.nome,d.atividades,d.lancamentos,formatarHorasRelatorio(d.horas),d.frentes,d.finalizadas,d.atrasadas,formatarPercentual(d.conclusao)]),{colunas,tamanhoFonte:8})+paragrafoXml(gerarLeituraGraficoHorasColaborador(indicadores),{alignment:"both"}); }
function gerarDistribuicaoStatus(atividades, indicadores = calcularIndicadoresGerenciais(atividades)) { if (!atividades.length) return paragrafoXml(SEM_REGISTROS); const total=atividades.length; const leitura=(s,q)=> normalizarTexto(s)==="atrasado" ? (q>0 ? "Requer regularização e acompanhamento de prazo." : "Sem atraso identificado.") : normalizarTexto(s)==="em progresso" ? "Demandas em desenvolvimento; acompanhar conversão em entregas." : normalizarTexto(s)==="pausado" ? (q>0 ? "Verificar motivo da interrupção." : "Sem demandas pausadas.") : "Demandas concluídas no período."; const cont=STATUS.map((s)=>[s,contarPor(atividades,"status",s)]); const tabela=criarTabelaXml(["Status", "Quantidade", "Percentual", "Leitura gerencial"], cont.map(([s,q])=>[s,q,formatarPercentual(percentual(q,total)),leitura(s,q)])); return tabela + criarEspacoAposTabelaXml(8) + paragrafoRichXml([{ texto: "O status predominante foi " }, { texto: indicadores.statusPredominante, bold: true }, { texto: ". Esse indicador orienta o acompanhamento do fluxo de entregas e a priorização de ações gerenciais. " }, { texto: indicadores.atividadesAtrasadas ? "Como há atividades atrasadas, recomenda-se revisar prazos e impedimentos." : "Sem atrasos registrados, o foco permanece na conversão das demandas em progresso em entregas finalizadas." }]); }
function gerarDistribuicaoProjeto(atividades, indicadores = calcularIndicadoresGerenciais(atividades)) { const projetos=gerarAnalisePorProjeto(atividades); if(!projetos.length)return paragrafoXml(SEM_REGISTROS); const top=[...projetos].sort((a,b)=>(b.atrasadas-a.atrasadas)||(b.horas-a.horas)).slice(0,10); return criarTabelaXml(["Obra e disciplina","Ativ.","Horas","Status","Conclusão","Ação"],top.map((p)=>[p.chave,p.atividades,`${formatarNumero(p.horas)} h`,p.statusPredominante,formatarPercentual(p.conclusao),pontoAtencaoProjeto(p,indicadores)]),{colunas:[{largura:2500},{largura:650,alinhamento:"center",noWrap:true},{largura:750,alinhamento:"center",noWrap:true},{largura:1200,alinhamento:"center",noWrap:true},{largura:900,alinhamento:"center",noWrap:true},{largura:3000}]})+criarEspacoAposTabelaXml(8)+paragrafoCorpoXml(`O corpo apresenta as ${top.length} frentes mais relevantes; o detalhamento completo está no Anexo A.`,{alignment:"both"}); }
function gerarDistribuicaoPrioridade(atividades, indicadores = calcularIndicadoresGerenciais(atividades)) { if(!atividades.length) return paragrafoXml(SEM_REGISTROS); const total=atividades.length; const interp={P0:"Menor urgência.",P1:"Prioridade intermediária.",P2:"Alta prioridade; requer atenção no curto prazo.",P3:"Demanda crítica; exige acompanhamento direto."}; const cont=PRIORIDADES.map((p)=>[p, contarPor(atividades,"prioridade",p)]); const tabela=criarTabelaXml(["Prioridade", "Quantidade", "Percentual", "Interpretação"], cont.map(([p,q])=>[p,q,formatarPercentual(percentual(q,total)),interp[p]])); const projetosCriticos=[...new Set(atividades.filter((a)=>prioridadeEh(a,"P2")||prioridadeEh(a,"P3")).map(chaveProjeto))].sort(); return tabela + criarEspacoAposTabelaXml(8) + paragrafoRichXml([{ texto: "A prioridade predominante foi " }, { texto: indicadores.prioridadePredominante, bold: true }, { texto: ". Foram identificadas " }, { texto: `${indicadores.atividadesP3} demandas P3`, bold: true }, { texto: ` e ${indicadores.atividadesP2} demandas P2. ` }, ...(projetosCriticos.length ? [{ texto: "Foram identificadas demandas críticas ou prioritárias nos projetos: " }, { texto: juntarComE(projetosCriticos), bold: true }, { texto: "." }] : [{ texto: "Não foram identificadas demandas críticas ou prioritárias classificadas como P3 ou P2 no período analisado." }])]); }
function observacaoSemanal(i) { const desc = normalizarTexto(`${i.descricao || ""} ${i.atividade || ""}`); const pr = String(i.prioridade || "").toUpperCase(); if (semPrazo(i.entregas || i.entrega || i.entregaPrevista)) return "Definir previsão de entrega."; if (pr === "P3") return "Acompanhamento prioritário."; if (pr === "P2") return "Atenção no curto prazo."; if (["analisador de energia","instalacao","retirada","levantamento"].some((t)=>desc.includes(t))) return "Atividade de campo; acompanhar fechamento."; if (["atualizacao","projeto"].some((t)=>desc.includes(t))) return "Monitorar revisão e emissão."; return "Acompanhar evolução da demanda."; }
function gerarAtividadesSemana(semanais, indicadores = {}, periodo = {}) { if(!semanais.length) return paragrafoXml(SEM_REGISTROS); const titulo=paragrafoXml(`${periodo.rotulo || "Planejamento"} — ${formatarDataIso(periodo.dataInicio)} a ${formatarDataIso(periodo.dataFim)}`, { bold:true, keepNext:true }); const tabela=criarTabelaXml(["Atividade", "Prioridade", "Entrega prevista", "Observação gerencial"], semanais.map((i)=>[resumirTextoRelatorio(sanitizarTextoGerencial(i.atividade || i.descricao || "Atividade não informada")), i.prioridade || "Não informada", sanitizarTextoGerencial(i.entregas || "SEM PREVISÃO"), observacaoSemanal(i)]), { colunas:[{largura:3400},{largura:900,alinhamento:"center"},{largura:1800},{largura:3000}] }); return titulo + tabela + criarEspacoAposTabelaXml(8); }
function gerarConclusao(atividades, atividadesSemanais = [], indicadores = calcularIndicadoresGerenciais(atividades, atividadesSemanais), periodo = {}) { if (!atividades.length) return paragrafoXml(SEM_REGISTROS); const principal=indicadores.projetoMaiorCarga?.chave; const status=`${indicadores.atividadesFinalizadas} finalizadas, ${indicadores.atividadesProgresso} em progresso e ${indicadores.atividadesAtrasadas ? indicadores.atividadesAtrasadas : "nenhuma"} atrasada${indicadores.atividadesAtrasadas===1?"":"s"}`; const pontos=gerarPontosAtencao(atividades, atividadesSemanais); return paragrafoCorpoXml(`Na ${String(periodo.rotulo||"período").replace(/^SEMANA/i,"Semana")} foram consolidadas ${indicadores.totalAtividades} atividades, totalizando ${formatarHorasRelatorio(indicadores.horasTotais)} de esforço registrado. A taxa de conclusão alcançou ${formatarPercentual(indicadores.taxaConclusao)}, com ${status}.${principal?` A maior concentração de esforço ocorreu em ${principal}.`:""}`)+paragrafoCorpoXml(pontos.length?`Pontos de atenção: ${pontos.join(" ")}`:"Não foram identificados pontos de atenção aplicáveis aos indicadores do período."); }

function sanitizarTextoGerencial(texto) { return String(texto || "").replace(/!+\s*\./g, ".").replace(/([!?.,])\1+/g, "$1").replace(/\s+([.,;:!?])/g, "$1").replace(/\s{2,}/g, " ").trim(); }
function resumirTextoRelatorio(texto, limite = 120) { const limpo = String(texto || "").replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim(); return limpo.length <= limite ? limpo : `${limpo.slice(0, limite - 1).trimEnd()}…`; }
function obterPrazoAtividade(atividade) { return atividade.prazo || atividade.entrega || atividade.entregaPrevista || ""; }
function calcularDiasAtraso(atividade, dataReferencia) { if (statusEh(atividade, "Finalizado") || !statusEh(atividade, "Atrasado")) return 0; const prazo = obterPrazoAtividade(atividade); const fim = prazo ? new Date(`${String(prazo).slice(0, 10)}T12:00:00`) : null; const ref = dataReferencia ? new Date(`${String(dataReferencia).slice(0, 10)}T12:00:00`) : new Date(); return fim && !Number.isNaN(fim.getTime()) && ref > fim ? Math.floor((ref - fim) / 864e5) : 0; }
function formatarDataHoraRelatorio(valor, { incluirHora = false } = {}) { if (!valor) return "Não informada"; const data = new Date(valor); if (Number.isNaN(data.getTime())) return formatarDataIso(String(valor).slice(0, 10)); const dataFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Boa_Vista", day: "2-digit", month: "2-digit", year: "numeric" }).format(data); if (!incluirHora) return dataFmt; const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Boa_Vista", hour: "2-digit", minute: "2-digit", hour12: false }).format(data); return `${dataFmt} às ${hora}`; }
function gerarLeituraGraficoStatus(i) { if (normalizarTexto(i.statusPredominante) === "atrasado") return "O volume de atividades atrasadas supera os demais status e requer revisão dos prazos e impedimentos."; const total=i.totalAtividades||0, finalizadas=i.atividadesFinalizadas||0, progresso=i.atividadesProgresso||0, atrasadas=i.atividadesAtrasadas||0; return `Das ${total} atividades do período, ${finalizadas} foram finalizadas e ${progresso} ${progresso===1?"permaneceu":"permaneceram"} em progresso, resultando em taxa de conclusão de ${formatarPercentual(i.taxaConclusao)}${atrasadas?`, com ${atrasadas} ${pluralizar(atrasadas,"registro","registros")} de atraso`: ", sem registros de atraso"}.`; }
function gerarLeituraGraficoPrioridade(i) { return i.atividadesP3 ? `${i.atividadesP3} demandas P3 abertas requerem acompanhamento direto.` : `A prioridade predominante foi ${i.prioridadePredominante}, sem demanda P3 identificada.`; }
function gerarLeituraGraficoHorasColaborador(i) { if (!i.colaboradorMaiorCarga) return SEM_REGISTROS; const ordenados=Object.entries(i.colaboradores || {}).sort((a,b)=>b[1].horas-a[1].horas); return `${i.colaboradorMaiorCarga[0]} registrou a maior carga horária do período, com ${formatarNumero(i.colaboradorMaiorCarga[1].horas)} h${ordenados[1] ? `, seguido por ${ordenados[1][0]}, com ${formatarNumero(ordenados[1][1].horas)} h` : ""}.`; }
function gerarLeituraGraficoAtividadesColaborador(i) { if(!i.colaboradorMaiorAtividades)return SEM_REGISTROS; const lider=i.colaboradorMaiorAtividades, finalista=i.colaboradorMaiorFinalizadas; return lider[0]===finalista?.[0]?`${lider[0]} apresentou o maior volume de atividades consolidadas, com ${lider[1].total} registros, e também liderou o número de entregas finalizadas.`:`${lider[0]} apresentou o maior volume de atividades consolidadas, com ${lider[1].total} registros, enquanto ${finalista?.[0]} liderou as entregas finalizadas.`; }
function gerarLeituraGraficoColaborador(i) { return gerarLeituraGraficoHorasColaborador(i); }
function gerarPrincipaisEntregas(atividades) { const finalizadas=atividades.filter((a)=>statusEh(a,"Finalizado")); const validas=finalizadas.filter((a)=>calcularHorasAtividade(a)>0); const itens=(validas.length?validas:finalizadas).sort((a,b)=>calcularHorasAtividade(b)-calcularHorasAtividade(a)).slice(0,7); return itens.length ? criarTabelaXml(["Obra","Entrega","Responsáveis","Horas","Conclusão"],itens.map((a)=>[`${a.obraCodigo ? `${a.obraCodigo} — ` : ""}${a.obra || "Não informada"}`,`${a.projeto||"Não informada"} — ${a.etapa||"Não informada"}\n${resumirTextoRelatorio((a.trabalhos||topDescricao(a.registros||[a])).join?.("; ") || "",120)}`,juntarComE(a.colaboradores||[a.colaborador])||"Não informado",calcularHorasAtividade(a)>0?`${formatarNumero(calcularHorasAtividade(a))} h`:"—",formatarDataHoraRelatorio(a.dataTerminoMaisRecente||a.dataTermino)]),{colunas:[{largura:1800},{largura:3900},{largura:1500},{largura:700,alinhamento:"center",noWrap:true},{largura:1100,alinhamento:"center",noWrap:true}],tamanhoFonte:8}) + criarEspacoAposTabelaXml(8) + paragrafoCorpoXml("As demais entregas registradas no período estão detalhadas no Anexo A.") : paragrafoXml(SEM_REGISTROS); }
function gerarRiscos(atividades, periodo) { const ordem=(a)=>statusEh(a,"Atrasado")?0:prioridadeEh(a,"P3")?1:prioridadeEh(a,"P2")?2:statusEh(a,"Pausado")?3:semPrazo(obterPrazoAtividade(a))?4:9; const itens=atividades.filter((a)=>!statusEh(a,"Finalizado")&&ordem(a)<9).sort((a,b)=>ordem(a)-ordem(b)||calcularDiasAtraso(b,periodo.dataFim)-calcularDiasAtraso(a,periodo.dataFim)).slice(0,10); return (itens.length?criarTabelaXml(["Obra","Disciplina / etapa","Situação","Prazo","Responsável","Ação"],itens.map((a)=>{const prazo=obterPrazoAtividade(a),dias=calcularDiasAtraso(a,periodo.dataFim);return [a.obra||"Não informada",`${a.projeto||"Não informada"} / ${a.etapa||"Não informada"}`,`${a.status||"Não informado"} · ${a.prioridade||"Não informada"}`,prazo?`${formatarDataHoraRelatorio(prazo)}${dias?` (${dias} ${pluralizar(dias,"dia","dias")})`:""}`:"Sem prazo",juntarComE(a.colaboradores||[a.colaborador])||"Não informado",!prazo?"Definir prazo e revisar a situação da atividade.":statusEh(a,"Atrasado")?"Regularizar prazo e identificar impedimento.":statusEh(a,"Pausado")?"Verificar interrupção.":"Acompanhar no curto prazo."]; }),{colunas:[{largura:1400},{largura:1700},{largura:1200,alinhamento:"center",noWrap:true},{largura:1300,alinhamento:"center",noWrap:true},{largura:1300},{largura:2100}],tamanhoFonte:8}):paragrafoXml(SEM_REGISTROS))+criarEspacoAposTabelaXml(8)+paragrafoCorpoXml("Os demais itens permanecem disponíveis no anexo."); }
function verificarConsistencia(atividades, periodo, dadosGerenciais = {}, gantt = {}) {
  const { projetoExigeFaseItem } = require("../atividades/fase-item");
  const { analisarDuracaoAtividade, horasPersistidasAtividade, obterClassificacoesAtividade } = require("../atividades/classificacoes");
  const ocorrencias = [], cont = { intervalosInvalidos: 0, duracoesSuspeitas: 0, semObra: 0, semProjeto: 0, semColaborador: 0, finalizadasSemTermino: 0, divergenciasHoras: 0, divergenciasRateio: 0, semFase: 0, semItem: 0 };
  atividades.forEach((a) => {
    const di = valorRegistro(a, "dataInicio", "data_inicio"), df = valorRegistro(a, "dataTermino", "data_termino"), hi = valorRegistro(a, "horaInicio", "hora_inicio"), hf = valorRegistro(a, "horaTermino", "hora_termino");
    const analise = analisarDuracaoAtividade(a), persistida = horasPersistidasAtividade(a), identificacao = [a.obra || "Sem obra", a.projeto || "Sem projeto", a.colaborador || "Sem colaborador", formatarDataIso(di)].join(" / ");
    if (analise.motivo === "intervalo_negativo") { cont.intervalosInvalidos++; cont.duracoesSuspeitas++; ocorrencias.push(`${identificacao}: intervalo ${String(hi).slice(0, 5)}–${String(hf).slice(0, 5)} inválido e duração negativa.`); }
    else if (!analise.valido) { cont.duracoesSuspeitas++; ocorrencias.push(`${identificacao}: ${analise.motivo === "duracao_zero" ? "duração zero" : "intervalo incompleto ou inválido"}.`); }
    else if (analise.horas > 24) { cont.duracoesSuspeitas++; ocorrencias.push(`${identificacao}: duração superior a 24 horas.`); }
    if (analise.valido && persistida !== null && Math.abs(persistida - analise.horas) > .02) { cont.divergenciasHoras++; ocorrencias.push(`${identificacao}: horas registradas divergem do intervalo calculado.`); }
    const fonteRateio = a.classificacoes || a.atividade_classificacoes, classificacoes = obterClassificacoesAtividade(a);
    if (analise.valido && Array.isArray(fonteRateio) && fonteRateio.length && Math.abs(classificacoes.reduce((soma, item) => soma + item.minutosDedicados, 0) - analise.minutos) > 1) { cont.divergenciasRateio++; ocorrencias.push(`${identificacao}: rateio diverge da duração total.`); }
    if (!a.obra && !a.obraId) cont.semObra++; if (!a.projeto) cont.semProjeto++; if (!a.colaborador && !a.colaboradores?.length) cont.semColaborador++; if (statusEh(a, "Finalizado") && (!df || !hf)) cont.finalizadasSemTermino++;
    if (projetoExigeFaseItem(a.projeto)) { if (!a.fase && !a.etapa) cont.semFase++; if (!a.item) cont.semItem++; }
  });
  const total = Number(dadosGerenciais.horasTotais || 0), somaColab = (dadosGerenciais.horasPorColaborador || []).reduce((x, y) => x + y.valor, 0), somaFrente = (dadosGerenciais.horasPorFrente || []).reduce((x, y) => x + y.valor, 0);
  if (Math.abs(total - somaColab) > .02 || Math.abs(total - somaFrente) > .02) cont.divergenciasHoras++;
  const erros = cont.intervalosInvalidos + cont.duracoesSuspeitas + cont.semObra + cont.semProjeto + cont.semColaborador + cont.finalizadasSemTermino + cont.divergenciasHoras + cont.divergenciasRateio;
  return { contagens: cont, ocorrencias, totalInconsistencias: erros, coberturaGantt: Number(gantt.coberturaGantt || 0) };
}
function gerarQuadroConsistencia(resultado) { const c=resultado.contagens; const linhas=[["Intervalos inválidos",c.intervalosInvalidos],["Durações suspeitas",c.duracoesSuspeitas],["Registros sem obra",c.semObra],["Registros sem projeto",c.semProjeto],["Registros sem colaborador",c.semColaborador],["Finalizadas sem término",c.finalizadasSemTermino],["Divergência de horas",c.divergenciasHoras],["Divergência de rateio",c.divergenciasRateio||0],["Sem Fase / Item (cobertura)",`${c.semFase} / ${c.semItem}`],["Cobertura Planner/Gantt",`${resultado.coberturaGantt.toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})}%`]]; let xml=paragrafoXml(resultado.totalInconsistencias?`Status da base: atenção — ${resultado.totalInconsistencias} ${pluralizar(resultado.totalInconsistencias,"inconsistência identificada","inconsistências identificadas")}.`:"Status da base: base consistente.",{bold:true})+criarTabelaXml(["Verificação","Resultado"],linhas,{colunas:[{largura:6200},{largura:2200,alinhamento:"center"}]}); if(resultado.ocorrencias.length) xml+=paragrafoXml("Principais ocorrências:",{bold:true,keepNext:true})+resultado.ocorrencias.slice(0,8).map(x=>paragrafoXml(`• ${x}`)).join(""); return xml; }
function normalizarImagemBase64(valor) { const texto=String(valor||""); const m=texto.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/); if(!m)return null; const jpeg=m[1]!=="png"; return { buffer:Buffer.from(m[2],"base64"), extensao:jpeg?"jpg":"png", mime:jpeg?"image/jpeg":"image/png" }; }
function paragrafoXml(texto, opcoes = {}) { const config = typeof opcoes === "boolean" ? { bold: opcoes } : opcoes; return `<w:p>${propriedadesParagrafo({ alignment: config.alignment || "left", firstLine: config.firstLine || 0, before: config.before || 0, after: config.after ?? 160, line: 276, widowControl: Boolean(config.widowControl), keepNext: Boolean(config.keepNext) })}${runXml(texto, config.bold)}</w:p>`; }
function paragrafoCorpoXml(texto, opcoes = {}) { return paragrafoXml(texto, { alignment: "both", firstLine: RECUO_PRIMEIRA_LINHA_TWIPS, widowControl: true, ...opcoes }); }
function imagemXml(rId, idx, largura, altura) { const cx=5852160, proporcao=Number(largura)>0&&Number(altura)>0?Number(altura)/Number(largura):0.5625, cy=Math.round(cx*proporcao); return `<w:p><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="160" w:after="160"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${900+idx}" name="Grafico ${idx}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${idx}" name="grafico-${idx}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`; }
function garantirContentTypePng(zip) { const ct=zip.file("[Content_Types].xml").asText(); if(!ct.includes('Extension="png"'))zip.file("[Content_Types].xml",ct.replace("</Types>",'<Default Extension="png" ContentType="image/png"/></Types>')); }
function adicionarRelationships(zip, relationships) { if(!relationships)return; const caminho="word/_rels/document.xml.rels",rels=zip.file(caminho).asText(); zip.file(caminho,rels.replace("</Relationships>",`${relationships}</Relationships>`)); }
function prepararGanttAnexo(_zip,gantt={}) { return gerarGanttTabelaXml(gantt).xml; }
function prepararGraficos(zip, graficos={}, indicadores={}, dados={}) { const dois=(lista)=>[lista?.[0],lista?.[1]]; const [fh1,fh2]=dois(dados.topHorasPorFrente), [fa1,fa2]=dois(dados.topAtividadesPorFrente), [d1,d2]=dois(dados.atividadesPorDisciplina); const leituraHorasFrente=fh1?`${fh1.labelVisual} concentrou ${formatarHorasRelatorio(fh1.valor)}${fh2?`, seguido de ${fh2.labelVisual}, com ${formatarHorasRelatorio(fh2.valor)}. Juntas, representaram ${formatarPercentual((fh1.valor+fh2.valor)*100/(dados.horasTotais||1))} do esforço registrado`:""}`:"Sem frentes registradas"; const defs=[ ["status","Atividades por status",gerarLeituraGraficoStatus(indicadores)], ["horasColaborador","Horas por colaborador",gerarLeituraGraficoHorasColaborador(indicadores)], ["atividadesColaborador","Atividades por colaborador",gerarLeituraGraficoAtividadesColaborador(indicadores)], ["horasProjeto","Top 10 frentes por horas",leituraHorasFrente], ["atividadesProjeto","Top 10 frentes por atividades",fa1?`${fa1.labelVisual} concentrou ${fa1.valor} atividades${fa2?`, seguida de ${fa2.labelVisual}, com ${fa2.valor}`:""}.`:SEM_REGISTROS], ["tipoProjeto","Atividades por disciplina",d1?`${d1.label} concentrou ${d1.valor} atividades${d2?` e ${d2.label}, ${d2.valor}`:""}, liderando o volume de registros.`:SEM_REGISTROS] ]; let xml=paragrafoXml("Seis gráficos gerenciais sintetizam o período selecionado."); const rels=zip.file("word/_rels/document.xml.rels").asText(); let relInsert=""; defs.forEach(([key,titulo,leitura],i)=>{ xml+=criarTituloGrafico(`Gráfico ${i+1} — ${titulo}.`); const item=typeof graficos[key]==="string"?{imagem:graficos[key]}:(graficos[key]||{}); const imagem=normalizarImagemBase64(item.imagem); if(imagem){ const rId=`rIdRelChart${i+1}`, nome=`relatorio-grafico-${i+1}.${imagem.extensao}`; zip.file(`word/media/${nome}`,imagem.buffer); relInsert+=`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${nome}"/>`; xml+=imagemXml(rId,i+1,item.largura,item.altura); } else xml+=paragrafoXml("Gráfico não disponível no momento da geração do relatório."); xml+=criarLegendaGrafico(`Leitura gerencial: ${leitura}`); }); zip.file("word/_rels/document.xml.rels",rels.replace("</Relationships>",`${relInsert}</Relationships>`)); let ct=zip.file("[Content_Types].xml").asText(); if(!ct.includes('Extension="png"'))ct=ct.replace("</Types>",'<Default Extension="png" ContentType="image/png"/></Types>'); if(!ct.includes('Extension="jpg"'))ct=ct.replace("</Types>",'<Default Extension="jpg" ContentType="image/jpeg"/></Types>'); zip.file("[Content_Types].xml",ct); return xml; }
function extrairTextoParagrafoXml(paragrafoXml) {
  return [...paragrafoXml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)]
    .map((resultado) => resultado[1])
    .join("");
}

function converterMarcadorParagrafoParaXmlBruto(paragrafoXml, marcador) {
  const texto = extrairTextoParagrafoXml(paragrafoXml).replace(/\s+/g, "").trim();
  if (texto !== `[${marcador}]` && texto !== `[@${marcador}]`) return paragrafoXml;
  const aberturaParagrafo = paragrafoXml.match(/^<w:p\b[^>]*>/)?.[0] || "<w:p>";
  const propriedadesParagrafo = paragrafoXml.match(/<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/)?.[0] || "";
  return `${aberturaParagrafo}${propriedadesParagrafo}<w:r><w:t>[@${marcador}]</w:t></w:r></w:p>`;
}

function prepararTemplateParaGraficos(zip) {
  const settings = zip.file("word/settings.xml");
  if (settings && !settings.asText().includes("<w:updateFields")) zip.file("word/settings.xml", settings.asText().replace("</w:settings>", '<w:updateFields w:val="true"/></w:settings>'));
  let documentXml = zip.file("word/document.xml").asText();
  documentXml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, (paragrafoXml) => {
    if (/<w:bookmarkStart\b[^>]*w:name="_Toc238041805"/.test(paragrafoXml) && extrairTextoParagrafoXml(paragrafoXml).includes("ANEXO B — GANTT DA EXECUÇÃO REAL DOS PROJETOS")) {
      if (/<w:pPr\b[^>]*>/.test(paragrafoXml) && !/<w:keepNext\b/.test(paragrafoXml)) {
        paragrafoXml = paragrafoXml.replace(/<w:pPr\b[^>]*>/, "$&<w:keepNext/>");
      }
    }
    for (const marcador of MARCADORES_XML_BRUTO) {
      const convertido = converterMarcadorParagrafoParaXmlBruto(paragrafoXml, marcador);
      if (convertido !== paragrafoXml) return convertido;
    }
    return paragrafoXml;
  });
  for (const marcador of MARCADORES_XML_BRUTO) {
    if (!documentXml.includes(`[@${marcador}]`)) {
      throw Object.assign(new Error(`O marcador [${marcador}] não foi preparado como XML bruto no modelo Word.`), { statusCode: 500 });
    }
  }
  zip.file("word/document.xml", documentXml);
}

function validarDocumentoFinal(doc) {
  const documentXmlFinal = doc.getZip().file("word/document.xml").asText();
  const indiceAnexo = documentXmlFinal.lastIndexOf("ANEXO A — DETALHAMENTO DAS FRENTES DE TRABALHO");
  const xmlDepoisDoAnexo = indiceAnexo >= 0 ? documentXmlFinal.slice(indiceAnexo) : "";
  if (indiceAnexo < 0) throw Object.assign(new Error("O título do Anexo A não foi encontrado no documento final."), { statusCode: 500 });
  if (xmlDepoisDoAnexo.includes("&lt;w:tbl&gt;") || /<w:t\b[^>]*>[\s\S]*?&lt;w:[\s\S]*?<\/w:t>/.test(xmlDepoisDoAnexo)) {
    throw Object.assign(new Error("O Anexo A foi inserido como texto escapado em vez de tabela OpenXML."), { statusCode: 500 });
  }
  if (!xmlDepoisDoAnexo.includes("<w:tbl>")) throw Object.assign(new Error("A tabela OpenXML do Anexo A não foi encontrada no documento final."), { statusCode: 500 });
  if (xmlDepoisDoAnexo.includes("[KKKK]") || xmlDepoisDoAnexo.includes("[@KKKK]")) {
    throw Object.assign(new Error("O marcador KKKK não foi substituído no documento final."), { statusCode: 500 });
  }
  if (documentXmlFinal.includes("[LLLL]") || documentXmlFinal.includes("[@LLLL]")) {
    throw Object.assign(new Error("O marcador LLLL não foi substituído no documento final."), { statusCode: 500 });
  }
  return documentXmlFinal;
}

function gerarApresentacao() { return paragrafoCorpoXml("O presente relatório tem por finalidade apresentar o acompanhamento das atividades desenvolvidas pelo Setor de Engenharia Elétrica, com base nos registros cadastrados no sistema de controle de atividades. O documento consolida informações por projeto, colaborador, status, prioridade, horas trabalhadas e planejamento semanal, permitindo visualizar o andamento das demandas e subsidiar a tomada de decisão."); }

function normalizarPeriodoRelatorio(periodo={}) { if (!periodo.rotulo || !periodo.dataInicio || !periodo.dataFim) throw Object.assign(new Error("Período do relatório não informado pelo Dashboard."), { statusCode: 400 }); return { tipo: periodo.tipo || "personalizado", rotulo: String(periodo.rotulo).toUpperCase(), dataInicio: String(periodo.dataInicio).slice(0,10), dataFim: String(periodo.dataFim).slice(0,10), mes: String(periodo.mes || "").toUpperCase(), ano: String(periodo.ano || ""), competenciaRelatorio: String(periodo.competenciaRelatorio || "") }; }
function formatarDataIso(data) { const [a,m,d]=String(data||"").split("-"); return a&&m&&d ? `${d}/${m}/${a}` : "Não informada"; }
function obterPartesDataIso(valor) { const match=String(valor||"").slice(0,10).match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!match)return null; const ano=Number(match[1]),mes=Number(match[2]),dia=Number(match[3]); if(mes<1||mes>12||dia<1||dia>31)return null; return {ano,mes,dia}; }
function formatarCompetenciaRelatorio(periodo={}) { const inicio=obterPartesDataIso(periodo.dataInicio),fim=obterPartesDataIso(periodo.dataFim); if(!inicio||!fim)throw Object.assign(new Error("Datas inválidas para calcular a competência do relatório."),{statusCode:400}); if(normalizarTexto(periodo.tipo)==="anual"&&inicio.ano===fim.ano)return String(inicio.ano); const formatar=(data)=>`${MESES[data.mes-1]}/${data.ano}`; return inicio.ano===fim.ano&&inicio.mes===fim.mes?formatar(inicio):`${formatar(inicio)} — ${formatar(fim)}`; }
function formatarPeriodoEmFrase(periodo) { const tipo=normalizarTexto(periodo.tipo); if(tipo==="semanal"||/^semana\s+\d+/i.test(periodo.rotulo)) return `Durante a ${String(periodo.rotulo).replace(/^semana/i,"Semana")}`; if(tipo==="mensal") return `Durante ${String(periodo.rotulo).toLowerCase()}`; if(tipo==="anual") return `Durante o ano de ${periodo.ano||String(periodo.rotulo).match(/\d{4}/)?.[0]||""}`; return `No período de ${formatarDataIso(periodo.dataInicio)} a ${formatarDataIso(periodo.dataFim)}`; }
function valorRegistro(registro, camel, snake) { return registro?.[camel] ?? registro?.[snake] ?? ""; }
function formatarIntervaloHorarioRelatorio(registro={}) { const reduzir=(valor)=>{const match=String(valor||"").match(/^(\d{2}):(\d{2})/);return match?`${match[1]}:${match[2]}`:"";}; const inicio=reduzir(valorRegistro(registro,"horaInicio","hora_inicio")),fim=reduzir(valorRegistro(registro,"horaTermino","hora_termino")); if(!inicio&&!fim)return "—"; return `${inicio||"—"}–${fim||"—"}`; }
function formatarDataLancamentoRelatorio(registro={}) { const valor=valorRegistro(registro,"dataInicio","data_inicio")||valorRegistro(registro,"dataTermino","data_termino")||valorRegistro(registro,"dataPrevista","data_prevista")||valorRegistro(registro,"criadoEm","criado_em"); return valor?formatarDataIso(String(valor).slice(0,10)):"—"; }
function chaveOrdenacaoRegistro(registro={}) { return [valorRegistro(registro,"dataInicio","data_inicio"),valorRegistro(registro,"horaInicio","hora_inicio"),valorRegistro(registro,"dataTermino","data_termino"),valorRegistro(registro,"horaTermino","hora_termino"),valorRegistro(registro,"criadoEm","criado_em")].map((v)=>String(v||"")).join("|"); }
function agruparLancamentosParaAnexo(registrosAtividades=[],atividadesConsolidadas=[]) { const consolidadas=new Map(atividadesConsolidadas.map((atividade)=>[atividade.chaveConsolidada||obterChaveAtividadeConsolidada(atividade),atividade])); const grupos=new Map(); registrosAtividades.forEach((registro)=>{const chave=obterChaveAtividadeConsolidada(registro);if(!grupos.has(chave))grupos.set(chave,[]);grupos.get(chave).push(registro);}); return [...grupos].map(([chave,registros])=>{const atividadeConsolidada=consolidadas.get(chave)||consolidarAtividades(registros)[0];return {chave,atividadeConsolidada,obraId:atividadeConsolidada.obraId,obraCodigo:atividadeConsolidada.obraCodigo,obra:atividadeConsolidada.obra,projeto:atividadeConsolidada.projeto,etapa:atividadeConsolidada.etapa,status:atividadeConsolidada.status,prioridade:atividadeConsolidada.prioridade,horas:calcularHorasAtividade(atividadeConsolidada),quantidadeLancamentos:registros.length,registros:[...registros].sort((a,b)=>chaveOrdenacaoRegistro(a).localeCompare(chaveOrdenacaoRegistro(b),"pt-BR"))};}).sort((a,b)=>[a.obraCodigo,a.obra,a.projeto,a.etapa].map((v)=>String(v||"")).join("|").localeCompare([b.obraCodigo,b.obra,b.projeto,b.etapa].map((v)=>String(v||"")).join("|"),"pt-BR",{sensitivity:"base",numeric:true})); }
function criarCabecalhoGrupoAnexo(grupo) {
  const atividade = grupo.atividadeConsolidada;
  const linhas = [
    ["OBRA", `${atividade.obraCodigo ? `${atividade.obraCodigo} — ` : ""}${atividade.obra || "Não informada"}`],
    ["DISCIPLINA / ETAPA", `${atividade.projeto || "Não informada"} — ${atividade.etapa || "Não informada"}`],
    ["SITUAÇÃO", `${atividade.status || "Não informado"} · ${atividade.prioridade || "Não informada"}`],
    ["RESUMO", `${grupo.quantidadeLancamentos} ${pluralizar(grupo.quantidadeLancamentos, "lançamento", "lançamentos")} · ${formatarNumero(grupo.horas)} h`]
  ];
  const colunas = [
    { largura: 1800, fill: "1F4E78", color: "FFFFFF", bold: true, alinhamento: "left", verticalAlign: "center", keepNext: true, margemVertical: 120, margemHorizontal: 140 },
    { largura: 11950, fill: "EAF2F8", color: "000000", alinhamento: "left", verticalAlign: "center", keepNext: true, margemVertical: 120, margemHorizontal: 140 }
  ];
  return `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA_TABELAS_ANEXO}" w:type="dxa"/><w:jc w:val="center"/><w:tblInd w:w="0" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblCellSpacing w:w="0" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="11950"/></w:tblGrid>${linhas.map((linha, linhaIndice) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${linha.map((celula, colunaIndice) => criarCelulaTabelaXml(celula, false, { ...colunas[colunaIndice], bold: colunaIndice === 0 || (linhaIndice === 0 && colunaIndice === 1), tamanhoFonte: 8 }, 8)).join("")}</w:tr>`).join("")}</w:tbl>`;
}
function gerarAnexoDetalhado(registrosAtividades, atividadesConsolidadas) {
  const grupos = agruparLancamentosParaAnexo(registrosAtividades, atividadesConsolidadas);
  if (!grupos.length) return criarTabelaXml(["Atividades"], [[SEM_REGISTROS]], { colunas: [{ largura: LARGURA_TABELAS_ANEXO }], larguraTotal: LARGURA_TABELAS_ANEXO });
  const colunasLancamentos = [
    { largura: 1100, alinhamento: "center", noWrap: true }, { largura: 1300 },
    { largura: 1100, alinhamento: "center", noWrap: true }, { largura: 850, alinhamento: "center", noWrap: true },
    { largura: 4800 }, { largura: 4600 }
  ];
  return grupos.map((grupo) => {
    const linhas = grupo.registros.map((registro) => [formatarDataLancamentoRelatorio(registro), registro.colaborador || "Não informado", formatarIntervaloHorarioRelatorio(registro), `${formatarNumero(calcularHorasAtividade(registro))} h`, String(registro.trabalhos || "").trim() || "Trabalho não informado", String(registro.observacoes || "").trim() || "—"]);
    return criarCabecalhoGrupoAnexo(grupo) + criarTabelaXml(["Data", "Colaborador", "Horário", "Duração", "Trabalho executado", "Observações"], linhas, { colunas: colunasLancamentos, larguraTotal: LARGURA_TABELAS_ANEXO, alinhamentoTabela: "center", tamanhoFonte: 8, tamanhoFonteCabecalho: 8 }) + criarEspacoAposTabelaXml(10);
  }).join("");
}
function consolidarFrentesAnexoMensal(registros = []) {
  const grupos = new Map();
  registros.flatMap((registro) => possuiRateioPersistido(registro)
    ? obterClassificacoesAtividade(registro).map((classificacao) => ({ ...registro, fase: classificacao.fase, item: classificacao.item, horasRateadas: classificacao.minutosDedicados / 60 }))
    : [registro]).forEach((registro) => {
    const obra = registro.obra || "Obra não informada", projeto = registro.projeto || "Projeto não informado";
    const fase = registro.fase || registro.etapa || "Atividades não classificadas", item = registro.item || "Atividades não classificadas";
    const chave = [registro.obraId || registro.obra_id || obra, projeto, fase, item].join("|");
    if (!grupos.has(chave)) grupos.set(chave, { obraCodigo: registro.obraCodigo || registro.obra_codigo || "", obra, projeto, fase, item, quantidade: 0, horas: 0, primeira: "", ultima: "", finalizadas: 0, progresso: 0, atrasadas: 0, colaboradores: new Set() });
    const grupo = grupos.get(chave), data = String(valorRegistro(registro, "dataInicio", "data_inicio") || valorRegistro(registro, "dataTermino", "data_termino") || "").slice(0, 10);
    grupo.quantidade += 1; grupo.horas += Number.isFinite(registro.horasRateadas) ? registro.horasRateadas : calcularHorasAtividade(registro);
    if (data && (!grupo.primeira || data < grupo.primeira)) grupo.primeira = data;
    if (data && (!grupo.ultima || data > grupo.ultima)) grupo.ultima = data;
    if (statusEh(registro, "Finalizado")) grupo.finalizadas += 1;
    if (statusEh(registro, "Em progresso")) grupo.progresso += 1;
    if (statusEh(registro, "Atrasado")) grupo.atrasadas += 1;
    if (registro.colaborador) grupo.colaboradores.add(String(registro.colaborador).trim());
  });
  return [...grupos.values()].map((grupo) => ({ ...grupo, horas: Number(grupo.horas.toFixed(2)), colaboradores: [...grupo.colaboradores].filter(Boolean).sort((a, b) => a.localeCompare(b, "pt-BR")) })).sort((a, b) => [a.obraCodigo, a.obra, a.projeto, a.fase, a.item].join("|").localeCompare([b.obraCodigo, b.obra, b.projeto, b.fase, b.item].join("|"), "pt-BR", { numeric: true }));
}
function gerarAnexoConsolidado(registros = []) {
  const grupos = consolidarFrentesAnexoMensal(registros);
  const introducao = paragrafoXml("Modo de apresentação: consolidado por frente de trabalho.", { bold: true }) + paragrafoCorpoXml("O Anexo A mensal apresenta os registros consolidados por frente de trabalho. O detalhamento individual permanece disponível no sistema de controle de atividades.");
  if (!grupos.length) return introducao + criarTabelaXml(["Atividades"], [[SEM_REGISTROS]], { colunas: [{ largura: LARGURA_TABELAS_ANEXO }], larguraTotal: LARGURA_TABELAS_ANEXO });
  const linhas = grupos.map((g) => [`${g.obraCodigo ? `${g.obraCodigo} — ` : ""}${g.obra}\nProjeto: ${g.projeto}`, `${g.fase} / ${g.item}`, g.quantidade, formatarHorasRelatorio(g.horas), `${formatarDataIso(g.primeira)}–${formatarDataIso(g.ultima)}`, `${g.finalizadas} final.\n${g.progresso} progresso\n${g.atrasadas} atras.`, g.colaboradores.join(" · ") || "Não informado"]);
  return introducao + criarTabelaXml(["Obra / projeto", "Fase / item", "Ativ.", "Horas", "Período", "Status", "Colaboradores"], linhas, { larguraTotal: LARGURA_TABELAS_ANEXO, tamanhoFonte: 8, colunas: [{ largura: 2600 }, { largura: 2600 }, { largura: 700, alinhamento: "center", noWrap: true }, { largura: 1000, alinhamento: "center", noWrap: true }, { largura: 1800, alinhamento: "center", noWrap: true }, { largura: 1800 }, { largura: 3250 }] });
}
function montarDadosRelatorio(body, zip) {
  const periodo=normalizarPeriodoRelatorio(body.periodoRelatorio), modoRelatorio=["semanal", "mensal", "anual", "personalizado", "longo"].includes(body.modoRelatorio) ? body.modoRelatorio : obterModoRelatorio(periodo), competencia=formatarCompetenciaRelatorio(periodo), registros=Array.isArray(body.atividades)?body.atividades:[], atividades=consolidarAtividades(registros), semanais=Array.isArray(body.atividadesSemanais)?body.atividadesSemanais:[];
  const dados=construirDadosGerenciaisRelatorio(registros); if(body.dadosGerenciais&&JSON.stringify(body.dadosGerenciais)!==JSON.stringify(dados)) throw Object.assign(new Error("Os dados dos gráficos divergem da fonte oficial do relatório."),{statusCode:400});
  const i=calcularIndicadoresGerenciais(atividades,semanais); i.horasTotais=i.totalHoras=dados.horasTotais; i.totalColaboradores=dados.colaboradores.length; i.colaboradores=Object.fromEntries(dados.colaboradores.map(d=>[d.nome,{total:d.atividades,lancamentos:d.lancamentos,finalizadas:d.finalizadas,atrasadas:d.atrasadas,horas:d.horas,projetosSet:new Set(Array(d.frentes))}])); const entradas=Object.entries(i.colaboradores); i.colaboradorMaiorCarga=itemMaximo(entradas,"horas"); i.colaboradorMaiorAtividades=itemMaximo(entradas,"total"); i.colaboradorMaiorFinalizadas=itemMaximo(entradas,"finalizadas"); i.atividadesFinalizadas=dados.quantidadeStatus.Finalizado; i.atividadesProgresso=dados.quantidadeStatus["Em progresso"]; i.atividadesAtrasadas=dados.quantidadeStatus.Atrasado; i.taxaConclusao=dados.percentualFinalizadas;
  const gantt={ ...(body.gantt||{}), modoRelatorio }, consistencia=verificarConsistencia(registros,periodo,dados,gantt); const resumo=paragrafoCorpoXml(`${formatarPeriodoEmFrase(periodo)}, o setor consolidou ${i.totalAtividades} atividades, totalizando ${formatarHorasRelatorio(i.horasTotais)}.`)+gerarResumoGeral(atividades,i);
  return { AAAA:String(body.tituloRelatorio||"").trim()||"Relatório executivo de atividades", PERIODO_RELATORIO:competencia, COMPETENCIA_RELATORIO:competencia, ROTULO_PERIODO_RELATORIO:periodo.rotulo, DATA_INICIO_RELATORIO:formatarDataIso(periodo.dataInicio), DATA_FIM_RELATORIO:formatarDataIso(periodo.dataFim), MES_ATUAL:periodo.mes, ANO_ATUAL:periodo.ano,
    BBBB:gerarApresentacao()+paragrafoXml(`Período oficial: ${formatarDataIso(periodo.dataInicio)} a ${formatarDataIso(periodo.dataFim)}.`), CCCC:resumo, DDDD:gerarPrincipaisEntregas(atividades)+criarTituloGrafico("DESEMPENHO DA EQUIPE")+gerarDesempenhoColaboradores(atividades,i,dados), EEEE:gerarDistribuicaoProjeto(atividades,i), FFFF:gerarRiscos(atividades,periodo), GGGG:gerarAtividadesSemana(semanais,i,periodo), HHHH:gerarQuadroConsistencia(consistencia), IIII:prepararGraficos(zip,body.graficos||{},i,dados), JJJJ:gerarConclusao(atividades,semanais,i,periodo), KKKK:modoRelatorio==="semanal"?gerarAnexoDetalhado(registros,atividades):gerarAnexoConsolidado(registros), LLLL:prepararGanttAnexo(zip,gantt) };
}

module.exports = async function gerarRelatorioWordHandler(req, res) { try { if (req.method !== "POST") { sendJson(res, 405, { error: "Método não suportado." }); return; } const user = await requireUser(req); if (user.perfil !== "admin") { sendJson(res, 403, { error: "Apenas o administrador da conta pode gerar o relatório Word." }); return; } if (!fs.existsSync(TEMPLATE_PATH)) { sendJson(res, 404, { error: "Modelo Relatorio.docx não encontrado em /atividades/template." }); return; } const body = parseRequestBody(req); const zip = new PizZip(fs.readFileSync(TEMPLATE_PATH)); prepararTemplateParaGraficos(zip); const doc = new Docxtemplater(zip, { delimiters: { start: "[", end: "]" }, paragraphLoop: true, linebreaks: true }); doc.render(montarDadosRelatorio(body, zip)); if (gerarGanttTabelaXml(body.gantt || {}).paisagem) { const arquivo = doc.getZip().file("word/document.xml"); doc.getZip().file("word/document.xml", aplicarPaisagemUltimaSecao(arquivo.asText())); } validarDocumentoFinal(doc); const buffer = doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }); const periodo = normalizarPeriodoRelatorio(body.periodoRelatorio); const slug = normalizarTexto(periodo.rotulo).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"); res.setHeader("Content-Disposition", `attachment; filename=\"relatorio-atividades-${slug}.docx\"`); res.status(200).send(buffer); } catch (error) { console.error("Erro ao gerar relatório Word:", error); sendJson(res, error.statusCode || 500, { error: error.message || "Erro interno ao gerar relatório Word." }); } };

module.exports._test = { contarObrasDistintas, contarFrentesTrabalho, contarDisciplinasDistintas, calcularIndicadoresGerenciais, pontoAtencaoProjeto, calcularDiasAtraso, obterPrazoAtividade, formatarDataHoraRelatorio, formatarPeriodoEmFrase, formatarCompetenciaRelatorio, formatarIntervaloHorarioRelatorio, formatarDataLancamentoRelatorio, agruparLancamentosParaAnexo, gerarAnexoDetalhado, consolidarFrentesAnexoMensal, gerarAnexoConsolidado, obterModoRelatorio, normalizarImagemBase64, gerarDesempenhoColaboradores, criarTabelaXml, resumirTextoRelatorio, sanitizarTextoGerencial, formatarHorasRelatorio, verificarConsistencia, gerarQuadroConsistencia, gerarConclusao, gerarAtividadesSemana, gerarLeituraGraficoStatus, normalizarPeriodoRelatorio, montarDadosRelatorio, extrairTextoParagrafoXml, converterMarcadorParagrafoParaXmlBruto, prepararTemplateParaGraficos, validarDocumentoFinal, prepararGanttAnexo, gerarGanttTabelaXml, aplicarPaisagemUltimaSecao, MARCADORES_XML_BRUTO };