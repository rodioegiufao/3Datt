const { createClient } = require("@supabase/supabase-js");

const SHARE_TTL_MS = 60 * 60 * 1000;
const SUPABASE_BUCKET = "ifc-conversions";
const SHARE_STORAGE_PREFIX = "share-models";
const STORE = globalThis.__ifcShareStore || new Map();
const SHARE_BODY_SIZE_LIMIT = "110mb";
globalThis.__ifcShareStore = STORE;

let supabaseClient = null;

function getSupabaseClient() {
    if (supabaseClient) return supabaseClient;

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        return null;
    }

    supabaseClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    return supabaseClient;
}

function parseRequestBody(req) {
    if (!req?.body) return {};

    if (typeof req.body === "string") {
        try {
            return JSON.parse(req.body);
        } catch (_error) {
            return {};
        }
    }

    if (typeof req.body === "object") return req.body;

    return {};
}

function cleanupExpiredShares() {
    const now = Date.now();
    for (const [shareCode, shareData] of STORE.entries()) {
        if (isExpiredShare(shareData, now)) {
            STORE.delete(shareCode);
        }
    }
}

function isExpiredShare(shareData, now = Date.now()) {
    const expiresAtMs = Date.parse(shareData?.expiresAt || "");
    return !Number.isFinite(expiresAtMs) || expiresAtMs <= now;
}

function buildShareCode() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `share-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function sendJson(res, statusCode, payload) {
    res
        .status(statusCode)
        .setHeader("Content-Type", "application/json; charset=utf-8")
        .send(JSON.stringify(payload));
}

function resolveRequestOrigin(req) {
    if (typeof req.headers?.origin === "string" && req.headers.origin.trim()) {
        return req.headers.origin;
    }

    const proto = req.headers?.["x-forwarded-proto"] || "https";
    const host = req.headers?.host || "";
    return host ? `${proto}://${host}` : "";
}

function buildShareStoragePath(shareCode) {
    return `${SHARE_STORAGE_PREFIX}/${shareCode}.json`;
}

