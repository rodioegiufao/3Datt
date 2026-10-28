const { supabaseRequest, supabaseRequestTodos } = require("./_auth");

const OBRAS_TABLE = "obras";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function erroObra(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizarNomeObra(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ");
}

function mapearObra(row) {
  if (!row) return null;
  return { id: row.id, codigo: row.codigo, nome: row.nome, nomeNormalizado: row.nome_normalizado, ativo: Boolean(row.ativo), origemCriacao: row.origem_criacao || "sistema", criadoPor: row.criado_por || null, criadoEm: row.criado_em || null };
}

async function localizarObraPorId(id, { incluirInativa = true } = {}) {
  if (!UUID_RE.test(String(id || ""))) throw erroObra("O ID da obra informado é inválido.", 400);
  const filtroAtivo = incluirInativa ? "" : "&ativo=eq.true";
  const rows = await supabaseRequest(OBRAS_TABLE, `?id=eq.${encodeURIComponent(id)}${filtroAtivo}&select=id,codigo,nome,nome_normalizado,ativo,origem_criacao,criado_por,criado_em`);
  return mapearObra(rows?.[0]);
}

async function localizarObraPorNome(nome, { incluirInativa = true } = {}) {
  const chave = normalizarNomeObra(nome);
  if (!chave) return null;
  const filtroAtivo = incluirInativa ? "" : "&ativo=eq.true";
  const rows = await supabaseRequest(OBRAS_TABLE, `?nome_normalizado=eq.${encodeURIComponent(chave)}${filtroAtivo}&select=id,codigo,nome,nome_normalizado,ativo,origem_criacao,criado_por,criado_em`);
  return mapearObra(rows?.[0]);
}

async function resolverOuCriarObra({ obraId, nomeObra, usuarioId, origemCriacao = "sistema" } = {}) {
  if (obraId) {
    const obra = await localizarObraPorId(obraId);
    if (!obra) throw erroObra("A obra informada não foi encontrada.", 404);
    if (!obra.ativo) throw erroObra("A obra está desativada.", 409);
    return obra;
  }
  const nome = String(nomeObra ?? "").trim().replace(/\s+/g, " ");
  const nomeNormalizado = normalizarNomeObra(nome);
  if (!nomeNormalizado) throw erroObra("Informe o nome da obra.", 400);
  const existente = await localizarObraPorNome(nomeNormalizado);
  if (existente) {
    if (!existente.ativo) throw erroObra("A obra está desativada.", 409);
    return existente;
  }
  try {
    const rows = await supabaseRequest(OBRAS_TABLE, "", {
      method: "POST",
      body: JSON.stringify({ nome, nome_normalizado: nomeNormalizado, criado_por: usuarioId || null, origem_criacao: origemCriacao })
    });
    return mapearObra(rows?.[0]);
  } catch (error) {
    if (error.statusCode === 409 || error.statusCode === 400 || /duplicate|unique|23505/i.test(error.message || "")) {
      const concorrente = await localizarObraPorNome(nomeNormalizado);
      if (concorrente) return concorrente;
    }
    console.error("Erro técnico ao criar obra:", error);
    throw erroObra("Não foi possível criar o identificador da obra.", 500);
  }
}

async function listarObras({ somenteAtivas = true } = {}) {
  const filtro = somenteAtivas ? "?ativo=eq.true&" : "?";
  const rows = await supabaseRequestTodos(OBRAS_TABLE, `${filtro}select=id,codigo,nome,nome_normalizado,ativo,origem_criacao,criado_por,criado_em&order=nome.asc,id.asc`);
  return (rows || []).map(mapearObra);
}

async function enriquecerRegistroComObra(record) {
  let obra = null;
  if (record?.obra_id) obra = await localizarObraPorId(record.obra_id).catch(() => null);
  if (!obra && record?.obra) obra = await localizarObraPorNome(record.obra).catch(() => null);
  return { ...record, obra_id: obra?.id || record?.obra_id || null, obra: obra?.nome || record?.obra || "", obraCodigo: obra?.codigo || "" };
}

function filtroIn(campo, valores) {
  const unicos = [...new Set(valores.filter(Boolean))];
  return unicos.length ? `${campo}=in.(${unicos.map(encodeURIComponent).join(",")})` : "";
}

async function enriquecerRegistrosComObras(records, request = supabaseRequestTodos) {
  const lista = Array.isArray(records) ? records : [];
  const ids = lista.map((record) => record?.obra_id).filter(Boolean);
  const nomes = lista.filter((record) => !record?.obra_id).map((record) => normalizarNomeObra(record?.obra)).filter(Boolean);
  const consultas = [];
  if (ids.length) consultas.push(request(OBRAS_TABLE, `?${filtroIn("id", ids)}&select=id,codigo,nome,nome_normalizado,ativo,origem_criacao,criado_por,criado_em`));
  if (nomes.length) consultas.push(request(OBRAS_TABLE, `?${filtroIn("nome_normalizado", nomes)}&select=id,codigo,nome,nome_normalizado,ativo,origem_criacao,criado_por,criado_em`));
  const obras = (await Promise.all(consultas)).flat().map(mapearObra);
  const porId = new Map(obras.map((obra) => [String(obra.id), obra]));
  const porNome = new Map(obras.map((obra) => [obra.nomeNormalizado, obra]));
  return lista.map((record) => {
    const obra = porId.get(String(record?.obra_id || "")) || porNome.get(normalizarNomeObra(record?.obra));
    return { ...record, obra_id: obra?.id || record?.obra_id || null, obra: obra?.nome || record?.obra || "", obraCodigo: obra?.codigo || "" };
  });
}

module.exports = { OBRAS_TABLE, enriquecerRegistroComObra, enriquecerRegistrosComObras, listarObras, localizarObraPorId, localizarObraPorNome, mapearObra, normalizarNomeObra, resolverOuCriarObra };