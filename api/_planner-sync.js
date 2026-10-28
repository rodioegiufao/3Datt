const { supabaseRequest, supabaseRequestTodos } = require("./_auth");
const { normalizarChavePlanner, normalizarProjetoPlanner, obterProjetoPlanner, obterCodigoProjetoPlanner, obterBucketModeloPlanner } = require("../atividades/planner-modelos");
const { separarItens, taxonomiaPlannerCompleta, projetoExigeFaseItem } = require("../atividades/fase-item");
const { minutosDaClassificacao, obterClassificacoesAtividade } = require("../atividades/classificacoes");

const CHECKLISTS_TABLE = "planner_checklists";
const ITEMS_TABLE = "planner_checklist_itens";
const LINKS_TABLE = "atividade_planner_itens";
const ITEM_ALIASES = new Map([
  ["eletrocalhas", "eletrocalha"], ["perfilados", "perfilado"], ["cabos pp", "cabo pp"],
  ["tomadas de uso especifico", "tomada de uso especifico"], ["pontos de it-medico", "it-medico"]
]);

function obterCodigoProjetoDaAtividade(projeto) {
  const meta = obterProjetoPlanner(projeto);
  if (!meta || !projetoExigeFaseItem(meta.projeto)) return "";
  return obterCodigoProjetoPlanner(meta.projeto) || `PRJ-${meta.projeto.replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "GER"}`;
}
function ehProjetoBaixaTensao(projeto) { return normalizarProjetoPlanner(projeto) === normalizarProjetoPlanner("Elétrico Baixa Tensão"); }
function gerarChavePlanner(obraId, codigoProjeto) { return `${String(obraId || "").trim()}::${String(codigoProjeto || "").trim().toUpperCase()}`; }
function normalizarItemPlanner(valor) {
  const chave = normalizarChavePlanner(valor).replace(/\s+/g, " ");
  return ITEM_ALIASES.get(chave) || chave;
}
function gerarChaveItemPlanner(fase, item) { return `${normalizarChavePlanner(fase)}::${normalizarItemPlanner(item)}`; }
function classificacoesDaAtividade(atividade) {
  return obterClassificacoesAtividade(atividade).filter((c) => normalizarChavePlanner(c.item) !== "outros");
}
function itensDaAtividade(atividade) {
  const classificacoes = classificacoesDaAtividade(atividade);
  return classificacoes.length ? classificacoes.map((c) => c.item) : separarItens(atividade.item).filter((item) => normalizarChavePlanner(item) !== "outros");
}
function minutosDaAtividade(atividade) {
  if (!atividade.data_inicio || !atividade.hora_inicio || !atividade.data_termino || !atividade.hora_termino) return 0;
  const inicio = new Date(`${atividade.data_inicio}T${atividade.hora_inicio}`);
  const fim = new Date(`${atividade.data_termino}T${atividade.hora_termino}`);
  const minutos = Math.round((fim - inicio) / 60000);
  return Number.isFinite(minutos) && minutos > 0 ? minutos : 0;
}

function minutosDoVinculoPlanner(atividade, itemPlanner) {
  return minutosDaClassificacao(atividade, itemPlanner?.etapa, itemPlanner?.atividade || itemPlanner?.estagio, {
    normalizarFase: normalizarChavePlanner,
    normalizarItem: normalizarItemPlanner
  });
}
function agregarVinculosPlanner(links = []) {
  const mapa = new Map();
  for (const link of links) {
    const a = link.atividade, item = link.item;
    if (!a || !item) continue;
    const minutosRateados = minutosDoVinculoPlanner(a, item);
    // Um vínculo sem classificação correspondente é obsoleto: não pode herdar a
    // duração integral nem continuar contribuindo depois de uma edição do rateio.
    if (minutosRateados <= 0) continue;
    const atual = mapa.get(link.item_id) || { atividadeCount: 0, minutosRegistrados: 0, colaboradores: [], ultimaAtividade: "", atividades: [] };
    atual.atividadeCount += 1;
    atual.minutosRegistrados += minutosRateados;
    if (a.colaborador && !atual.colaboradores.includes(a.colaborador)) atual.colaboradores.push(a.colaborador);
    atual.ultimaAtividade = [atual.ultimaAtividade, a.data_termino || a.data_inicio || ""].sort().pop();
    atual.atividades.push({ ...a, minutosRateados, plannerItemId: link.item_id });
    mapa.set(link.item_id, atual);
  }
  return mapa;
}

