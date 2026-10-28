const { parseRequestBody, requireUser, sendJson, supabaseRequest, supabaseRequestTodos } = require("./_auth");
const { localizarObraPorId } = require("./_obras");
const { chaveProjeto } = require("./_obra-ficha");
const { analisarObra, carregarDadosObra, proximaRevisao, validarUrl } = require("./_relatorio-obra");

function exigirAdmin(user) { if (user?.perfil !== "admin") throw Object.assign(new Error("Apenas administradores podem salvar entregas de obras."), { statusCode: 403 }); }
function texto(v) { return String(v ?? "").trim(); }
function validarData(v, campo = "data de entrega") { const valor = texto(v), instante = new Date(`${valor}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(valor) || Number.isNaN(instante.getTime()) || instante.toISOString().slice(0, 10) !== valor) throw Object.assign(new Error(`Informe uma ${campo} válida.`), { statusCode: 422 }); return valor; }
function validarEmissao(v) { const tipo = texto(v).toLowerCase().replace("ã", "a"); if (!["entrega_inicial", "revisao"].includes(tipo)) throw Object.assign(new Error("Tipo de emissão inválido."), { statusCode: 422 }); return tipo; }
function validarRevisao(v, obrigatoria = true) { const revisao = texto(v).toUpperCase(); if (obrigatoria && !revisao) throw Object.assign(new Error("Informe a revisão geral."), { statusCode: 422 }); return revisao; }
function serializarAnalise(a) { return { obra: a.obra, periodo: a.periodoEntrega, periodoEntrega: a.periodoEntrega, periodoHistorico: a.periodoHistorico, resumo: a.resumo, disciplinas: a.disciplinas.map(({ registros, ...d }) => d), atividades: a.atividades.map((x) => ({ id: x.id, dataInicio: x.dataInicio, dataTermino: x.dataTermino, colaborador: x.colaborador, projeto: x.projeto, trabalhos: x.trabalhos, status: x.status, horas: Number(require("../atividades/classificacoes").horasAtividade(x)), classificacoes: x.classificacoes })), pendencias: a.pendencias, historico: a.entregas, proximaRevisao: proximaRevisao(a.entregas) }; }
function entradaProjeto(p, disciplina, entrega, obraId) { return { entrega_id: entrega.id, obra_id: obraId, projeto: disciplina.projeto, projeto_chave: disciplina.projetoChave, codigo_projeto: disciplina.codigoProjeto || null, tipo_emissao: texto(p?.tipoEmissao || p?.tipo_emissao || entrega.tipo_emissao), revisao: validarRevisao(p?.revisao || entrega.revisao), link_projeto: p?.linkProjeto || p?.link_projeto ? validarUrl(p.linkProjeto || p.link_projeto) : null, observacoes: texto(p?.observacoes) || null, horas: disciplina.horas, atividades: disciplina.atividades, periodo_inicio: disciplina.periodo.inicio || null, periodo_fim: disciplina.periodo.fim || null, responsaveis_json: disciplina.responsaveis } }

module.exports = async function obraEntregasHandler(req, res) {
  try {
    const user = await requireUser(req); exigirAdmin(user);
    if (req.method === "GET") {
      const obraId = texto(req.query?.obraId); const entregaId = texto(req.query?.entregaId);
      const dados = await carregarDadosObra(obraId, supabaseRequestTodos, localizarObraPorId, entregaId);
      let periodoInicio = texto(req.query?.periodoInicio), periodoFim = texto(req.query?.periodoFim);
      if (periodoInicio) periodoInicio = validarData(periodoInicio, "data inicial"); if (periodoFim) periodoFim = validarData(periodoFim, "data final");
      if (periodoInicio && periodoFim && periodoInicio > periodoFim) throw Object.assign(new Error("O início do período não pode ser posterior ao fim."), { statusCode: 422 });
      if (dados.entrega && !periodoInicio && !periodoFim) { periodoInicio = dados.entrega.periodo_inicio || ""; periodoFim = dados.entrega.periodo_fim || ""; }
      const analise = analisarObra({ ...dados, periodoInicio, periodoFim });
      return sendJson(res, 200, { ...serializarAnalise(analise), entrega: dados.entrega ? { ...dados.entrega, projetos: dados.projetosEntrega } : null });
    }
    if (req.method === "DELETE") {
      const body = parseRequestBody(req); const obraId = texto(body.obraId); const entregaId = texto(body.entregaId);
      if (!obraId || !entregaId) throw Object.assign(new Error("Informe a obra e a revisão que será apagada."), { statusCode: 422 });
      const removidas = await supabaseRequest("obra_entregas", `?id=eq.${encodeURIComponent(entregaId)}&obra_id=eq.${encodeURIComponent(obraId)}`, { method: "DELETE" });
      if (!removidas?.length) throw Object.assign(new Error("Revisão não encontrada para a obra informada."), { statusCode: 404 });
      return sendJson(res, 200, { mensagem: "Revisão apagada com sucesso." });
    }
    if (!["POST", "PATCH"].includes(req.method)) return sendJson(res, 405, { error: "Método não suportado." }, { Allow: "GET, POST, PATCH, DELETE" });
    const body = parseRequestBody(req); const obraId = texto(body.obraId); const existenteId = req.method === "PATCH" ? texto(body.entregaId) : "";
    const periodoInicio = validarData(body.periodoInicio, "data inicial"), periodoFim = validarData(body.periodoFim, "data final");
    if (periodoInicio > periodoFim) throw Object.assign(new Error("O início do período não pode ser posterior ao fim."), { statusCode: 422 });
    const dados = await carregarDadosObra(obraId, supabaseRequestTodos, localizarObraPorId, existenteId); const analise = analisarObra({ ...dados, periodoInicio, periodoFim });
    const tipo = validarEmissao(body.tipoEmissao), revisao = validarRevisao(body.revisao, tipo === "revisao"); const agora = new Date().toISOString();
    const registro = { obra_id: dados.obra.id, tipo_emissao: tipo, revisao: revisao || "REV00", data_entrega: validarData(body.dataEntrega), link_processo: validarUrl(body.linkProcesso, true), observacoes: texto(body.observacoes) || null, periodo_inicio: periodoInicio, periodo_fim: periodoFim, resumo_json: analise.resumo, atualizado_em: agora };
    let entrega;
    if (existenteId) { const rows = await supabaseRequest("obra_entregas", `?id=eq.${encodeURIComponent(existenteId)}&obra_id=eq.${encodeURIComponent(obraId)}`, { method: "PATCH", body: JSON.stringify(registro) }); entrega = rows?.[0]; }
    else { const rows = await supabaseRequest("obra_entregas", "", { method: "POST", body: JSON.stringify({ ...registro, criado_por: user.id, criado_em: agora }) }); entrega = rows?.[0]; }
    if (!entrega) throw Object.assign(new Error("Não foi possível salvar a entrega."), { statusCode: 500 });
    await supabaseRequest("obra_entrega_projetos", `?entrega_id=eq.${encodeURIComponent(entrega.id)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
    const configs = new Map((Array.isArray(body.projetos) ? body.projetos : []).map((p) => [p.projetoChave || p.projeto_chave || chaveProjeto(p.projeto), p]));
    const projetos = analise.disciplinas.map((d) => entradaProjeto(configs.get(d.projetoChave), d, entrega, obraId));
    if (projetos.length) await supabaseRequest("obra_entrega_projetos", "", { method: "POST", body: JSON.stringify(projetos) });
    return sendJson(res, existenteId ? 200 : 201, { entrega: { ...entrega, projetos }, analise: serializarAnalise(analise) });
  } catch (error) { console.error("Erro na API de entregas de obras:", error); return sendJson(res, error.statusCode || 500, { error: error.message || "Erro interno ao processar a entrega." }); }
};

module.exports._test = { validarData, validarEmissao, validarRevisao };