const { parseRequestBody, requireInternalUser, sendJson, supabaseRequest } = require("./_auth");
const { listarObras, localizarObraPorId, localizarObraPorNome, normalizarNomeObra, resolverOuCriarObra } = require("./_obras");

module.exports = async function obrasHandler(req, res) {
  try {
    const user = await requireInternalUser(req);
    if (req.method === "GET") return sendJson(res, 200, await listarObras());
    if (req.method === "POST") {
      const body = parseRequestBody(req);
      const obra = await resolverOuCriarObra({ obraId: body.obraId, nomeObra: body.nome, usuarioId: user.id, origemCriacao: body.origemCriacao });
      return sendJson(res, 201, obra);
    }
    if (req.method === "PATCH") {
      if (user.perfil !== "admin") return sendJson(res, 403, { error: "Apenas administradores podem alterar obras." });
      const body = parseRequestBody(req);
      const atual = await localizarObraPorId(body.id);
      if (!atual) return sendJson(res, 404, { error: "A obra informada não foi encontrada." });
      const nome = String(body.nome ?? "").trim().replace(/\s+/g, " ");
      const nomeNormalizado = normalizarNomeObra(nome);
      if (!nomeNormalizado) return sendJson(res, 400, { error: "Informe o nome da obra." });
      const conflito = await localizarObraPorNome(nome);
      if (conflito && conflito.id !== atual.id) return sendJson(res, 409, { error: "Já existe uma obra com esse nome." });
      const patch = { nome, nome_normalizado: nomeNormalizado, atualizado_em: new Date().toISOString() };
      if (Object.prototype.hasOwnProperty.call(body, "ativo")) patch.ativo = Boolean(body.ativo);
      let rows;
      try { rows = await supabaseRequest("obras", `?id=eq.${encodeURIComponent(atual.id)}`, { method: "PATCH", body: JSON.stringify(patch) }); }
      catch (error) { if (error.statusCode === 409 || /duplicate|unique|23505/i.test(error.message || "")) return sendJson(res, 409, { error: "Já existe uma obra com esse nome." }); throw error; }
      // Textos legados remain compatible; all screens still prioritize the central row.
      await Promise.all(["atividades_colaboradores", "planner_checklists", "atividades_semanais"].map((table) =>
        supabaseRequest(table, `?obra_id=eq.${encodeURIComponent(atual.id)}`, { method: "PATCH", body: JSON.stringify({ obra: nome }) })
      ));
      const row = rows?.[0] || { ...patch, id: atual.id, codigo: atual.codigo };
      return sendJson(res, 200, { id: row.id, codigo: row.codigo, nome: row.nome, nomeNormalizado: row.nome_normalizado, ativo: Boolean(row.ativo) });
    }
    return sendJson(res, 405, { error: "Método não suportado." }, { Allow: "GET, POST, PATCH" });
  } catch (error) {
    console.error("Erro na API de obras:", error);
    return sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : "Erro interno ao processar obras." });
  }
};