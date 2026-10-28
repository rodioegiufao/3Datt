const { parseRequestBody, requireInternalUser, sendJson, supabaseRequest, supabaseRequestTodos } = require("./_auth");
const { enriquecerRegistrosComObras, resolverOuCriarObra } = require("./_obras");
const {
  PLANNER_MODELOS,
  normalizarChavePlanner,
  localizarModeloPlanner
} = require("../atividades/planner-modelos");
const { agregarAtividadesDosItens, configurarPlannerAutomatico } = require("./_planner-sync");
const { horasAtividade, obterClassificacoesAtividade } = require("../atividades/classificacoes");

const CHECKLISTS_TABLE = "planner_checklists";
const ITEMS_TABLE = "planner_checklist_itens";
const RESPONSAVEIS_VALIDOS = ["Geovanna", "Bruno", "Rodrigo", "Hellen", "Rian"];


function requireAdmin(user) {
  if (user?.perfil === "admin") return;
  const error = new Error("Apenas administradores podem criar, editar ou excluir tarefas do Planner.");
  error.statusCode = 403;
  throw error;
}
function texto(valor) { return String(valor ?? "").trim(); }
function listarResponsaveis(valor) {
  if (Array.isArray(valor)) return [...new Set(valor.map(texto).filter(Boolean))];
  const bruto = texto(valor);
  if (!bruto) return [];
  try { const parsed = JSON.parse(bruto); if (Array.isArray(parsed)) return [...new Set(parsed.map(texto).filter(Boolean))]; } catch (_) { /* Compatibilidade com registros antigos. */ }
  return [...new Set(bruto.split(/\s*(?:\||·|,|;)\s*/).map(texto).filter(Boolean))];
}
function serializarResponsaveis(valor) {
  const nomes = listarResponsaveis(valor);
  if (!nomes.length || nomes.some((nome) => !RESPONSAVEIS_VALIDOS.includes(nome))) return "";
  return JSON.stringify(nomes);
}
function nomesCorrespondem(nomeUsuario, responsavel) {
  const usuario = normalizarChavePlanner(nomeUsuario);
  if (!usuario) return false;
  return listarResponsaveis(responsavel).some((nome) => {
    const atribuido = normalizarChavePlanner(nome);
    return atribuido && (usuario === atribuido || usuario.startsWith(`${atribuido} `) || atribuido.startsWith(`${usuario} `));
  });
}
function checklistVisivelParaUsuario(record, user) {
  if (user?.perfil === "admin") return true;
  if (nomesCorrespondem(user?.nome, record?.responsavel)) return true;
  const itens = record?.planner_checklist_itens || record?.itens || [];
  return itens.some((item) => nomesCorrespondem(user?.nome, item.responsavel));
}
function itemEditavelPeloUsuario(item, checklist, user) {
  if (user?.perfil === "admin") return true;
  if (nomesCorrespondem(user?.nome, item?.responsavel)) return true;
  return !texto(item?.responsavel) && nomesCorrespondem(user?.nome, checklist?.responsavel);
}
function formatChecklistText(etapa, estagio) { return `${texto(etapa)} — ${texto(estagio)}`; }
function templateToItems(modelo, checklistId) {
  let ordem = 0;
  return modelo.etapas.flatMap((grupo, ordemEtapa) => grupo.estagios.map((estagio, ordemEstagio) => ({
    checklist_id: checklistId,
    etapa: grupo.etapa.trim(),
    atividade: estagio.trim(),
    texto: formatChecklistText(grupo.etapa, estagio),
    ordem: ordem++,
    ordemEtapa,
    ordemEstagio
  })));
}

