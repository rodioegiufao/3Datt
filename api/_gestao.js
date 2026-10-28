const { chaveProjeto, completudeFicha, obterPendenciasFicha } = require("./_obra-ficha");
const { projetoExigeFaseItem } = require("../atividades/fase-item");

const DIAS_SEM_MOVIMENTACAO_ATENCAO = 7;
const COBERTURA_PLANNER_BOA = 90;
const COBERTURA_PLANNER_ATENCAO = 70;
const DIA_MS = 86400000;

function dataAtividade(atividade) {
  const termino = String(atividade?.data_termino || atividade?.dataTermino || "");
  const inicio = String(atividade?.data_inicio || atividade?.dataInicio || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(termino) ? termino : (/^\d{4}-\d{2}-\d{2}$/.test(inicio) ? inicio : null);
}
function calcularUltimaMovimentacao(atividades = []) {
  return atividades.map(dataAtividade).filter(Boolean).sort().at(-1) || null;
}
function diferencaDias(data, hoje = new Date().toISOString().slice(0, 10)) {
  if (!data) return null;
  return Math.max(0, Math.floor((Date.parse(`${hoje}T00:00:00Z`) - Date.parse(`${data}T00:00:00Z`)) / DIA_MS));
}
function intervaloValido(atividade) {
  const di = atividade.data_inicio || atividade.dataInicio, hi = atividade.hora_inicio || atividade.horaInicio;
  const dt = atividade.data_termino || atividade.dataTermino, ht = atividade.hora_termino || atividade.horaTermino;
  if (!di || !hi || !dt || !ht) return null;
  const inicio = new Date(`${di}T${hi}`), fim = new Date(`${dt}T${ht}`), minutos = (fim - inicio) / 60000;
  return Number.isFinite(minutos) && minutos > 0 ? { minutos, inicio, fim } : null;
}
function atividadesUnicas(atividades = []) {
  const mapa = new Map();
  atividades.forEach((a, i) => mapa.set(String(a.id || [a.data_inicio, a.hora_inicio, a.data_termino, a.hora_termino, a.obra_id, a.projeto, i].join("|")), a));
  return [...mapa.values()];
}
function calcularCoberturaPlanner(atividades = [], idsEstruturados = new Set()) {
  const validas = atividadesUnicas(atividades).map((atividade) => ({ atividade, intervalo: intervaloValido(atividade) })).filter((x) => x.intervalo);
  const minutosTotais = validas.reduce((s, x) => s + x.intervalo.minutos, 0);
  const minutosPlanner = validas.filter((x) => idsEstruturados.has(String(x.atividade.id))).reduce((s, x) => s + x.intervalo.minutos, 0);
  return { horasTotais: minutosTotais / 60, horasPlanner: minutosPlanner / 60, cobertura: minutosTotais ? minutosPlanner / minutosTotais * 100 : null };
}
function classificarCoberturaPlanner(valor) { return valor === null ? "nao_aplicavel" : valor >= COBERTURA_PLANNER_BOA ? "boa" : valor >= COBERTURA_PLANNER_ATENCAO ? "atencao" : "baixa"; }
function compararProjetosDetectadosCadastrados(detectados = [], cadastrados = []) {
  const cadastradas = new Set(cadastrados.map((p) => chaveProjeto(p.projeto_chave || p.codigo_projeto || p.projeto || p)));
  const mapa = new Map();
  detectados.forEach((p) => { const chave = chaveProjeto(p.projeto_chave || p.codigo_projeto || p.projeto || p); if (chave && !cadastradas.has(chave)) mapa.set(chave, typeof p === "string" ? p : p.projeto); });
  return { detectados: new Set(detectados.map((p) => chaveProjeto(p.codigo_projeto || p.projeto || p)).filter(Boolean)).size, cadastrados: cadastradas.size, pendentes: [...mapa].map(([chave, projeto]) => ({ chave, projeto })) };
}
function construirAlertasGestao(obra) {
  const alertas = [], link = (secao) => `/admin/?obra=${encodeURIComponent(obra.id)}&secao=${secao}`;
  if (obra.ativo && obra.diasSemMovimentacao !== null && obra.diasSemMovimentacao >= DIAS_SEM_MOVIMENTACAO_ATENCAO) alertas.push({ tipo: "SEM_MOVIMENTACAO", prioridade: 1, obraId: obra.id, obra: obra.nome, mensagem: `Sem movimentação há ${obra.diasSemMovimentacao} dias.`, acao: "Análise temporal", href: link("analise-temporal") });
  if (obra.coberturaPlanner !== null && obra.coberturaPlanner < COBERTURA_PLANNER_ATENCAO) alertas.push({ tipo: "BAIXA_COBERTURA_PLANNER", prioridade: 2, obraId: obra.id, obra: obra.nome, mensagem: `Cobertura do Planner em ${Math.round(obra.coberturaPlanner)}%.`, acao: "Revisar Planner", href: link("analise-temporal") });
  if (obra.projetosPendentes.length) alertas.push({ tipo: "PROJETOS_NAO_SINCRONIZADOS", prioridade: 3, obraId: obra.id, obra: obra.nome, mensagem: `${obra.projetosPendentes.length} projeto(s) detectado(s) ainda não cadastrado(s).`, acao: "Revisar projetos", href: link("projetos") });
  if (!obra.projetosCadastrados) alertas.push({ tipo: "SEM_PROJETO_CADASTRADO", prioridade: 3, obraId: obra.id, obra: obra.nome, mensagem: "Nenhum projeto cadastrado na Ficha.", acao: "Cadastrar projetos", href: link("projetos") });
  if (obra.pendenciasFicha.length) alertas.push({ tipo: "FICHA_INCOMPLETA", prioridade: 4, obraId: obra.id, obra: obra.nome, mensagem: `Ficha Técnica com ${obra.completude}% de completude.`, detalhe: obra.pendenciasFicha.map((p) => p.label).join(", "), acao: "Completar ficha", href: link("identificacao") });
  if (obra.benchmarkPendente) alertas.push({ tipo: "BENCHMARK_PENDENTE", prioridade: 5, obraId: obra.id, obra: obra.nome, mensagem: "Benchmark ainda não avaliado.", acao: "Avaliar Benchmark", href: link("benchmark") });
  return alertas;
}
function calcularQualidadeDados(atividades, obras, idsPlanner) {
  const validas = atividadesUnicas(atividades).map((a) => ({ a, i: intervaloValido(a) }));
  const horas = (f) => validas.filter((x) => x.i && f(x.a)).reduce((s, x) => s + x.i.minutos, 0);
  const total = horas(() => true), totalClassificavel = horas((a) => projetoExigeFaseItem(a.projeto));
  const pct = (n, d = total) => d ? n / d * 100 : null;
  const elegiveis = obras.filter((o) => o.benchmarkElegivel);
  return { fase: pct(horas((a) => projetoExigeFaseItem(a.projeto) && String(a.fase || "").trim()), totalClassificavel), totalClassificavel: totalClassificavel / 60, item: pct(horas((a) => projetoExigeFaseItem(a.projeto) && String(a.item || "").trim()), totalClassificavel), planner: pct(horas((a) => projetoExigeFaseItem(a.projeto) && idsPlanner.has(String(a.id))), totalClassificavel), intervalosValidos: pct(validas.filter((x) => x.i).length, validas.length), fichasCaracterizadas: pct(obras.filter((o) => !o.pendenciasFicha.length).length, obras.length), benchmarkAvaliado: pct(elegiveis.filter((o) => !o.benchmarkPendente).length, elegiveis.length) };
}

module.exports = { COBERTURA_PLANNER_ATENCAO, COBERTURA_PLANNER_BOA, DIAS_SEM_MOVIMENTACAO_ATENCAO, atividadesUnicas, calcularCoberturaPlanner, calcularQualidadeDados, calcularUltimaMovimentacao, classificarCoberturaPlanner, compararProjetosDetectadosCadastrados, construirAlertasGestao, diferencaDias, intervaloValido, completudeFicha, obterPendenciasFicha };