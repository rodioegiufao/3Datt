const SUPABASE_BUCKET = "ifc-conversions";

function normalizeSupabaseProjectUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    return String(value || "").trim();
  }
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    sendJson(res, 405, { ok: false, error: "Método não permitido." });
    return;
  }

  const supabaseUrl = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    sendJson(res, 500, {
      ok: false,
      error: "Supabase Storage não configurado. Configure SUPABASE_URL e SUPABASE_ANON_KEY na Vercel."
    });
    return;
  }

  sendJson(res, 200, {
    supabaseUrl,
    supabaseAnonKey,
    bucket: SUPABASE_BUCKET
  });
};
