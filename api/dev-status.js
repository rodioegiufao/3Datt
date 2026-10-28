// Diagnóstico do modo sem login. Não expõe segredos: só mostra se as variáveis existem.
const { getRequestHost, isAuthDisabled, isAuthDisabledByEnv, isDevHost, sendJson } = require("./_auth");

module.exports = function devStatus(req, res) {
  const raw = process.env.DISABLE_AUTH;
  sendJson(res, 200, {
    host: getRequestHost(req),
    vercelEnv: process.env.VERCEL_ENV || null,
    disableAuthDefinida: raw !== undefined,
    disableAuthValor: raw === undefined ? null : JSON.stringify(raw),
    liberadoPelaVariavel: isAuthDisabledByEnv(),
    liberadoPeloDominio: isDevHost(req),
    loginDispensado: isAuthDisabled(req),
    devLoginDefinido: Boolean(process.env.DEV_LOGIN),
    supabaseConfigurado: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  }, { "Cache-Control": "no-store" });
};