async function localizarOuCriarPlanner(atividade, user, checklistEscolhidoId) {
  const codigo = obterCodigoProjetoDaAtividade(atividade.projeto);
  const chave = gerarChavePlanner(atividade.obra_id, codigo);
  const porChave = await supabaseRequest(CHECKLISTS_TABLE, `?chave_sincronizacao=eq.${encodeURIComponent(chave)}&select=*`);
  if (porChave?.[0]) {
    const checklist = porChave[0]; const responsaveis = new Set(listarResponsaveis(checklist.responsavel));
    if (atividade.colaborador && !responsaveis.has(atividade.colaborador)) { responsaveis.add(atividade.colaborador); await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(checklist.id)}`, { method: "PATCH", body: JSON.stringify({ responsavel: JSON.stringify([...responsaveis]) }) }); checklist.responsavel = JSON.stringify([...responsaveis]); }
    return { checklist, criado: false };
  }
  const candidatos = await supabaseRequestTodos(CHECKLISTS_TABLE, `?obra_id=eq.${encodeURIComponent(atividade.obra_id)}&codigo_projeto=eq.${encodeURIComponent(codigo)}&select=*`);
  let escolhido = checklistEscolhidoId ? candidatos.find((item) => String(item.id) === String(checklistEscolhidoId)) : null;
  if (!escolhido && candidatos.length === 1) escolhido = candidatos[0];
  if (!escolhido && candidatos.length > 1) return { ambigua: true, candidatos: candidatos.map((item) => ({ id: item.id, nomeTarefa: item.nome_tarefa, tipo: item.tipo })) };
  if (escolhido) {
    const responsaveis = new Set(listarResponsaveis(escolhido.responsavel)); responsaveis.add(atividade.colaborador);
    const rows = await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(escolhido.id)}`, { method: "PATCH", body: JSON.stringify({ chave_sincronizacao: chave, origem: escolhido.origem === "atividade" ? "atividade" : "hibrido", responsavel: JSON.stringify([...responsaveis].filter(Boolean)) }) });
    return { checklist: rows[0] || escolhido, criado: false };
  }
  const meta = obterProjetoPlanner(atividade.projeto);
  const projetoCanonico = meta?.projeto || atividade.projeto;
  const novo = { obra_id: atividade.obra_id, obra: atividade.obra, projeto: projetoCanonico, codigo_projeto: codigo, tipo: null,
    nome_tarefa: projetoCanonico, status: "Em andamento", prioridade: atividade.prioridade || "P1", data_inicio: atividade.data_inicio || null,
    data_conclusao: atividade.data_prevista || null, bucket: obterBucketModeloPlanner(projetoCanonico, codigo) || "Outros", responsavel: JSON.stringify([atividade.colaborador].filter(Boolean)),
    origem: "atividade", chave_sincronizacao: chave, configuracao_automatica_concluida: false, criado_por: user?.id || null, criado_por_nome: user?.nome || atividade.colaborador };
  try {
    const rows = await supabaseRequest(CHECKLISTS_TABLE, "", { method: "POST", body: JSON.stringify(novo) });
    return { checklist: rows[0], criado: true };
  } catch (error) {
    if (!/duplicate|unique|23505/i.test(error.message || "") && error.statusCode !== 409) throw error;
    const concorrente = await supabaseRequest(CHECKLISTS_TABLE, `?chave_sincronizacao=eq.${encodeURIComponent(chave)}&select=*`);
    if (!concorrente?.[0]) throw error;
    return { checklist: concorrente[0], criado: false };
  }
}
function listarResponsaveis(valor) {
  if (Array.isArray(valor)) return valor;
  try { const parsed = JSON.parse(valor || "[]"); if (Array.isArray(parsed)) return parsed; } catch (_) { /* legado */ }
  return String(valor || "").split(/\s*(?:·|,|;|\|)\s*/).filter(Boolean);
}
async function localizarOuCriarItemPlanner(checklistId, fase, item, ordem) {
  const chave = gerarChaveItemPlanner(fase, item);
  const existentes = await supabaseRequestTodos(ITEMS_TABLE, `?checklist_id=eq.${encodeURIComponent(checklistId)}&select=*`);
  let existente = existentes.find((row) => row.chave_sincronizacao === chave || gerarChaveItemPlanner(row.etapa, row.atividade || row.estagio) === chave);
  if (existente) {
    if (!existente.chave_sincronizacao) await supabaseRequest(ITEMS_TABLE, `?id=eq.${encodeURIComponent(existente.id)}&chave_sincronizacao=is.null`, { method: "PATCH", body: JSON.stringify({ chave_sincronizacao: chave }) }).catch(() => null);
    return { item: existente, criado: false };
  }
  try {
    const rows = await supabaseRequest(ITEMS_TABLE, "", { method: "POST", body: JSON.stringify({ checklist_id: checklistId, etapa: fase, atividade: item, texto: `${fase} — ${item}`, ordem, origem: "atividade", chave_sincronizacao: chave }) });
    return { item: rows[0], criado: true };
  } catch (error) {
    if (!/duplicate|unique|23505/i.test(error.message || "") && error.statusCode !== 409) throw error;
    const rows = await supabaseRequestTodos(ITEMS_TABLE, `?checklist_id=eq.${encodeURIComponent(checklistId)}&chave_sincronizacao=eq.${encodeURIComponent(chave)}&select=*`);
    if (!rows?.[0]) throw error;
    return { item: rows[0], criado: false };
  }
}
async function removerVinculosAtividade(atividadeId) {
  const antigos = await supabaseRequestTodos(LINKS_TABLE, `?atividade_id=eq.${encodeURIComponent(atividadeId)}&select=item_id&order=atividade_id.asc,item_id.asc`);
  await supabaseRequest(LINKS_TABLE, `?atividade_id=eq.${encodeURIComponent(atividadeId)}`, { method: "DELETE" });
  return antigos || [];
}
async function limparItensOrfaos(vinculos) {
  const ids = [...new Set((vinculos || []).map((vinculo) => vinculo.item_id).filter(Boolean))];
  if (!ids.length) return;
  const filtro = ids.map(encodeURIComponent).join(",");
  const restantes = await supabaseRequestTodos(LINKS_TABLE, `?item_id=in.(${filtro})&select=item_id&order=atividade_id.asc,item_id.asc`);
  const vinculados = new Set((restantes || []).map((item) => String(item.item_id)));
  const candidatos = ids.filter((id) => !vinculados.has(String(id)));
  if (!candidatos.length) return;
  const filtroCandidatos = candidatos.map(encodeURIComponent).join(",");
  const itens = await supabaseRequestTodos(ITEMS_TABLE, `?id=in.(${filtroCandidatos})&origem=eq.atividade&concluido=eq.false&data_prevista=is.null&hora_prevista=is.null&responsavel=is.null&observacoes=is.null&select=id`);
  const orfaos = (itens || []).map((item) => item.id).filter(Boolean);
  if (orfaos.length) await supabaseRequest(ITEMS_TABLE, `?id=in.(${orfaos.map(encodeURIComponent).join(",")})`, { method: "DELETE" });
}

