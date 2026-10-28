const crypto = require("crypto");

const USERS_TABLE = "usuarios_setor";
const USER_PROFILES = Object.freeze({ ADMIN: "admin", COLLABORATOR: "colaborador", CLIENT: "cliente" });
const VALID_PROFILES = Object.freeze(Object.values(USER_PROFILES));

function normalizeUserProfile(profile) {
  const normalized = String(profile || "").trim().toLowerCase();
  return VALID_PROFILES.includes(normalized) ? normalized : USER_PROFILES.COLLABORATOR;
}

function userHasProfile(user, allowedProfiles = []) {
  return allowedProfiles.includes(user?.perfil);
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res
    .status(statusCode)
    .setHeader("Content-Type", "application/json; charset=utf-8")
    .send(JSON.stringify(payload));
}

function parseRequestBody(req) {
  if (!req?.body) return {};
  if (typeof req.body === "object") return req.body;

  try {
    return JSON.parse(req.body);
  } catch (_error) {
    return {};
  }
}

function normalizeSupabaseRestUrl(rawUrl) {
  const parsedUrl = new URL(rawUrl);
  const pathSegments = parsedUrl.pathname.split("/").filter(Boolean);
  const restIndex = pathSegments.findIndex((segment, index) => segment === "rest" && pathSegments[index + 1] === "v1");

  parsedUrl.pathname = restIndex >= 0
    ? `/${pathSegments.slice(0, restIndex + 2).join("/")}`
    : `${parsedUrl.pathname.replace(/\/$/, "")}/rest/v1`;
  parsedUrl.search = "";
  parsedUrl.hash = "";

  return parsedUrl.toString().replace(/\/$/, "");
}

function getSupabaseConfig(table) {
  const url = String(process.env.SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  if (!url || !serviceRoleKey) {
    throw new Error("As variáveis SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY precisam estar configuradas na Vercel.");
  }

  return {
    baseUrl: `${normalizeSupabaseRestUrl(url)}/${table}`,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    }
  };
}
const RETRYABLE_SUPABASE_STATUS = new Set([502, 503, 504]);
const SUPABASE_RETRY_DELAYS_MS = [150, 450];

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function supabaseError(response, data) {
  const upstreamMessage = data?.message || data?.error || "Erro ao acessar o Supabase.";
  const apiKeyFailure = /failed to get api key info/i.test(upstreamMessage);
  const error = new Error(apiKeyFailure
    ? "O Supabase recusou a chave da aplicação. Verifique SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel e faça um novo deploy."
    : upstreamMessage);

  // Um gateway indisponível é uma falha temporária do serviço, não uma resposta
  // inválida enviada pelo navegador. Retornar 503 também permite que proxies e
  // monitores classifiquem corretamente a indisponibilidade.
  error.statusCode = RETRYABLE_SUPABASE_STATUS.has(response.status) ? 503 : response.status;
  error.upstreamStatus = response.status;
  error.contentRange = response.headers?.get("content-range") || "";
  return error;
}

async function supabaseRequest(table, path = "", options = {}) {
  const { baseUrl, headers } = getSupabaseConfig(table);
  const method = String(options.method || "GET").toUpperCase();
  const retries = method === "GET" || method === "HEAD" ? SUPABASE_RETRY_DELAYS_MS.length : 0;

  let response;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          ...headers,
          ...(options.headers || {})
        }
      });
    } catch (error) {
      if (attempt === retries) {
        const unavailable = new Error("Não foi possível conectar ao Supabase. Tente novamente em alguns instantes.");
        unavailable.statusCode = 503;
        unavailable.cause = error;
        throw unavailable;
      }
      await wait(SUPABASE_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    if (!RETRYABLE_SUPABASE_STATUS.has(response.status) || attempt === retries) break;
    await response.text(); // libera a conexão antes da nova tentativa
    await wait(SUPABASE_RETRY_DELAYS_MS[attempt]);
  }

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      // Gateways can return plain text (for example, "Bad Request") instead of
      // PostgREST JSON. Preserve that response so the original HTTP status and
      // useful message reach the client rather than turning it into a JSON 500.
      data = { message: text.trim() || "Resposta inválida do Supabase." };
    }
  }

  if (!response.ok) {
    throw supabaseError(response, data);
  }
  if (method === "GET" && process.env.NODE_ENV === "development" && Array.isArray(data) && data.length === 1000) {
    console.warn(`Supabase GET ${table} retornou 1000 linhas; verifique paginação para evitar truncamento.`);
  }
  return data;
}
async function supabaseRequestTodos(table, path = "", options = {}) {
  if (String(options.method || "GET").toUpperCase() !== "GET") {
    throw new Error("supabaseRequestTodos aceita apenas leituras GET.");
  }
  const query = new URLSearchParams(path.replace(/^\?/, ""));
  if (!query.get("order")?.trim()) query.set("order", "id.asc");
  const orderedPath = `?${query.toString()}`;
  const pageSize = 1000;
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    let page;
    try {
      page = await supabaseRequest(table, orderedPath, {
        ...options,
        headers: { ...(options.headers || {}), "Range-Unit": "items", Range: `${start}-${start + pageSize - 1}` }
      });
    } catch (error) {
      // count=exact pode responder 416 no fim de um múltiplo exato de páginas.
      // Só trate como fim quando o total informado confirmar todos os itens lidos.
      if (start > 0 && error.statusCode === 416 && error.contentRange === `*/${rows.length}`) return rows;
      throw error;
    }
    if (!Array.isArray(page)) throw new Error("Resposta de lista inválida do Supabase.");
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
function requireAuthSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("A variável AUTH_SECRET precisa estar configurada na Vercel.");
  return secret;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [algorithm, salt, expectedHash] = String(passwordHash || "").split("$");
  if (algorithm !== "scrypt" || !salt || !expectedHash) return false;

  const actualHash = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, "hex");
  return expected.length === actualHash.length && crypto.timingSafeEqual(expected, actualHash);
}

