const { parseRequestBody, requireUser, sendJson, supabaseRequest, supabaseRequestTodos } = require("./_auth");
const { listarObras, localizarObraPorId, resolverOuCriarObra } = require("./_obras");
const { chaveProjeto, completudeFicha, exigirAdmin, obterPendenciasFicha, statusFicha, validarFicha } = require("./_obra-ficha");

function idsFiltro(ids) { return ids.map((id) => encodeURIComponent(id)).join(","); }
async function carregarRelacionados(obras) {
  const ids = obras.map((obra) => obra.id);
  if (!ids.length) return { caracteristicas: [], tipologias: [], intervencoes: [], projetos: [], atividades: [], planner: [] };
  const filtro = `?obra_id=in.(${idsFiltro(ids)})`;
  const [caracteristicas, tipologias, intervencoes, projetos, atividades, planner] = await Promise.all([
    supabaseRequestTodos("obra_caracteristicas", `${filtro}&select=*&order=obra_id.asc`), supabaseRequestTodos("obra_tipologias", `${filtro}&select=*`),
    supabaseRequestTodos("obra_intervencoes", `${filtro}&select=*`), supabaseRequestTodos("obra_projetos", `${filtro}&select=*`),
    supabaseRequestTodos("atividades_colaboradores", `${filtro}&select=obra_id,projeto`), supabaseRequestTodos("planner_checklists", `${filtro}&select=obra_id,projeto,codigo_projeto`)
  ]);
  return { caracteristicas, tipologias, intervencoes, projetos, atividades, planner };
}
function montarObra(obra, dados) {
  const caracteristica = dados.caracteristicas.find((item) => item.obra_id === obra.id) || null;
  const tipologias = dados.tipologias.filter((item) => item.obra_id === obra.id);
  const intervencoes = dados.intervencoes.filter((item) => item.obra_id === obra.id);
  const projetos = dados.projetos.filter((item) => item.obra_id === obra.id);
  const detectados = new Map();
  [...dados.atividades, ...dados.planner].filter((item) => item.obra_id === obra.id && item.projeto).forEach((item) => {
    const chave = chaveProjeto(item.codigo_projeto || item.projeto); detectados.set(chave, { projeto: item.projeto, projetoChave: chave, codigoProjeto: item.codigo_projeto || null });
  });
  const todosProjetos = new Set([...projetos.map((item) => item.projeto_chave), ...detectados.keys()]);
  return { ...obra, caracteristica, tipologias, intervencoes: intervencoes.map((item) => item.intervencao), projetos, projetosDetectados: [...detectados.values()].filter((item) => !projetos.some((projeto) => projeto.projeto_chave === item.projetoChave)), quantidadeProjetos: todosProjetos.size, statusFicha: statusFicha(caracteristica, tipologias, intervencoes), completude: completudeFicha(caracteristica, tipologias, intervencoes, projetos), pendenciasFicha: obterPendenciasFicha(caracteristica, tipologias, intervencoes, projetos) };
}
async function substituir(table, obraId, rows) {
  await supabaseRequest(table, `?obra_id=eq.${encodeURIComponent(obraId)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  if (rows.length) await supabaseRequest(table, "", { method: "POST", body: JSON.stringify(rows) });
}

module.exports = async function obrasAdminHandler(req, res) {
  try {
    const user = await requireUser(req); exigirAdmin(user);
    if (req.method === "GET") {
      const id = String(req.query?.id || "");
      const obras = id ? [await localizarObraPorId(id)].filter(Boolean) : await listarObras({ somenteAtivas: false });
      if (id && !obras.length) return sendJson(res, 404, { error: "Obra não encontrada." });
      const dados = await carregarRelacionados(obras);
      const resultado = obras.map((obra) => montarObra(obra, dados));
      return sendJson(res, 200, id ? resultado[0] : resultado);
    }
    const body = parseRequestBody(req);
    if (req.method === "POST" && body.acao === "criar") {
      const obra = await resolverOuCriarObra({ nomeObra: body.nome, usuarioId: user.id, origemCriacao: "administracao" });
      return sendJson(res, 201, obra);
    }
    if (req.method === "POST" && body.acao === "sincronizarProjetos") {
      const obra = await localizarObraPorId(body.obraId); if (!obra) return sendJson(res, 404, { error: "Obra não encontrada." });
      const dados = await carregarRelacionados([obra]); const ficha = montarObra(obra, dados);
      const novos = ficha.projetosDetectados.map((item) => ({ obra_id: obra.id, projeto: item.projeto, projeto_chave: item.projetoChave, codigo_projeto: item.codigoProjeto, origem: "detectado" }));
      if (novos.length) await supabaseRequest("obra_projetos", "?on_conflict=obra_id,projeto_chave", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(novos) });
      return sendJson(res, 200, { adicionados: novos.length });
    }
    if (req.method === "PUT") {
      const obra = await localizarObraPorId(body.obraId); if (!obra) return sendJson(res, 404, { error: "Obra não encontrada." });
      const ficha = validarFicha(body); const agora = new Date().toISOString();
      const existente = await supabaseRequest("obra_caracteristicas", `?obra_id=eq.${encodeURIComponent(obra.id)}&select=obra_id,criado_por,criado_em`);
      await supabaseRequest("obra_caracteristicas", "?on_conflict=obra_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify({ ...ficha.caracteristica, obra_id: obra.id, criado_por: existente[0]?.criado_por || user.id, criado_em: existente[0]?.criado_em || agora, atualizado_por: user.id, atualizado_em: agora }) });
      await substituir("obra_tipologias", obra.id, ficha.tipologias.map((item) => ({ obra_id: obra.id, ...item })));
      await substituir("obra_intervencoes", obra.id, ficha.intervencoes.map((intervencao) => ({ obra_id: obra.id, intervencao })));
      await substituir("obra_projetos", obra.id, ficha.projetos.map((item) => ({ obra_id: obra.id, projeto: item.projeto, projeto_chave: item.projetoChave, codigo_projeto: item.codigoProjeto || null, area_intervencao: item.areaIntervencao === "" ? null : item.areaIntervencao ?? null, area_externa: item.areaExterna === "" ? null : item.areaExterna ?? null, area_cobertura: item.areaCobertura === "" ? null : item.areaCobertura ?? null, pavimentos_atendidos: item.pavimentosAtendidos === "" ? null : item.pavimentosAtendidos ?? null, observacoes: item.observacoes || null, origem: item.origem === "detectado" ? "detectado" : "manual", atualizado_em: agora })));
      return sendJson(res, 200, { mensagem: "Ficha técnica atualizada." });
    }
    return sendJson(res, 405, { error: "Método não suportado." }, { Allow: "GET, POST, PUT" });
  } catch (error) {
    console.error("Erro na API administrativa de obras:", error);
    return sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Erro interno ao processar a ficha técnica." });
  }
};