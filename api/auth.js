const {
  USERS_TABLE,
  clearSessionCookie,
  createSessionCookie,
  hashPassword,
  parseRequestBody,
  requireUser,
  sendJson,
  supabaseRequest,
  verifyPassword
} = require("./_auth");

function normalizeLogin(value) {
  return String(value || "").trim().toLowerCase();
}

function buildPublicUser(user) {
  return { id: user.id, nome: user.nome, usuario: user.usuario, perfil: user.perfil };
}

module.exports = async function authHandler(req, res) {
  try {
    if (req.method === "GET") {
      const user = await requireUser(req);
      sendJson(res, 200, { user });
      return;
    }

    if (req.method === "POST") {
      const { usuario, senha } = parseRequestBody(req);
      if (!usuario || !senha) {
        sendJson(res, 400, { error: "Informe usuário e senha." });
        return;
      }

      const users = await supabaseRequest(
        USERS_TABLE,
        `?usuario=eq.${encodeURIComponent(String(usuario).trim().toLowerCase())}&ativo=eq.true&select=id,nome,usuario,senha_hash,perfil`
      );
      const user = Array.isArray(users) ? users[0] : null;

      if (!user || !verifyPassword(senha, user.senha_hash)) {
        sendJson(res, 401, { error: "Usuário ou senha inválidos." });
        return;
      }

      const publicUser = buildPublicUser(user);
      sendJson(res, 200, { user: publicUser }, { "Set-Cookie": createSessionCookie(publicUser) });
      return;
    }

    if (req.method === "PUT") {
      const currentUser = await requireUser(req);
      const body = parseRequestBody(req);
      const nome = String(body.nome || "").trim();
      const usuario = normalizeLogin(body.usuario);
      const senhaAtual = String(body.senhaAtual || "");
      const novaSenha = String(body.novaSenha || "");

      if (!nome || !usuario) {
        sendJson(res, 400, { error: "Informe nome e usuário." });
        return;
      }

      const [userWithPassword] = await supabaseRequest(
        USERS_TABLE,
        `?id=eq.${encodeURIComponent(currentUser.id)}&ativo=eq.true&select=id,nome,usuario,senha_hash,perfil`
      );

      if (!userWithPassword) {
        sendJson(res, 401, { error: "Sessão inválida ou usuário desativado." });
        return;
      }

      if (novaSenha) {
        if (novaSenha.length < 6) {
          sendJson(res, 400, { error: "A nova senha deve ter pelo menos 6 caracteres." });
          return;
        }
        if (!senhaAtual || !verifyPassword(senhaAtual, userWithPassword.senha_hash)) {
          sendJson(res, 401, { error: "Informe sua senha atual corretamente para alterar a senha." });
          return;
        }
      }

      const duplicateUsers = await supabaseRequest(
        USERS_TABLE,
        `?usuario=eq.${encodeURIComponent(usuario)}&id=neq.${encodeURIComponent(currentUser.id)}&select=id`
      );
      if (Array.isArray(duplicateUsers) && duplicateUsers.length) {
        sendJson(res, 409, { error: "Este usuário de login já está em uso." });
        return;
      }

      const updates = { nome, usuario };
      if (novaSenha) updates.senha_hash = hashPassword(novaSenha);

      const data = await supabaseRequest(
        USERS_TABLE,
        `?id=eq.${encodeURIComponent(currentUser.id)}`,
        { method: "PATCH", body: JSON.stringify(updates) }
      );
      const publicUser = buildPublicUser(data[0] || { ...currentUser, nome, usuario });
      sendJson(res, 200, { user: publicUser }, { "Set-Cookie": createSessionCookie(publicUser) });
      return;
    }

    if (req.method === "DELETE") {
      sendJson(res, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
      return;
    }

    sendJson(res, 405, { error: "Método não suportado." });
  } catch (error) {
    console.error("Erro na API de autenticação:", error);
    sendJson(res, error.statusCode || 500, { error: error.message || "Erro interno ao processar autenticação." });
  }
};