async function persistShare(shareCode, shareData) {
    STORE.set(shareCode, shareData);

    const supabase = getSupabaseClient();
    if (!supabase) {
        console.warn("[share-models] Supabase não configurado; compartilhamento mantido apenas em memória.");
        return { persisted: false, warning: "Compartilhamento salvo apenas em memória do servidor." };
    }

    const { error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(buildShareStoragePath(shareCode), JSON.stringify(shareData), {
            contentType: "application/json; charset=utf-8",
            upsert: true
        });

    if (error) {
        console.warn("[share-models] Falha ao salvar no Supabase Storage; usando fallback em memória:", error.message);
        return {
            persisted: false,
            warning: `Compartilhamento salvo apenas em memória do servidor: ${error.message}`
        };
    }
    return { persisted: true };
}

async function removePersistedShare(shareCode) {
    STORE.delete(shareCode);

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const { error } = await supabase.storage.from(SUPABASE_BUCKET).remove([buildShareStoragePath(shareCode)]);
    if (error) {
        console.warn("[share-models] Falha ao remover compartilhamento expirado:", error.message);
    }
}

async function readPersistedShare(shareCode) {
    const memoryShare = STORE.get(shareCode);
    if (memoryShare) return memoryShare;

    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(buildShareStoragePath(shareCode));
    if (error) {
        if (error.statusCode !== "404" && error.statusCode !== 404) {
            console.warn("[share-models] Falha ao ler compartilhamento do Supabase Storage:", error.message);
        }
        return null;
    }

    const shareData = JSON.parse(await data.text());
    STORE.set(shareCode, shareData);
    return shareData;
}

function sanitizeShareCode(rawShareCode) {
    if (typeof rawShareCode !== "string") return "";

    let shareCode = rawShareCode.trim();
    if (!shareCode) return "";

    shareCode = shareCode.replace(/^[\["'(]+/, "").replace(/[\]"')]+$/, "");
    shareCode = shareCode.replace(/[.,;!?]+$/, "");

    return shareCode;
}

async function shareModelsHandler(req, res) {
    cleanupExpiredShares();

    if (req.method === "POST") {
        const body = parseRequestBody(req);
        const files = Array.isArray(body?.files) ? body.files : [];
        const annotations = Array.isArray(body?.annotations) ? body.annotations : [];

        if (!files.length) {
            sendJson(res, 400, { error: "Nenhum arquivo recebido para compartilhar." });
            return;
        }

        const normalizedFiles = files
            .map((file) => ({
                name: typeof file?.name === "string" ? file.name : "modelo-compartilhado.ifc",
                type:
                    typeof file?.type === "string" && file.type.trim()
                        ? file.type
                        : "application/octet-stream",
                encoding: file?.encoding === "gzip+base64" ? "gzip+base64" : "base64",
                contentBase64: typeof file?.contentBase64 === "string" ? file.contentBase64 : ""
            }))
            .filter((file) => file.contentBase64.length > 0);

        if (!normalizedFiles.length) {
            sendJson(res, 400, { error: "Arquivos inválidos para compartilhamento." });
            return;
        }
        
        const normalizedAnnotations = annotations
            .map((annotation) => ({
                id: typeof annotation?.id === "string" ? annotation.id : "",
                title: typeof annotation?.title === "string" ? annotation.title.slice(0, 120) : "Anotação",
                text: typeof annotation?.text === "string" ? annotation.text.slice(0, 500) : "",
                worldPos: Array.isArray(annotation?.worldPos)
                    ? annotation.worldPos.slice(0, 3).map((value) => Number(value))
                    : []
            }))
            .filter((annotation) => annotation.text && annotation.worldPos.length === 3 && annotation.worldPos.every(Number.isFinite));

        const shareCode = buildShareCode();
        const expiresAt = new Date(Date.now() + SHARE_TTL_MS).toISOString();
        
        let persistenceResult = { persisted: false };

        try {
            persistenceResult = await persistShare(shareCode, {
                files: normalizedFiles,
                annotations: normalizedAnnotations,
                createdAt: new Date().toISOString(),
                expiresAt
            });
        } catch (error) {
            console.error("[share-models]", error);
            sendJson(res, 500, { error: error.message || "Erro ao salvar compartilhamento." });
            return;
        }

        sendJson(res, 201, {
            shareCode,
            shareLink: `${resolveRequestOrigin(req)}/3D/ifc_upload?share=${encodeURIComponent(shareCode)}`,
            expiresAt,
            persisted: Boolean(persistenceResult?.persisted),
            warning: persistenceResult?.warning || undefined
        });
        return;
    }

    if (req.method === "GET") {
        const rawShareCode = typeof req.query?.share === "string" ? req.query.share : "";
        const shareCode = sanitizeShareCode(rawShareCode);
        if (!shareCode) {
            sendJson(res, 400, { error: "Código de compartilhamento não informado." });
            return;
        }

        let shareData = null;
        try {
            shareData = await readPersistedShare(shareCode);
        } catch (error) {
            console.error("[share-models]", error);
            sendJson(res, 500, { error: "Erro ao recuperar compartilhamento." });
            return;
        }

        if (!shareData) {
            sendJson(res, 404, { error: "Compartilhamento não encontrado." });
            return;
        }

        if (isExpiredShare(shareData)) {
            await removePersistedShare(shareCode);
            sendJson(res, 404, { error: "Compartilhamento expirado." });
            return;
        }

        sendJson(res, 200, {
            files: shareData.files,
            annotations: Array.isArray(shareData.annotations) ? shareData.annotations : [],
            expiresAt: shareData.expiresAt
        });
        return;
    }

    sendJson(res, 405, { error: "Método não suportado." });
}

module.exports = shareModelsHandler;
module.exports.config = {
    api: {
        bodyParser: {
            sizeLimit: SHARE_BODY_SIZE_LIMIT
        }
    }
};