function mapItem(record, indices = {}) {
  return {
    id: record.id,
    checklistId: record.checklist_id,
    etapa: texto(record.etapa),
    estagio: texto(record.estagio || record.atividade),
    atividade: texto(record.atividade),
    texto: texto(record.texto),
    ordem: Number(record.ordem) || 0,
    ordemEtapa: indices.ordemEtapa ?? (Number(record.ordem_etapa) || 0),
    ordemEstagio: indices.ordemEstagio ?? (Number(record.ordem_estagio) || 0),
    concluido: Boolean(record.concluido),
    concluidoEm: record.concluido_em || "",
    concluidoPor: record.concluido_por || "",
    concluidoPorNome: record.concluido_por_nome || "",
    dataPrevista: record.data_prevista || "",
    horaPrevista: texto(record.hora_prevista).slice(0, 5),
    responsavel: texto(record.responsavel),
    observacoes: texto(record.observacoes),
    atualizadoEm: record.atualizado_em || "",
    origem: record.origem || "manual",
    atividadeCount: record.atividadeCount || 0,
    minutosRegistrados: record.minutosRegistrados || 0,
    colaboradoresAtividade: record.colaboradores || [],
    ultimaAtividade: record.ultimaAtividade || "",
    atividadesVinculadas: record.atividades || []
  };
}
function mapItems(records, modelo) {
  const ordemEtapas = new Map((modelo?.etapas || []).map((grupo, index) => [normalizarChavePlanner(grupo.etapa), index]));
  const contadores = new Map();
  return (records || []).map((record) => {
    const chave = normalizarChavePlanner(record.etapa);
    const ordemEstagio = contadores.get(chave) || 0;
    contadores.set(chave, ordemEstagio + 1);
    return mapItem(record, { ordemEtapa: ordemEtapas.get(chave) ?? 999, ordemEstagio });
  }).sort((a, b) => a.ordem - b.ordem);
}
function fromDatabaseRecord(record) {
  const modelo = localizarModeloPlanner(record.projeto, record.tipo);
  return {
    id: record.id,
    obraId: record.obra_id || "",
    obraCodigo: record.obraCodigo || "",
    obra: texto(record.obra),
    nomeTarefa: texto(record.nome_tarefa || record.titulo),
    projeto: modelo?.projeto || texto(record.projeto),
    codigoProjeto: texto(record.codigo_projeto) || modelo?.codigoProjeto || "PRJ-GER",
    tipo: modelo?.tipo || texto(record.tipo),
    status: texto(record.status) || "Não iniciado",
    prioridade: ["P0", "P1", "P2", "P3"].includes(record.prioridade) ? record.prioridade : "P1",
    dataInicio: record.data_inicio || "",
    dataConclusao: record.data_conclusao || record.data_prevista || "",
    responsavel: listarResponsaveis(record.responsavel).join(" · "),
    responsaveis: listarResponsaveis(record.responsavel),
    anotacoes: texto(record.anotacoes || record.observacoes),
    bucket: texto(record.bucket) || modelo?.bucket || "Outros",
    itens: mapItems(record.planner_checklist_itens || record.itens || [], modelo),
    criadoPor: record.criado_por || "",
    criadoPorNome: record.criado_por_nome || "",
    criadoEm: record.criado_em || "",
    atualizadoEm: record.atualizado_em || "",
    origem: record.origem || "manual",
    chaveSincronizacao: record.chave_sincronizacao || "",
    configuracaoAutomaticaConcluida: Boolean(record.configuracao_automatica_concluida)
  };
}

