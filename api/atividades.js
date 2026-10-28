const { parseRequestBody, requireInternalUser, sendJson, supabaseRequest, supabaseRequestTodos } = require("./_auth");
const { enriquecerRegistrosComObras, resolverOuCriarObra } = require("./_obras");
const { limparItensOrfaos, normalizarItemPlanner, removerVinculosAtividade, sincronizarAtividadeComPlanner } = require("./_planner-sync");
const { projetoExigeFaseItem, separarItens } = require("../atividades/fase-item");
const { normalizarChavePlanner } = require("../atividades/planner-modelos");
const { duracaoAtividadeMinutos, obterClassificacoesAtividade, validarRateio } = require("../atividades/classificacoes");

const SUPABASE_TABLE = "atividades_colaboradores";
const CLASSIFICACOES_TABLE = "atividade_classificacoes";

const COLABORADORES = ["Rodrigo", "Hellen", "Bruno", "Rian", "Geovanna"];
const CLASSIFICACOES_BATCH_SIZE = 75;

async function carregarClassificacoesEmLotes(ids, request = supabaseRequestTodos) {
  const idsValidos = [...new Set((ids || []).filter(Boolean))];
  const lotes = [];
  for (let inicio = 0; inicio < idsValidos.length; inicio += CLASSIFICACOES_BATCH_SIZE) {
    const lote = idsValidos.slice(inicio, inicio + CLASSIFICACOES_BATCH_SIZE);
    lotes.push(request(
      CLASSIFICACOES_TABLE,
      `?atividade_id=in.(${lote.map(encodeURIComponent).join(",")})&select=*`
    ));
  }
  return (await Promise.all(lotes)).flatMap((resultado) => Array.isArray(resultado) ? resultado : []);
}

function isValidActivityDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validateActivityDates(activity) {
  const dateFields = [
    ["dataPrevista", "data prevista"],
    ["dataInicio", "data de início"],
    ["dataTermino", "data de término"]
  ];

  dateFields.forEach(([field, label]) => {
    if (activity[field] && !isValidActivityDate(activity[field])) {
      const error = new Error(`A ${label} deve ser uma data válida com ano de 4 dígitos.`);
      error.statusCode = 400;
      throw error;
    }
  });

  if (activity.dataInicio && activity.dataTermino && activity.dataTermino < activity.dataInicio) {
    const error = new Error("A data de término deve ser maior ou igual à data de início.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function collaboratorForUser(user) {
  const normalizedName = normalizeText(user?.nome);
  return COLABORADORES.find((collaborator) => {
    const normalizedCollaborator = normalizeText(collaborator);
    return normalizedName === normalizedCollaborator
      || normalizedName.startsWith(`${normalizedCollaborator} `)
      || normalizedName.includes(normalizedCollaborator);
  }) || user?.nome || "";
}

function enforceCollaboratorPermission(record, user) {
  if (user.perfil === "admin") return;

  const allowedCollaborator = collaboratorForUser(user);
  if (record.colaborador && record.colaborador !== allowedCollaborator) {
    const error = new Error("Você só pode preencher atividades para o seu próprio colaborador.");
    error.statusCode = 403;
    throw error;
  }

  record.colaborador = allowedCollaborator;
}

const FIELD_TO_COLUMN = {
  id: "id",
  colaborador: "colaborador",
  obra: "obra",
  obraId: "obra_id",
  prioridade: "prioridade",
  projeto: "projeto",
  trabalhos: "trabalhos",
  fase: "fase",
  item: "item",
  etapa: "etapa",
  dataInicio: "data_inicio",
  horaInicio: "hora_inicio",
  dataTermino: "data_termino",
  horaTermino: "hora_termino",
  dataPrevista: "data_prevista",
  status: "status",
  observacoes: "observacoes",
  criadoEm: "criado_em",
  usuarioId: "usuario_id",
  criadoPorNome: "criado_por_nome"
};

function getActivityInterval(activity) {
  if (!activity.data_inicio || !activity.hora_inicio || !activity.data_termino || !activity.hora_termino) return null;

  const start = new Date(`${activity.data_inicio}T${activity.hora_inicio}`);
  const end = new Date(`${activity.data_termino}T${activity.hora_termino}`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;

  return { start, end };
}

async function ensureNoScheduleOverlap(record) {
  const interval = getActivityInterval(record);
  if (!interval || !record.colaborador) return;

  const query = `?colaborador=eq.${encodeURIComponent(record.colaborador)}&data_inicio=lte.${encodeURIComponent(record.data_termino)}&data_termino=gte.${encodeURIComponent(record.data_inicio)}&select=id,trabalhos,data_inicio,hora_inicio,data_termino,hora_termino`;
  const existingRecords = await supabaseRequestTodos(SUPABASE_TABLE, query);
  const conflict = (Array.isArray(existingRecords) ? existingRecords : []).find((existing) => {
    if (existing.id === record.id) return false;
    const existingInterval = getActivityInterval(existing);
    if (!existingInterval) return false;
    return interval.start < existingInterval.end && interval.end > existingInterval.start;
  });

  if (conflict) {
    const error = new Error(`O colaborador já possui atividade no período informado: ${conflict.trabalhos || conflict.id}.`);
    error.statusCode = 409;
    throw error;
  }
}

function toDatabaseRecord(activity) {
  return Object.entries(FIELD_TO_COLUMN).reduce((record, [field, column]) => {
    if (Object.prototype.hasOwnProperty.call(activity, field)) {
      record[column] = activity[field] || null;
    }
    return record;
  }, {});
}

function activityUpdateOptions(record) {
  return {
    method: "PATCH",
    body: JSON.stringify(record)
  };
}

function fromDatabaseRecord(record) {
  return Object.entries(FIELD_TO_COLUMN).reduce((activity, [field, column]) => {
    activity[field] = record[column] ?? "";
    return activity;
  }, {});
}

function fromDatabaseRecordComObra(enriched, classificacoes = []) {
  return { ...fromDatabaseRecord(enriched), obraId: enriched.obra_id || "", obraCodigo: enriched.obraCodigo || "", obra: enriched.obra || "", classificacoes: obterClassificacoesAtividade({ ...enriched, classificacoes }) };
}
function validarClassificacoes(body) {
  const exige = projetoExigeFaseItem(body.projeto);
  if (!exige) return [];
  if (!Array.isArray(body.classificacoes) || !body.classificacoes.length) throw Object.assign(new Error("Selecione pelo menos uma Fase e um Item para este Projeto."), { statusCode: 422 });
  const classificacoes = obterClassificacoesAtividade({ classificacoes: body.classificacoes });
  if (classificacoes.length !== body.classificacoes.length) throw Object.assign(new Error("Toda classificação deve informar Fase e Item."), { statusCode: 422 });
  if (new Set(classificacoes.map((c) => c.chave)).size !== classificacoes.length) throw Object.assign(new Error("A mesma classificação não pode ser repetida."), { statusCode: 422 });
  const total = duracaoAtividadeMinutos(body);
  if (classificacoes.length === 1) classificacoes[0].minutosDedicados = total;
  const rateio = validarRateio(classificacoes, total);
  if (!rateio.valido) throw Object.assign(new Error(`O rateio (${rateio.distribuido} min) deve ser igual à duração (${total} min).`), { statusCode: 422 });
  return classificacoes;
}
async function substituirClassificacoes(atividadeId, classificacoes) {
  await supabaseRequest(CLASSIFICACOES_TABLE, `?atividade_id=eq.${encodeURIComponent(atividadeId)}`, { method: "DELETE" });
  if (!classificacoes.length) return;
  await supabaseRequest(CLASSIFICACOES_TABLE, "", { method: "POST", body: JSON.stringify(classificacoes.map((c) => ({ atividade_id: atividadeId, fase: c.fase, item: c.item, item_outro: c.itemOutro ? c.item : null, minutos_dedicados: c.minutosDedicados }))) });
}
function filtroAtividadesRelacionadas(record) {
  const campos = [
    ["colaborador", record.colaborador],
    [record.obra_id ? "obra_id" : "obra", record.obra_id || record.obra],
    ["projeto", record.projeto],
    ["etapa", record.etapa]
  ];

  if (campos.some(([, valor]) => !String(valor || "").trim())) return "";
  return `?${campos.map(([campo, valor]) => `${campo}=eq.${encodeURIComponent(valor)}`).join("&")}`;
}

function possuiValor(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function classificarAtividadeParaFinalizacao(record) {
  const possuiFase = possuiValor(record?.fase);
  const possuiItem = possuiValor(record?.item);
  if (possuiFase && possuiItem) return "estruturada";
  if (!possuiFase && !possuiItem) return "legada";
  return "incompleta";
}

function conjuntoItensNormalizado(value) {
  return [...new Set(separarItens(value).map(normalizarItemPlanner).filter(Boolean))].sort();
}

function conjuntosIguais(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function atividadeEstruturadaEquivalente(record, candidate) {
  return classificarAtividadeParaFinalizacao(candidate) === "estruturada"
    && normalizarChavePlanner(record.fase) === normalizarChavePlanner(candidate.fase)
    && conjuntosIguais(conjuntoItensNormalizado(record.item), conjuntoItensNormalizado(candidate.item));
}

function idsPlannerPorAtividade(links) {
  const result = new Map();
  for (const link of links || []) {
    if (!possuiValor(link.atividade_id) || !possuiValor(link.item_id)) continue;
    const ids = result.get(link.atividade_id) || new Set();
    ids.add(String(link.item_id));
    result.set(link.atividade_id, ids);
  }
  return result;
}

function setsIguais(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

async function finalizarAtividadesRelacionadas(record, request = supabaseRequest) {
  if (normalizeText(record.status) !== "finalizado") return [];
  const filtro = filtroAtividadesRelacionadas(record);
  if (!filtro) return [];

  const classificacao = classificarAtividadeParaFinalizacao(record);
  if (classificacao === "incompleta") {
    console.warn("Atividade com classificação parcial; finalização automática relacionada ignorada.");
    return [];
  }

  const read = request === supabaseRequest ? supabaseRequestTodos : request;
  const candidates = await read(SUPABASE_TABLE, `${filtro}&status=neq.Finalizado&select=id,fase,item`);
  let related = (Array.isArray(candidates) ? candidates : []).filter((candidate) => candidate.id !== record.id);
  if (classificacao === "legada") {
    related = related.filter((candidate) => classificarAtividadeParaFinalizacao(candidate) === "legada");
  } else {
    const sourceLinks = record.id
      ? await read("atividade_planner_itens", `?atividade_id=eq.${encodeURIComponent(record.id)}&select=atividade_id,item_id&order=atividade_id.asc,item_id.asc`)
      : [];
    const sourceItemIds = new Set((sourceLinks || []).map((link) => String(link.item_id)).filter(Boolean));
    if (sourceItemIds.size) {
      const candidateIds = [...new Set(related.map((candidate) => candidate.id).filter(Boolean))];
      const links = candidateIds.length
         ? await read("atividade_planner_itens", `?atividade_id=in.(${candidateIds.map(encodeURIComponent).join(",")})&select=atividade_id,item_id&order=atividade_id.asc,item_id.asc`)
        : [];
      const plannerIds = idsPlannerPorAtividade(links);
      related = related.filter((candidate) => {
        const candidateItemIds = plannerIds.get(candidate.id);
        return classificarAtividadeParaFinalizacao(candidate) === "estruturada"
          && candidateItemIds && setsIguais(sourceItemIds, candidateItemIds);
      });
    } else {
      related = related.filter((candidate) => atividadeEstruturadaEquivalente(record, candidate));
    }
  }

  const relatedIds = [...new Set(related.map((candidate) => candidate.id).filter(Boolean))];
  if (!relatedIds.length) return [];
  return request(SUPABASE_TABLE, `?id=in.(${relatedIds.map(encodeURIComponent).join(",")})`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Finalizado" })
  });
}
async function finalizarAtividadePorId(id, user, request = supabaseRequest, sincronizar = sincronizarAtividadeComPlanner) {
  const rows = await request(SUPABASE_TABLE, `?id=eq.${encodeURIComponent(id)}&select=*`);
  const atividade = rows?.[0];
  if (!atividade) throw Object.assign(new Error("Atividade não encontrada."), { statusCode: 404 });
  if (user?.perfil !== "admin" && atividade.usuario_id !== user?.id) throw Object.assign(new Error("Você só pode finalizar atividades criadas por você."), { statusCode: 403 });
  const read = request === supabaseRequest ? supabaseRequestTodos : request;
  atividade.classificacoes = await read(CLASSIFICACOES_TABLE, `?atividade_id=eq.${encodeURIComponent(id)}&select=*`);
  const salvas = await request(SUPABASE_TABLE, `?id=eq.${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status: "Finalizado" }) });
  const finalizada = { ...atividade, ...(salvas?.[0] || {}), status: "Finalizado" };
  const relacionadas = await finalizarAtividadesRelacionadas(finalizada, request);
  const plannerSync = await sincronizar(finalizada, { user });
  return { atividade: finalizada, atividadesFinalizadas: [id, ...(relacionadas || []).map((item) => item.id)].filter(Boolean), plannerSync };
}
module.exports = async function atividadesHandler(req, res) {
  try {
    if (req.method === "GET") {
      const user = await requireInternalUser(req);
      const data = await supabaseRequestTodos(SUPABASE_TABLE, "?select=*&order=criado_em.desc,id.asc");
      const ids = (data || []).map((a) => a.id);
      const [classificacoes, enriched] = await Promise.all([carregarClassificacoesEmLotes(ids), enriquecerRegistrosComObras(data)]);
      const porAtividade = new Map();
      classificacoes.forEach((item) => { const lista = porAtividade.get(item.atividade_id) || []; lista.push(item); porAtividade.set(item.atividade_id, lista); });
      sendJson(res, 200, enriched.map((a) => fromDatabaseRecordComObra(a, porAtividade.get(a.id) || [])));
      return;
    }

    if (req.method === "POST") {
      const user = await requireInternalUser(req);
      const body = parseRequestBody(req);
      if (body.acao === "finalizarAtividade") {
        if (!body.id) return sendJson(res, 400, { error: "ID da atividade não informado." });
        return sendJson(res, 200, await finalizarAtividadePorId(body.id, user));
      }
      if (body.acao === "sincronizarPlanner") {
        const rows = await supabaseRequest(SUPABASE_TABLE, `?id=eq.${encodeURIComponent(body.id)}&select=*`);
        const atividade = rows?.[0];
        if (!atividade) return sendJson(res, 404, { error: "Atividade não encontrada." });
        if (user.perfil !== "admin" && atividade.usuario_id !== user.id) return sendJson(res, 403, { error: "Você só pode sincronizar suas próprias atividades." });
        atividade.classificacoes = await supabaseRequestTodos(CLASSIFICACOES_TABLE, `?atividade_id=eq.${encodeURIComponent(atividade.id)}&select=*`);
        return sendJson(res, 200, { ...fromDatabaseRecord(atividade), classificacoes: obterClassificacoesAtividade(atividade), plannerSync: await sincronizarComResposta(atividade, user, body.checklistId) });
      }
      validateActivityDates(body);
      const classificacoes = validarClassificacoes(body);
      if (!projetoExigeFaseItem(body.projeto)) { body.classificacoes = []; body.fase = ""; body.item = ""; }
      const record = toDatabaseRecord(body);
      record.usuario_id = user.id;
      record.criado_por_nome = user.nome;
      enforceCollaboratorPermission(record, user);
      record.colaborador = record.colaborador || user.nome;
      const [obra] = await Promise.all([
        resolverOuCriarObra({ obraId: body.obraId, nomeObra: body.obra, usuarioId: user.id, origemCriacao: "nova_atividade" }),
        ensureNoScheduleOverlap(record)
      ]);
      body.obraId = obra.id; body.obra = obra.nome; record.obra_id = obra.id; record.obra = obra.nome;
      const data = await supabaseRequest(SUPABASE_TABLE, "", {
        method: "POST",
        body: JSON.stringify(record)
      });
      const salvo = data[0] || { ...record, id: body.id };
      let finalizadas;
      try { [finalizadas] = await Promise.all([finalizarAtividadesRelacionadas({ ...record, id: salvo.id }), Array.isArray(body.classificacoes) ? substituirClassificacoes(salvo.id, classificacoes) : Promise.resolve()]); }
      catch (error) { await supabaseRequest(SUPABASE_TABLE, `?id=eq.${encodeURIComponent(salvo.id)}`, { method: "DELETE" }); throw Object.assign(new Error(`A atividade não foi salva porque o rateio falhou: ${error.message}`), { statusCode: 500 }); }
      salvo.classificacoes = classificacoes;
      sendJson(res, 201, { ...fromDatabaseRecord(salvo), obraId: obra.id, obraCodigo: obra.codigo, obra: obra.nome, plannerSync: { status: projetoExigeFaseItem(body.projeto) ? "pendente" : "ignorado" }, atividadesFinalizadas: (finalizadas || []).map((item) => item.id).filter(Boolean) });
      return;
    }

    if (req.method === "PUT") {
      const user = await requireInternalUser(req);
      const body = parseRequestBody(req);
      if (!body.id) {
        sendJson(res, 400, { error: "ID da atividade não informado." });
        return;
      }

      validateActivityDates(body);
      const classificacoes = validarClassificacoes(body);
      if (!projetoExigeFaseItem(body.projeto)) { body.classificacoes = []; body.fase = ""; body.item = ""; }

      const atuais = await supabaseRequest(SUPABASE_TABLE, `?id=eq.${encodeURIComponent(body.id)}&select=id,usuario_id`);
      const atual = Array.isArray(atuais) ? atuais[0] : null;
      if (!atual) {
        sendJson(res, 404, { error: "Atividade não encontrada." });
        return;
      }
      if (user.perfil !== "admin" && atual.usuario_id !== user.id) {
        sendJson(res, 403, { error: "Você só pode editar atividades criadas por você." });
        return;
      }

      const record = toDatabaseRecord(body);
      enforceCollaboratorPermission(record, user);
      delete record.usuario_id;
      delete record.criado_por_nome;
      const [obra] = await Promise.all([
        resolverOuCriarObra({ obraId: body.obraId, nomeObra: body.obra, usuarioId: user.id }),
        ensureNoScheduleOverlap(record)
      ]);
      body.obraId = obra.id; body.obra = obra.nome; record.obra_id = obra.id; record.obra = obra.nome;
      const data = await supabaseRequest(
        SUPABASE_TABLE,
        `?id=eq.${encodeURIComponent(body.id)}`,
        activityUpdateOptions(record)
      );
      const salvo = data[0] || record;
      const [finalizadas] = await Promise.all([finalizarAtividadesRelacionadas({ ...record, id: body.id }), Array.isArray(body.classificacoes) ? substituirClassificacoes(body.id, classificacoes) : Promise.resolve()]);
      salvo.classificacoes = classificacoes;
      sendJson(res, 200, { ...fromDatabaseRecord(salvo), obraId: obra.id, obraCodigo: obra.codigo, obra: obra.nome, plannerSync: { status: projetoExigeFaseItem(body.projeto) ? "pendente" : "ignorado" }, atividadesFinalizadas: (finalizadas || []).map((item) => item.id).filter(Boolean) });
      return;
    }

    if (req.method === "DELETE") {
      const user = await requireInternalUser(req);
      const id = typeof req.query?.id === "string" ? req.query.id : "";
      const all = req.query?.all === "true";

      if (!id && !all) {
        sendJson(res, 400, { error: "Informe o ID da atividade ou use all=true para apagar tudo." });
        return;
      }

      if (all && user.perfil !== "admin") {
        sendJson(res, 403, { error: "Apenas administradores podem limpar todos os registros." });
        return;
      }

      if (!all) {
        const atuais = await supabaseRequest(SUPABASE_TABLE, `?id=eq.${encodeURIComponent(id)}&select=id,usuario_id`);
        const atual = Array.isArray(atuais) ? atuais[0] : null;
        if (!atual) {
          sendJson(res, 404, { error: "Atividade não encontrada." });
          return;
        }
        if (user.perfil !== "admin" && atual.usuario_id !== user.id) {
          sendJson(res, 403, { error: "Você só pode excluir atividades criadas por você." });
          return;
        }
      }

      const vinculos = all ? [] : await removerVinculosAtividade(id);
      const filter = all ? "?id=not.is.null" : `?id=eq.${encodeURIComponent(id)}`;
      await supabaseRequest(SUPABASE_TABLE, filter, { method: "DELETE" });
      if (!all) await limparItensOrfaos(vinculos);
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Método não suportado." });
  } catch (error) {
    console.error("Erro na API de atividades:", error);
    sendJson(res, error.statusCode || 500, { error: error.message || "Erro interno ao processar atividades." });
  }
};
async function sincronizarComResposta(record, user, checklistId) {
  try { return await sincronizarAtividadeComPlanner(record, { user, checklistId }); }
  catch (error) { console.error("Erro técnico na sincronização do Planner:", error); return { status: "erro", mensagem: "Não foi possível atualizar o Planner." }; }
}
module.exports._test = {
  activityUpdateOptions,
  carregarClassificacoesEmLotes,
  atividadeEstruturadaEquivalente,
  classificarAtividadeParaFinalizacao,
  conjuntoItensNormalizado,
  finalizarAtividadesRelacionadas,
  finalizarAtividadePorId,
  filtroAtividadesRelacionadas,
  fromDatabaseRecord,
  idsPlannerPorAtividade,
  possuiValor,
  setsIguais,
  validarClassificacoes,
  toDatabaseRecord
};
