const { requireUser, sendJson, supabaseRequestTodos } = require("./_auth");
const { listarObras } = require("./_obras");
const { exigirAdmin } = require("./_obra-ficha");
const G = require("./_gestao");

function noPeriodo(a, inicio, fim) {
  const data = a.data_termino || a.data_inicio;
  return (!inicio || data >= inicio) && (!fim || (a.data_inicio || data) <= fim);
}
function arredondar(valor) { return valor === null ? null : Number(valor.toFixed(1)); }

module.exports = async function gestaoAdminHandler(req, res) {
  try {
    const user = await requireUser(req); exigirAdmin(user);
    if (req.method !== "GET") return sendJson(res, 405, { error: "Método não suportado." }, { Allow: "GET" });
    const url = new URL(req.url, "http://localhost"), inicio = url.searchParams.get("inicio") || "", fim = url.searchParams.get("fim") || "";
    const obras = await listarObras({ somenteAtivas: false }), ids = obras.map((o) => o.id);
    const filtro = ids.length ? `?obra_id=in.(${ids.map(encodeURIComponent).join(",")})&select=*` : "?select=*";
    const [caracteristicas, tipologias, intervencoes, projetos, atividades, checklists, vinculos] = await Promise.all([
      supabaseRequestTodos("obra_caracteristicas", `${filtro}&order=obra_id.asc`), supabaseRequestTodos("obra_tipologias", filtro), supabaseRequestTodos("obra_intervencoes", filtro),
      supabaseRequestTodos("obra_projetos", filtro), supabaseRequestTodos("atividades_colaboradores", filtro),
      supabaseRequestTodos("planner_checklists", ids.length ? `?obra_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,obra_id,projeto,codigo_projeto` : "?select=id,obra_id,projeto,codigo_projeto"),
      supabaseRequestTodos("atividade_planner_itens", "?select=atividade_id,item_id&order=atividade_id.asc,item_id.asc")
    ]);
    const idsPlanner = new Set((vinculos || []).map((v) => String(v.atividade_id)));
    const atividadesPeriodo = (atividades || []).filter((a) => noPeriodo(a, inicio, fim));
    const hoje = url.searchParams.get("hoje") || new Date().toISOString().slice(0, 10);
    const resultadoObras = obras.map((obra) => {
      const c = caracteristicas.find((x) => x.obra_id === obra.id) || null, ts = tipologias.filter((x) => x.obra_id === obra.id), ints = intervencoes.filter((x) => x.obra_id === obra.id), ps = projetos.filter((x) => x.obra_id === obra.id);
      const todas = atividades.filter((x) => x.obra_id === obra.id), periodo = atividadesPeriodo.filter((x) => x.obra_id === obra.id);
      const detectados = [...todas, ...checklists.filter((x) => x.obra_id === obra.id)];
      const comparacao = G.compararProjetosDetectadosCadastrados(detectados, ps), cobertura = G.calcularCoberturaPlanner(periodo, idsPlanner), ultima = G.calcularUltimaMovimentacao(todas);
      const pendencias = G.obterPendenciasFicha(c, ts, ints, ps), benchmarkElegivel = c?.categoria_registro !== "interno" && !c?.caracterizacao_nao_aplicavel;
      return { ...obra, completude: G.completudeFicha(c, ts, ints, ps), pendenciasFicha: pendencias, ultimaMovimentacao: ultima, diasSemMovimentacao: G.diferencaDias(ultima, hoje), horasRegistradas: arredondar(cobertura.horasTotais), horasPlanner: arredondar(cobertura.horasPlanner), coberturaPlanner: arredondar(cobertura.cobertura), classificacaoCobertura: G.classificarCoberturaPlanner(cobertura.cobertura), projetosDetectados: comparacao.detectados, projetosCadastrados: comparacao.cadastrados, projetosPendentes: comparacao.pendentes, projetosMovimentados: new Set(periodo.map((a) => a.projeto).filter(Boolean)).size, benchmarkStatus: c?.benchmark_status || "nao_avaliado", benchmarkElegivel, benchmarkPendente: benchmarkElegivel && (!c?.benchmark_status || c.benchmark_status === "nao_avaliado") };
    });
    const ativas = resultadoObras.filter((o) => o.ativo), alertas = ativas.flatMap(G.construirAlertasGestao).sort((a, b) => a.prioridade - b.prioridade || a.obra.localeCompare(b.obra));
    const somaHoras = ativas.reduce((s, o) => s + o.horasRegistradas, 0), somaPlanner = ativas.reduce((s, o) => s + o.horasPlanner, 0);
    const resumo = { obrasAtivas: ativas.length, projetosMovimentados: new Set(atividadesPeriodo.filter((a) => ativas.some((o) => o.id === a.obra_id)).map((a) => `${a.obra_id}:${a.projeto}`).filter((x) => !x.endsWith(":"))).size, obrasSemMovimentacao: ativas.filter((o) => o.diasSemMovimentacao >= G.DIAS_SEM_MOVIMENTACAO_ATENCAO).length, fichasPendentes: ativas.filter((o) => o.pendenciasFicha.length).length, projetosNaoSincronizados: ativas.reduce((s, o) => s + o.projetosPendentes.length, 0), benchmarkPendente: ativas.filter((o) => o.benchmarkPendente).length, horasRegistradas: arredondar(somaHoras), coberturaPlannerMedia: somaHoras ? arredondar(somaPlanner / somaHoras * 100) : null };
    const qualidade = G.calcularQualidadeDados(atividadesPeriodo, ativas, idsPlanner); Object.keys(qualidade).forEach((k) => { qualidade[k] = arredondar(qualidade[k]); });
    return sendJson(res, 200, { periodo: { inicio, fim }, resumo, qualidade, atencao: alertas, obras: resultadoObras });
  } catch (error) { console.error("Erro na Central de Gestão:", error); return sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Erro interno ao calcular indicadores de gestão." }); }
};

module.exports._test = { noPeriodo };