function itemPorChave(itens) {
  return new Map((itens || []).map((item) => [item.chave_sincronizacao || gerarChaveItemPlanner(item.etapa, item.atividade || item.estagio), item]));
}

async function localizarOuCriarItensEmLote(checklistId, classificacoes) {
  let existentes = await supabaseRequestTodos(ITEMS_TABLE, `?checklist_id=eq.${encodeURIComponent(checklistId)}&select=*`);
  let porChave = itemPorChave(existentes);
  const faltantes = classificacoes.map((classificacao, ordem) => ({ classificacao, ordem, chave: gerarChaveItemPlanner(classificacao.fase, classificacao.item) })).filter(({ chave }) => !porChave.has(chave));
  if (faltantes.length) {
    const payload = faltantes.map(({ classificacao, ordem, chave }) => ({ checklist_id: checklistId, etapa: classificacao.fase, atividade: classificacao.item, texto: `${classificacao.fase} — ${classificacao.item}`, ordem, origem: "atividade", chave_sincronizacao: chave }));
    try {
      const criados = await supabaseRequest(ITEMS_TABLE, "", { method: "POST", headers: { Prefer: "resolution=ignore-duplicates,return=representation" }, body: JSON.stringify(payload) });
      existentes = existentes.concat(criados || []);
    } catch (error) {
      if (!/duplicate|unique|23505/i.test(error.message || "") && error.statusCode !== 409) throw error;
      existentes = await supabaseRequestTodos(ITEMS_TABLE, `?checklist_id=eq.${encodeURIComponent(checklistId)}&select=*`);
    }
    porChave = itemPorChave(existentes);
  }
  const itens = classificacoes.map((classificacao) => porChave.get(gerarChaveItemPlanner(classificacao.fase, classificacao.item))).filter(Boolean);
  if (itens.length !== classificacoes.length) throw new Error("Não foi possível localizar todos os itens do Planner.");
  return { itens, itensCriados: faltantes.filter(({ chave }) => porChave.has(chave)).length };
}
async function sincronizarAtividadeComPlanner(atividade, { user, checklistId } = {}) {
  if (!projetoExigeFaseItem(obterProjetoPlanner(atividade.projeto)?.projeto || atividade.projeto)) { const antigos = await removerVinculosAtividade(atividade.id); await limparItensOrfaos(antigos); return { status: "ignorado" }; }
  const classificacoes = classificacoesDaAtividade(atividade);
  if (!atividade.obra_id || !atividade.id || !classificacoes.length) return { status: "ignorado" };
  const localizado = await localizarOuCriarPlanner(atividade, user, checklistId);
  if (localizado.ambigua) return { status: "ambigua", candidatos: localizado.candidatos };
  const [antigos, localizados] = await Promise.all([
    supabaseRequestTodos(LINKS_TABLE, `?atividade_id=eq.${encodeURIComponent(atividade.id)}&select=item_id&order=atividade_id.asc,item_id.asc`),
    localizarOuCriarItensEmLote(localizado.checklist.id, classificacoes)
  ]);
  const itemIds = localizados.itens.map((item) => item.id);
  const desejados = new Set(itemIds.map(String));
  const removidos = (antigos || []).filter((v) => !desejados.has(String(v.item_id)));
  if (removidos.length) await supabaseRequest(LINKS_TABLE, `?atividade_id=eq.${encodeURIComponent(atividade.id)}&item_id=in.(${removidos.map((v) => encodeURIComponent(v.item_id)).join(",")})`, { method: "DELETE" });
  await supabaseRequest(LINKS_TABLE, "?on_conflict=atividade_id,item_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" }, body: JSON.stringify(itemIds.map((itemId) => ({ atividade_id: atividade.id, checklist_id: localizado.checklist.id, item_id: itemId }))) });
  await limparItensOrfaos(removidos);
  return { status: "sincronizado", checklistId: localizado.checklist.id, itemIds, plannerCriado: localizado.criado, itensCriados: localizados.itensCriados, precisaConfigurar: localizado.criado || !localizado.checklist.configuracao_automatica_concluida,
    itens: classificacoes.map((c, index) => ({ id: itemIds[index], fase: c.fase, item: c.item, minutosDedicados: c.minutosDedicados })) };
}
async function agregarAtividadesDosItens(checklistIds) {
  if (!checklistIds.length) return new Map();
  // `planner_checklist_itens` stores the stage name in `atividade`. Requesting
  // the legacy/nonexistent `estagio` column makes PostgREST reject the entire
  // Planner request with HTTP 400 before the board or Gantt can be rendered.
  const links = await supabaseRequestTodos(LINKS_TABLE, `?checklist_id=in.(${checklistIds.map(encodeURIComponent).join(",")})&select=item_id,item:planner_checklist_itens(etapa,atividade),atividade:atividades_colaboradores(*,atividade_classificacoes(*))&order=atividade_id.asc,item_id.asc`);
  return agregarVinculosPlanner(links || []);
}
async function configurarPlannerAutomatico({ checklistId, modo, tipo, selecao, user }) {
  const rows = await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(checklistId)}&select=*`); const checklist = rows?.[0];
  if (!checklist) throw Object.assign(new Error("Planner não encontrado."), { statusCode: 404 });
  if (user?.perfil !== "admin" && !listarResponsaveis(checklist.responsavel).some((n) => normalizarChavePlanner(user.nome).includes(normalizarChavePlanner(n)))) throw Object.assign(new Error("Sem permissão para configurar este Planner."), { statusCode: 403 });
  const grupos = modo === "completo" ? taxonomiaPlannerCompleta(obterProjetoPlanner(checklist.projeto)?.projeto || checklist.projeto) : modo === "personalizado" ? (selecao || []) : [];
  let ordem = 1000; for (const grupo of grupos) for (const item of grupo.estagios || grupo.itens || []) { await localizarOuCriarItemPlanner(checklist.id, grupo.etapa || grupo.fase, item, ordem++); }
  await supabaseRequest(CHECKLISTS_TABLE, `?id=eq.${encodeURIComponent(checklist.id)}`, { method: "PATCH", body: JSON.stringify({ tipo: tipo || null, configuracao_automatica_concluida: true }) });
  return { status: "sincronizado", checklistId: checklist.id };
}

module.exports = { agregarAtividadesDosItens, agregarVinculosPlanner, classificacoesDaAtividade, configurarPlannerAutomatico, ehProjetoBaixaTensao, projetoExigeFaseItem, gerarChaveItemPlanner, gerarChavePlanner, itemPorChave, itensDaAtividade, limparItensOrfaos, minutosDaAtividade, minutosDoVinculoPlanner, normalizarItemPlanner, obterCodigoProjetoDaAtividade, removerVinculosAtividade, sincronizarAtividadeComPlanner };