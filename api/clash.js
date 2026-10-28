const ALLOWED_MODES = new Set(["intersection", "collision", "clearance"]);
const { requireInternalUser } = require("./_auth");

function validIfcReference(value) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return false;
  try {
    const url = new URL(value, "https://local.invalid");
    return url.origin === "https://local.invalid" && /\.ifc(?:$|\?)/i.test(url.pathname);
  } catch (_error) {
    return false;
  }
}

function validateSet(set) {
  return set && typeof set.modelId === "string" && validIfcReference(set.ifcSrc)
    && (!set.classes || (Array.isArray(set.classes) && set.classes.every((value) => /^Ifc[A-Za-z0-9_]+$/.test(value))));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método não permitido." });
  try {
    await requireInternalUser(req);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ error: error.message });
  }
  const serviceUrl = process.env.IFC_CLASH_SERVICE_URL;
  if (!serviceUrl) return res.status(503).json({ error: "Serviço IfcClash não configurado (IFC_CLASH_SERVICE_URL)." });

  const { setA, setB, tolerance = 0.01, mode = "intersection" } = req.body || {};
  if (!validateSet(setA) || !validateSet(setB)) return res.status(400).json({ error: "Referências IFC inválidas ou não permitidas." });
  const numericTolerance = Number(tolerance);
  if (!Number.isFinite(numericTolerance) || numericTolerance < 0 || numericTolerance > 10 || !ALLOWED_MODES.has(mode)) {
    return res.status(400).json({ error: "Parâmetros de compatibilização inválidos." });
  }

  try {
    const upstream = await fetch(serviceUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.IFC_CLASH_SERVICE_TOKEN ? { Authorization: `Bearer ${process.env.IFC_CLASH_SERVICE_TOKEN}` } : {}) },
      body: JSON.stringify({ setA, setB, tolerance: numericTolerance, mode })
    });
    const body = await upstream.text();
    res.status(upstream.status).setHeader("Content-Type", upstream.headers.get("content-type") || "application/json").send(body);
  } catch (error) {
    console.error("[clash] Falha no serviço especializado:", error);
    res.status(502).json({ error: "Não foi possível executar a compatibilização." });
  }
}