function base64UrlEncode(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function base64UrlDecode(value) {
  return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
}

function sign(value) {
  return crypto.createHmac("sha256", requireAuthSecret()).update(value).digest("base64url");
}

function createSessionCookie(user) {
  const maxAge = 60 * 60 * 12;
  const payload = base64UrlEncode({
    id: user.id,
    nome: user.nome,
    usuario: user.usuario,
    perfil: user.perfil,
    exp: Date.now() + maxAge * 1000
  });
  return `atividade_session=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
  return "atividade_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0";
}

function getCookie(req, name) {
  const cookies = String(req.headers?.cookie || "").split(";").map((cookie) => cookie.trim());
  const prefix = `${name}=`;
  const found = cookies.find((cookie) => cookie.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : "";
}

function getSessionUser(req) {
  const cookie = getCookie(req, "atividade_session");
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature || signature !== sign(payload)) return null;

  const user = base64UrlDecode(payload);
  if (!user?.id || !user?.exp || user.exp < Date.now()) return null;
  return user;
}

// ---------------------------------------------------------------------------
// Modo sem login (site alternativo de desenvolvimento)
// Ative SOMENTE no projeto Vercel de testes com a variável DISABLE_AUTH=true.
// Opcional: DEV_LOGIN=<usuario> usa um usuário real do Supabase (id e perfil
// verdadeiros, sem pedir senha). Sem DEV_LOGIN, usa um administrador fictício.
// ---------------------------------------------------------------------------
const DEV_FALLBACK_USER = Object.freeze({ id: "dev", nome: "Modo desenvolvimento", usuario: "dev", perfil: USER_PROFILES.ADMIN });

// Domínios do site alternativo: neles o login é sempre dispensado, mesmo sem a
// variável DISABLE_AUTH. O site principal (engrodrigodamasceno.com.br) nunca
// entra aqui, então o mesmo código pode ir para os dois repositórios.
const DEV_HOSTS = Object.freeze(["atualizacao-one.vercel.app"]);

function getRequestHost(req) {
  const raw = req?.headers?.["x-forwarded-host"] || req?.headers?.host || "";
  return String(raw).split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
}

function isDevHost(req) {
  return DEV_HOSTS.includes(getRequestHost(req));
}

function isAuthDisabledByEnv() {
  // Aceita true/1/yes/on e ignora aspas digitadas sem querer no painel da Vercel.
  const value = String(process.env.DISABLE_AUTH || "").trim().replace(/^["']|["']$/g, "").toLowerCase();
  return ["true", "1", "yes", "sim", "on"].includes(value);
}

function isAuthDisabled(req) {
  return isAuthDisabledByEnv() || isDevHost(req);
}

async function getDevUser() {
  const devLogin = String(process.env.DEV_LOGIN || "").trim().toLowerCase();
  if (devLogin) {
    try {
      const users = await supabaseRequest(USERS_TABLE, `?usuario=eq.${encodeURIComponent(devLogin)}&ativo=eq.true&select=id,nome,usuario,perfil`);
      if (Array.isArray(users) && users[0]) return users[0];
      console.warn(`DEV_LOGIN "${devLogin}" não encontrado ou inativo; usando administrador fictício.`);
    } catch (error) {
      // Sem Supabase configurado (ou fora do ar), o site de testes continua abrindo.
      console.warn(`Não foi possível buscar DEV_LOGIN "${devLogin}" no Supabase; usando administrador fictício.`, error.message);
    }
  }
  return { ...DEV_FALLBACK_USER };
}

async function requireUser(req) {
  if (isAuthDisabled(req)) return getDevUser();

  const sessionUser = getSessionUser(req);
  if (!sessionUser) {
    const error = new Error("Faça login para continuar.");
    error.statusCode = 401;
    throw error;
  }

  const users = await supabaseRequest(USERS_TABLE, `?id=eq.${encodeURIComponent(sessionUser.id)}&ativo=eq.true&select=id,nome,usuario,perfil`);
  const user = Array.isArray(users) ? users[0] : null;
  if (!user) {
    const error = new Error("Sessão inválida ou usuário desativado.");
    error.statusCode = 401;
    throw error;
  }
  return user;
}
async function requireProfiles(req, allowedProfiles) {
  const user = await requireUser(req);
  if (!userHasProfile(user, allowedProfiles)) {
    const error = new Error("Seu perfil não possui acesso a este recurso.");
    error.statusCode = 403;
    throw error;
  }
  return user;
}

async function requireInternalUser(req) {
  return requireProfiles(req, [USER_PROFILES.ADMIN, USER_PROFILES.COLLABORATOR]);
}

async function require3DUser(req) {
  return requireProfiles(req, VALID_PROFILES);
}
async function countUsers() {
  const users = await supabaseRequestTodos(USERS_TABLE, "?select=id", { headers: { Prefer: "count=exact" } });
  return Array.isArray(users) ? users.length : 0;
}

module.exports = {
  USER_PROFILES,
  VALID_PROFILES,
  USERS_TABLE,
  clearSessionCookie,
  countUsers,
  createSessionCookie,
  hashPassword,
  getRequestHost,
  isAuthDisabled,
  isAuthDisabledByEnv,
  isDevHost,
  normalizeUserProfile,
  parseRequestBody,
  require3DUser,
  requireInternalUser,
  requireProfiles,
  requireUser,
  sendJson,
  supabaseRequest,
  supabaseRequestTodos,
  userHasProfile,
  verifyPassword
};