function incorporarAtividadesReais(checklists, atividades) {
  const saida = (checklists || []).map((c) => ({ ...c, itens: (c.itens || []).map((i) => ({ ...i, atividadesVinculadas: [...(i.atividadesVinculadas || [])] })) }));
  const vinculadas = new Set(saida.flatMap((c) => c.itens.flatMap((i) => i.atividadesVinculadas.map((a) => String(a.id || "")).filter(Boolean))));
  const localizarProjeto = (atividade) => saida.find((c) => String(c.obraId) === String(atividade.obra_id || atividade.obraId) && normalizarChavePlanner(c.projeto) === normalizarChavePlanner(atividade.projeto));
  const criarProjetoVirtual = (atividade) => {
    const obraId = atividade.obra_id || atividade.obraId || atividade.obra || "sem-obra", projeto = texto(atividade.projeto) || "Sem projeto";
    const existente = saida.find((c) => c.somenteLeitura && String(c.obraId) === String(obraId) && normalizarChavePlanner(c.projeto) === normalizarChavePlanner(projeto));
    if (existente) return existente;
    const virtual = { id: `execucao:${obraId}:${normalizarChavePlanner(projeto)}`, obraId, obra: atividade.obra || "Sem obra", projeto, nomeTarefa: projeto, codigoProjeto: "", origem: "execucao", somenteLeitura: true, itens: [] };
    saida.push(virtual); return virtual;
  };
  const itemNaoVinculado = (checklist, fase = "Atividades não vinculadas") => {
    let item = checklist.itens.find((i) => i.somenteLeitura && i.etapa === fase);
    if (!item) { item = { id: `${checklist.id}:nao-vinculadas:${normalizarChavePlanner(fase)}`, etapa: fase, estagio: "Atividades não vinculadas", atividade: "Atividades não vinculadas", texto: "Atividades não vinculadas", somenteLeitura: true, atividadesVinculadas: [] }; checklist.itens.push(item); }
    return item;
  };
  for (const atividade of atividades || []) {
    if (!atividade?.id || vinculadas.has(String(atividade.id))) continue;
    const checklist = localizarProjeto(atividade) || criarProjetoVirtual(atividade), classificacoes = obterClassificacoesAtividade(atividade);
    if (!classificacoes.length) { itemNaoVinculado(checklist).atividadesVinculadas.push({ ...atividade, minutosRateados: horasAtividade(atividade) * 60 }); continue; }
    for (const classificacao of classificacoes) {
      const item = checklist.itens.find((i) => normalizarChavePlanner(i.etapa) === normalizarChavePlanner(classificacao.fase) && normalizarChavePlanner(i.estagio || i.atividade) === normalizarChavePlanner(classificacao.item));
      const destino = item || itemNaoVinculado(checklist, classificacao.fase || "Atividades não vinculadas");
      destino.atividadesVinculadas.push({ ...atividade, plannerItemId: destino.id, minutosRateados: classificacao.minutosDedicados });
    }
  }
  return saida;
}
// Range pagina apenas a relação raiz; os itens precisam de leitura própria.
async function carregarChecklistsComItens(path, request = supabaseRequestTodos) {
  const rows = await request(CHECKLISTS_TABLE, path);
  const porChecklist = new Map(rows.map((row) => [String(row.id), []]));
  for (let start = 0; start < rows.length; start += 75) {
    const ids = rows.slice(start, start + 75).map((row) => encodeURIComponent(row.id));
    const itens = await request(ITEMS_TABLE, `?checklist_id=in.(${ids.join(",")})&select=*&order=ordem.asc,id.asc`);
    for (const item of itens) porChecklist.get(String(item.checklist_id))?.push(item);
  }
  return rows.map((row) => ({ ...row, planner_checklist_itens: porChecklist.get(String(row.id)) }));
}

