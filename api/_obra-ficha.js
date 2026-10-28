const CATEGORIAS = ["empreendimento", "interno", "estudo", "outro"];
const NATUREZAS = ["publico", "privado", "misto", "nao_informado"];
const BENCHMARKS = ["nao_avaliado", "incluir", "excluir"];
const INTERVENCOES = ["Obra nova", "Reforma", "Ampliação", "Retrofit", "Adequação", "Regularização", "As built", "Outro"];
const MOTIVOS = ["atividade_interna", "dados_incompletos", "projeto_excepcional", "escopo_nao_comparavel", "projeto_cancelado", "outro"];

function texto(valor) { return String(valor ?? "").trim(); }
function exigirAdmin(user) { if (user?.perfil !== "admin") throw Object.assign(new Error("Apenas administradores podem acessar fichas técnicas de obras."), { statusCode: 403 }); }
function numeroOpcional(valor, inteiro = false) {
  if (valor === "" || valor === null || valor === undefined) return null;
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero < 0 || (inteiro && !Number.isInteger(numero))) throw Object.assign(new Error("Valores físicos devem ser números não negativos; pavimentos e blocos devem ser inteiros."), { statusCode: 422 });
  return numero;
}
function chaveProjeto(valor) { return texto(valor).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function statusFicha(caracteristica, tipologias = [], intervencoes = []) {
  if (!caracteristica) return "cadastro_minimo";
  if (caracteristica.caracterizacao_nao_aplicavel) return "nao_aplicavel";
  const principal = tipologias.find((item) => item.principal);
  if (caracteristica.categoria_registro === "empreendimento" && caracteristica.natureza && principal?.segmento && principal?.tipologia && intervencoes.length) return "caracterizada";
  return "parcial";
}
function criteriosFicha(caracteristica, tipologias = [], intervencoes = [], projetos = []) {
  if (caracteristica?.caracterizacao_nao_aplicavel) return [];
  const principal = tipologias.find((item) => item.principal);
  const tem = (valor) => valor !== null && valor !== undefined && valor !== "";
  return [
    ["categoria_registro", "Classificação", caracteristica?.categoria_registro], ["natureza", "Natureza", caracteristica?.natureza],
    ["segmento", "Segmento", principal?.segmento], ["tipologia", "Tipologia", principal?.tipologia],
    ["intervencoes", "Intervenção", intervencoes.length], ["area_intervencao", "Área de intervenção", tem(caracteristica?.area_intervencao)],
    ["pavimentos", "Pavimentos", tem(caracteristica?.pavimentos_acima)], ["projetos", "Projetos da Obra", projetos.length],
    ["benchmark", "Benchmark", caracteristica?.benchmark_status && caracteristica.benchmark_status !== "nao_avaliado"], ["observacoes", "Observações", caracteristica?.observacoes]
  ].map(([campo, label, preenchido]) => ({ campo, label, preenchido: Boolean(preenchido) }));
}
function obterPendenciasFicha(caracteristica, tipologias = [], intervencoes = [], projetos = []) {
  return criteriosFicha(caracteristica, tipologias, intervencoes, projetos).filter((item) => !item.preenchido).map(({ campo, label }) => ({ campo, label }));
}
function completudeFicha(caracteristica, tipologias = [], intervencoes = [], projetos = []) {
  if (!caracteristica) return 0;
  if (caracteristica.caracterizacao_nao_aplicavel) return 100;
  const itens = criteriosFicha(caracteristica, tipologias, intervencoes, projetos);
  return Math.round(itens.filter((item) => item.preenchido).length / itens.length * 100);
}
function validarFicha(body) {
  const categoria = texto(body.categoriaRegistro);
  const natureza = texto(body.natureza);
  const benchmark = texto(body.benchmarkStatus) || "nao_avaliado";
  if (categoria && !CATEGORIAS.includes(categoria)) throw Object.assign(new Error("Categoria inválida."), { statusCode: 422 });
  if (natureza && !NATUREZAS.includes(natureza)) throw Object.assign(new Error("Natureza inválida."), { statusCode: 422 });
  if (!BENCHMARKS.includes(benchmark)) throw Object.assign(new Error("Situação de benchmark inválida."), { statusCode: 422 });
  if (body.caracterizacaoNaoAplicavel && benchmark === "incluir") throw Object.assign(new Error("Uma caracterização não aplicável não pode integrar o Benchmark físico."), { statusCode: 422 });
  const motivo = texto(body.benchmarkMotivo);
  if (benchmark === "excluir" && !MOTIVOS.includes(motivo)) throw Object.assign(new Error("Informe o motivo da exclusão do Benchmark."), { statusCode: 422 });
  if (benchmark === "excluir" && motivo === "outro" && !texto(body.benchmarkMotivoOutro)) throw Object.assign(new Error("Descreva o outro motivo da exclusão."), { statusCode: 422 });
  const intervencoes = [...new Set((body.intervencoes || []).map(texto).filter(Boolean))];
  if (intervencoes.some((item) => !INTERVENCOES.includes(item))) throw Object.assign(new Error("Intervenção inválida."), { statusCode: 422 });
  const tipologias = (body.tipologias || []).filter((item) => texto(item.tipologia)).map((item) => ({ segmento: texto(item.segmento), tipologia: texto(item.tipologia), principal: Boolean(item.principal) }));
  if (tipologias.filter((item) => item.principal).length > 1) throw Object.assign(new Error("A obra pode possuir apenas uma tipologia principal."), { statusCode: 422 });
  const projetosMap = new Map();
  for (const item of body.projetos || []) { const projeto = texto(item.projeto); const chave = chaveProjeto(item.projetoChave || item.codigoProjeto || projeto); if (projeto && chave) projetosMap.set(chave, { ...item, projeto, projetoChave: chave, areaIntervencao: numeroOpcional(item.areaIntervencao), areaExterna: numeroOpcional(item.areaExterna), areaCobertura: numeroOpcional(item.areaCobertura), pavimentosAtendidos: numeroOpcional(item.pavimentosAtendidos, true) }); }
  return {
    caracteristica: { categoria_registro: categoria || null, natureza: natureza || null, caracterizacao_nao_aplicavel: Boolean(body.caracterizacaoNaoAplicavel), area_total_construida: numeroOpcional(body.areaTotalConstruida), area_intervencao: numeroOpcional(body.areaIntervencao), area_externa_intervencao: numeroOpcional(body.areaExternaIntervencao), area_cobertura: numeroOpcional(body.areaCobertura), pavimentos_acima: numeroOpcional(body.pavimentosAcima, true), subsolos: numeroOpcional(body.subsolos, true), numero_blocos: numeroOpcional(body.numeroBlocos, true), benchmark_status: benchmark, benchmark_motivo: benchmark === "excluir" ? motivo : null, benchmark_motivo_outro: benchmark === "excluir" && motivo === "outro" ? texto(body.benchmarkMotivoOutro) : null, observacoes: texto(body.observacoes) || null },
    tipologias, intervencoes, projetos: [...projetosMap.values()]
  };
}

module.exports = { BENCHMARKS, CATEGORIAS, INTERVENCOES, MOTIVOS, NATUREZAS, chaveProjeto, completudeFicha, criteriosFicha, exigirAdmin, numeroOpcional, obterPendenciasFicha, statusFicha, validarFicha };