const { requireInternalUser } = require("./_auth");
const DEFAULT_MODEL = 'plantas-4eu8q';
const DEFAULT_VERSION = 2;
const DEFAULT_CONFIDENCE = 55;
const DEFAULT_TIMEOUT_MS = 30000;

function json(res, statusCode, payload) {
    res.status(statusCode).json(payload);
}

function obterApiKeyPrivada() {
    return process.env.ROBOFLOW_API_KEY || process.env.ROBOFLOW_PRIVATE_API_KEY || null;
}

function sanitizarPayload(body = {}) {
    const image = typeof body.image === 'string' ? body.image : '';
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : DEFAULT_MODEL;
    const version = Number.isFinite(Number(body.version)) ? Number(body.version) : DEFAULT_VERSION;
    const confidence = Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : DEFAULT_CONFIDENCE;
    const timeoutMs = Number.isFinite(Number(body.timeoutMs)) ? Number(body.timeoutMs) : DEFAULT_TIMEOUT_MS;

    return {
        image,
        model,
        version,
        confidence,
        timeoutMs: Math.max(1000, Math.min(timeoutMs, 120000))
    };
}

module.exports = async function detectPlantasHandler(req, res) {
    try { await requireInternalUser(req); } catch (error) { return json(res, error.statusCode || 500, { error: error.message }); }
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return json(res, 405, { error: 'Método não permitido. Use POST.' });
    }

    const apiKey = obterApiKeyPrivada();

    if (!apiKey || apiKey.startsWith('rf_x')) {
        return json(res, 500, {
            error: 'ROBOFLOW_API_KEY não configurada no backend.'
        });
    }

    const payload = sanitizarPayload(req.body);
    if (!payload.image || !payload.image.includes(',')) {
        return json(res, 400, { error: 'Campo image inválido. Envie Data URL base64.' });
    }

    const base64Image = payload.image.split(',')[1];
    const url = `https://detect.roboflow.com/${encodeURIComponent(payload.model)}/${encodeURIComponent(payload.version)}?api_key=${encodeURIComponent(apiKey)}&confidence=${encodeURIComponent(payload.confidence)}`;

    const controller = new AbortController();
    const timerId = setTimeout(() => controller.abort(), payload.timeoutMs);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: base64Image,
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            return json(res, response.status, {
                error: data?.error || `Roboflow retornou HTTP ${response.status}.`,
                details: data
            });
        }

        return json(res, 200, data);
    } catch (error) {
        const isAbort = error?.name === 'AbortError';

        return json(res, isAbort ? 504 : 502, {
            error: isAbort
                ? 'Timeout ao consultar o Roboflow.'
                : `Falha ao consultar o Roboflow: ${error.message || 'erro desconhecido'}`
        });
    } finally {
        clearTimeout(timerId);
    }
};