function consultaAtividadesReais(user, obraIds, limitarObras = false) {
  const ids = [...obraIds].map(encodeURIComponent);
  if (limitarObras && !ids.length) return null;
  const filtros = [];
  if (limitarObras) filtros.push(`obra_id=in.(${ids.join(",")})`);
  if (user?.perfil !== "admin") {
    const propria = `usuario_id.eq.${encodeURIComponent(user.id)}`;
    filtros.push(ids.length ? `or=(obra_id.in.(${ids.join(",")}),${propria})` : `usuario_id=eq.${encodeURIComponent(user.id)}`);
  }
  return `?select=*,atividade_classificacoes(*)&order=id.asc${filtros.length ? `&${filtros.join("&")}` : ""}`;
}
async function migrarChecklist(record) {
  const modelo = localizarModeloPlanner(record.projeto, record.tipo);
  if (!modelo) return record;
  const patch = {};
  if (texto(record.projeto) !== modelo.projeto) patch.projeto = modelo.projeto;
  if (texto(record.tipo) !== modelo.tipo) patch.tipo = modelo.tipo;
  if (!texto(record.codigo_projeto)) patch.codigo_projeto = modelo.codigoProjeto;
  if (!texto(record.bucket)) patch.bucket = modelo.bucket || "Outros";
  if (Object.keys(patch).length) {
    patch.atualizado_em = new Date().toISOString();
    const rows = await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(record.id)}`, { method: "PATCH", body: JSON.stringify(patch) });
    Object.assign(record, rows?.[0] || patch);
  }
  if (!(record.planner_checklist_itens || []).length) {
    record.planner_checklist_itens = await supabaseRequest(ITEMS_TABLE, "", {
      method: "POST",
      body: JSON.stringify(templateToItems(modelo, record.id).map(({ ordemEtapa, ordemEstagio, ...item }) => item))
    });
  }
  return record;
}
module.exports = async function plannerChecklistHandler(req, res) {
  try {
    const user = await requireInternalUser(req);

    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const analiseTemporal = url.searchParams.get("analiseTemporal") === "1";
      const obraId = texto(url.searchParams.get("obraId"));
      const checklistId = texto(url.searchParams.get("checklistId"));
      if (analiseTemporal) requireAdmin(user);
      const filtroObra = obraId ? `obra_id=eq.${encodeURIComponent(obraId)}&` : "";
      const filtroChecklist = checklistId ? `id=eq.${encodeURIComponent(checklistId)}&` : "";
       const rows = await carregarChecklistsComItens(`?${filtroObra}${filtroChecklist}select=*&order=criado_em.desc,id.asc`);
      const migrated = await Promise.all((Array.isArray(rows) ? rows : []).map(migrarChecklist));
      const visiveis = migrated.filter((record) => checklistVisivelParaUsuario(record, user));
      const enriched = await enriquecerRegistrosComObras(visiveis);
      const metadados = await agregarAtividadesDosItens(enriched.map((item) => item.id));
      enriched.forEach((checklist) => (checklist.planner_checklist_itens || []).forEach((item) => Object.assign(item, metadados.get(item.id) || {})));
      let checklists = enriched.map(fromDatabaseRecord);
      const obraIds = new Set([obraId, ...checklists.map((c) => c.obraId)].filter(Boolean).map(String));
      // A execução real é uma fonte do Planner, inclusive quando ainda não há
      // checklist para o projeto. Colaboradores recebem as obras às quais já
      // têm acesso no Planner e as próprias atividades; administradores podem
      // montar também projetos virtuais de obras que ainda não têm checklist.
      const consulta = consultaAtividadesReais(user, obraIds, Boolean(obraId || checklistId));
      const atividadesRows = consulta ? await supabaseRequestTodos("atividades_colaboradores", consulta) : [];
      const atividadesVisiveis = (Array.isArray(atividadesRows) ? atividadesRows : []).filter((atividade) =>
        user?.perfil === "admin"
        || obraIds.has(String(atividade.obra_id || ""))
        || String(atividade.usuario_id || "") === String(user?.id || "")
      );
      checklists = incorporarAtividadesReais(checklists, atividadesVisiveis);
      return sendJson(res, 200, { modelos: PLANNER_MODELOS, checklists });
    }

    if (req.method === "POST") {
      requireAdmin(user);
      const body = parseRequestBody(req);
      if (!texto(body.obra) || !texto(body.projeto) || !texto(body.tipo)) return sendJson(res, 400, { mensagem: "Nome da obra, projeto e tipo são obrigatórios." });
      const modelo = localizarModeloPlanner(body.projeto, body.tipo);
      if (!modelo) return sendJson(res, 422, { mensagem: "Projeto + Tipo não corresponde a um modelo do Planner." });
      const responsaveis = serializarResponsaveis(body.responsaveis ?? body.responsavel);
      if (!responsaveis) return sendJson(res, 422, { mensagem: "Selecione pelo menos um responsável válido." });
      const agora = new Date().toISOString();
      const obra = await resolverOuCriarObra({ obraId: body.obraId, nomeObra: body.obra, usuarioId: user.id, origemCriacao: "planner" });
      const checklistRows = await supabaseRequest(CHECKLISTS_TABLE, "", { method: "POST", body: JSON.stringify({
        obra_id: obra.id, obra: obra.nome, nome_tarefa: texto(body.nomeTarefa) || `${modelo.projeto} — ${modelo.tipo}`,
        projeto: modelo.projeto, tipo: modelo.tipo, codigo_projeto: modelo.codigoProjeto,
        status: texto(body.status) || "Não iniciado", prioridade: ["P0", "P1", "P2", "P3"].includes(body.prioridade) ? body.prioridade : "P1",
        data_inicio: body.dataInicio || null, data_conclusao: body.dataConclusao || null,
        bucket: texto(body.bucket) || modelo.bucket || "Outros", responsavel: responsaveis,
        anotacoes: texto(body.anotacoes) || null, criado_por: user.id, criado_por_nome: user.nome, atualizado_em: agora
      }) });
      const checklist = checklistRows[0];
      const dbItems = templateToItems(modelo, checklist.id).map(({ ordemEtapa, ordemEstagio, ...item }) => item);
      const itemRows = await supabaseRequest(ITEMS_TABLE, "", { method: "POST", body: JSON.stringify(dbItems) });
      return sendJson(res, 201, fromDatabaseRecord({ ...checklist, obraCodigo: obra.codigo, planner_checklist_itens: itemRows }));
    }

    if (req.method === "PATCH" || req.method === "PUT") {
      const body = parseRequestBody(req);
      if (body.acao === "configurarAutomatico") return sendJson(res, 200, await configurarPlannerAutomatico({ ...body, user }));
      const acaoItem = body.acao || (Object.prototype.hasOwnProperty.call(body, "concluido") ? "alterarConclusaoItens" : "");
      if (acaoItem === "atualizarDetalhesItem") {
        if (!body.checklistId || !body.itemId) return sendJson(res, 400, { mensagem: "Informe o checklist e o estágio." });
        const checklists = await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(body.checklistId)}&select=id,responsavel`);
        const checklist = checklists?.[0];
        if (!checklist) return sendJson(res, 404, { mensagem: "Tarefa não encontrada." });
        if (user?.perfil !== "admin" && !nomesCorrespondem(user?.nome, checklist.responsavel)) {
          return sendJson(res, 403, { mensagem: "Apenas os colaboradores responsáveis pela tarefa podem planejar este estágio." });
        }
        const existing = await supabaseRequest(ITEMS_TABLE, `?id=eq.${encodeURIComponent(body.itemId)}&checklist_id=eq.${encodeURIComponent(body.checklistId)}&select=id,responsavel`);
        if (!existing?.length) return sendJson(res, 422, { mensagem: "O estágio não pertence à tarefa informada." });
        const data = texto(body.dataPrevista), hora = texto(body.horaPrevista), responsavel = texto(body.responsavel), observacoes = texto(body.observacoes);
        if (data && !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(data)) return sendJson(res, 422, { mensagem: "Data prevista inválida. Use YYYY-MM-DD." });
        if (hora && !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(hora)) return sendJson(res, 422, { mensagem: "Horário previsto inválido. Use HH:mm." });
        if (hora && !data) return sendJson(res, 422, { mensagem: "Para informar um horário, selecione também a data prevista." });
        if (observacoes.length > 5000) return sendJson(res, 422, { mensagem: "As observações devem possuir no máximo 5.000 caracteres." });
        if (responsavel && !["Geovanna", "Bruno", "Rodrigo", "Hellen", "Rian"].includes(responsavel)) return sendJson(res, 422, { mensagem: "Responsável inválido." });
        if (responsavel && !listarResponsaveis(checklist.responsavel).includes(responsavel)) return sendJson(res, 422, { mensagem: "O responsável pelo estágio deve estar entre os responsáveis da tarefa." });
        const patchItem = { data_prevista: data || null, hora_prevista: hora || null, observacoes: observacoes || null, atualizado_em: new Date().toISOString() };
        if (user?.perfil === "admin") patchItem.responsavel = responsavel || null;
        const rows = await supabaseRequest(ITEMS_TABLE, `?id=eq.${encodeURIComponent(body.itemId)}&checklist_id=eq.${encodeURIComponent(body.checklistId)}`, { method: "PATCH", body: JSON.stringify(patchItem) });
        return sendJson(res, 200, { item: mapItem(rows[0] || {}) });
      }
      if (acaoItem === "alterarConclusaoItens" && (body.itemId || Array.isArray(body.itemIds))) {
        const itemIds = [...new Set((body.itemIds || [body.itemId]).filter(Boolean).map(String))];
        if (!itemIds.length || !body.checklistId) return sendJson(res, 400, { mensagem: "Informe o checklist e os itens." });
        const checklists = await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(body.checklistId)}&select=id,responsavel`);
        const checklist = checklists?.[0];
        if (!checklist) return sendJson(res, 404, { mensagem: "Tarefa não encontrada." });
        const existing = await supabaseRequestTodos(ITEMS_TABLE, `?checklist_id=eq.${encodeURIComponent(body.checklistId)}&id=in.(${itemIds.map(encodeURIComponent).join(",")})&select=id,responsavel`);
        if (!Array.isArray(existing) || existing.length !== itemIds.length) return sendJson(res, 422, { mensagem: "Um ou mais itens não pertencem à tarefa informada." });
        if (!existing.every((item) => itemEditavelPeloUsuario(item, checklist, user))) {
          return sendJson(res, 403, { mensagem: "Você só pode marcar os estágios atribuídos a você." });
        }
        const concluido = Boolean(body.concluido);
        const filter = `?id=in.(${itemIds.map(encodeURIComponent).join(",")})`;
        const rows = await supabaseRequest(ITEMS_TABLE, filter, { method: "PATCH", body: JSON.stringify({ concluido, concluido_em: concluido ? new Date().toISOString() : null, concluido_por: concluido ? user.id : null, concluido_por_nome: concluido ? user.nome : null, atualizado_em: new Date().toISOString() }) });
        return sendJson(res, 200, { item: mapItem(rows[0] || {}), itens: (rows || []).map(mapItem) });
      }
      requireAdmin(user);
      if (!body.id) return sendJson(res, 400, { mensagem: "Informe o ID da tarefa." });
      const patch = {};
      if (Object.prototype.hasOwnProperty.call(body, "obraId") || Object.prototype.hasOwnProperty.call(body, "obra")) {
        const obra = await resolverOuCriarObra({ obraId: body.obraId, nomeObra: body.obra, usuarioId: user.id });
        patch.obra_id = obra.id; patch.obra = obra.nome;
      }
      [["nomeTarefa", "nome_tarefa"], ["status", "status"], ["prioridade", "prioridade"], ["dataInicio", "data_inicio"], ["dataConclusao", "data_conclusao"], ["bucket", "bucket"], ["anotacoes", "anotacoes"]].forEach(([from, to]) => {
        if (Object.prototype.hasOwnProperty.call(body, from)) patch[to] = texto(body[from]) || null;
      });
      if (Object.prototype.hasOwnProperty.call(body, "responsaveis") || Object.prototype.hasOwnProperty.call(body, "responsavel")) {
        const responsaveis = serializarResponsaveis(body.responsaveis ?? body.responsavel);
        if (!responsaveis) return sendJson(res, 422, { mensagem: "Selecione pelo menos um responsável válido." });
        patch.responsavel = responsaveis;
      }
      patch.atualizado_em = new Date().toISOString();
      const rows = await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(body.id)}&select=*,planner_checklist_itens(*)`, { method: "PATCH", body: JSON.stringify(patch) });
      if (!rows?.length) return sendJson(res, 404, { mensagem: "Tarefa não encontrada." });
      return sendJson(res, 200, fromDatabaseRecord(rows[0]));
    }
    if (req.method === "DELETE") {
      requireAdmin(user);
      const id = new URL(req.url, "http://localhost").searchParams.get("id") || parseRequestBody(req).id;
      if (!id) return sendJson(res, 400, { mensagem: "Informe o ID da tarefa." });
      const existing = await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(id)}&select=id`);
      if (!existing?.length) return sendJson(res, 404, { mensagem: "Tarefa não encontrada." });
      await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 405, { mensagem: "Método não suportado." }, { Allow: "GET, POST, PATCH, DELETE" });
  } catch (error) {
    console.error("Erro na API do Planner:", error);
    sendJson(res, error.statusCode || 500, { mensagem: error.message || "Erro interno ao processar o Planner." });
  }
};
module.exports._test = { incorporarAtividadesReais, requireAdmin, carregarChecklistsComItens, consultaAtividadesReais };