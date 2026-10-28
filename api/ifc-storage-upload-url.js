const { createClient } = require("@supabase/supabase-js");

const SUPABASE_BUCKET = "ifc-conversions";
const SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES = 250 * 1024 * 1024;

function formatBytes(bytes) {
  const mb = Number(bytes || 0) / (1024 * 1024);
  return `${mb.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB`;
}

function getBucketFileSizeLimitBytes(bucket) {
  const rawLimit = bucket?.file_size_limit ?? bucket?.fileSizeLimit ?? bucket?.file_size_limit_bytes;
  if (rawLimit === null || rawLimit === undefined || rawLimit === "") {
    return null;
  }

  const numericLimit = Number(rawLimit);
  return Number.isFinite(numericLimit) ? numericLimit : null;
}

function assertRequestedFileFitsLimit(fileSize) {
  const numericSize = Number(fileSize || 0);
  if (Number.isFinite(numericSize) && numericSize > SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES) {
    throw new Error(
      `O arquivo tem ${formatBytes(numericSize)} e excede o limite configurado de ${formatBytes(SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES)}.`
    );
  }
}

function assertBucketAcceptsConfiguredLimit(bucket) {
  const currentLimit = getBucketFileSizeLimitBytes(bucket);
  if (currentLimit !== null && currentLimit < SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES) {
    throw new Error(
      `O bucket ${SUPABASE_BUCKET} ainda está limitado a ${formatBytes(currentLimit)} no Supabase Storage. ` +
        `Atualize o limite do bucket para pelo menos ${formatBytes(SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES)} no painel do Supabase e tente novamente.`
    );
  }
}


function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function normalizeSupabaseProjectUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return `${url.protocol}//${url.host}`;
  } catch (error) {
    return String(value || "").trim();
  }
}

function getSupabaseClient() {
  const supabaseUrl = normalizeSupabaseProjectUrl(process.env.SUPABASE_URL);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel para gerar URLs assinadas de upload.");
  }

  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function safeStorageFileName(fileName) {
  const base = String(fileName || "modelo.ifc").split(/[\\/]/).pop();
  const safeName = base
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!safeName || !safeName.toLowerCase().endsWith(".ifc")) {
    throw new Error("Envie um arquivo com extensão .ifc.");
  }

  return safeName;
}

function createUploadPath(fileName) {
  const safeName = safeStorageFileName(fileName);
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const id = `${Date.now()}${Math.random().toString(16).slice(2)}`.replace(/[^a-zA-Z0-9]/g, "");

  return `uploads/${today}/${id}_${safeName}`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 32 * 1024) {
        reject(new Error("JSON da requisição é grande demais."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error("JSON inválido."));
      }
    });
    req.on("error", reject);
  });
}

function isBucketNotFoundError(error) {
  return /not found|does not exist|bucket not found/i.test(error?.message || "");
}

function isBucketAlreadyExistsError(error) {
  return /already exists/i.test(error?.message || "");
}

async function createStorageBucket(supabase) {
  const { error } = await supabase.storage.createBucket(SUPABASE_BUCKET, {
    public: false,
    fileSizeLimit: SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES
  });

  if (!error || isBucketAlreadyExistsError(error)) {
    return;
  }

  throw error;
}

async function updateBucketFileSizeLimit(supabase) {
  const { error } = await supabase.storage.updateBucket(SUPABASE_BUCKET, {
    public: false,
    fileSizeLimit: SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES
  });

  if (error) {
    throw new Error(
      `Não foi possível atualizar o limite do bucket ${SUPABASE_BUCKET} para ${formatBytes(SUPABASE_BUCKET_FILE_SIZE_LIMIT_BYTES)}: ${error.message}`
    );
  }

  const { data: updatedBucket, error: getUpdatedError } = await supabase.storage.getBucket(SUPABASE_BUCKET);
  if (getUpdatedError) {
    throw new Error(`Não foi possível confirmar o limite do bucket ${SUPABASE_BUCKET}: ${getUpdatedError.message}`);
  }
  assertBucketAcceptsConfiguredLimit(updatedBucket);
}

async function ensureBucketExists(supabase) {
  const { data: bucket, error: getError } = await supabase.storage.getBucket(SUPABASE_BUCKET);

  if (bucket) {
    await updateBucketFileSizeLimit(supabase);
    return;
  }

  if (getError && !isBucketNotFoundError(getError)) {
    throw new Error(`Não foi possível verificar o bucket ${SUPABASE_BUCKET}: ${getError.message}`);
  }

  try {
    await createStorageBucket(supabase);
    const { data: createdBucket, error: getCreatedError } = await supabase.storage.getBucket(SUPABASE_BUCKET);
    if (getCreatedError) {
      throw new Error(`Bucket criado, mas não foi possível confirmar o limite: ${getCreatedError.message}`);
    }
    assertBucketAcceptsConfiguredLimit(createdBucket);
  } catch (error) {
    throw new Error(`Não foi possível criar o bucket ${SUPABASE_BUCKET}: ${error.message}`);
  }
}
const { require3DUser } = require("./_auth");
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { ok: false, error: "Método não permitido." });
    return;
  }

  try {
    await require3DUser(req);
    const body = await readJsonBody(req);
    assertRequestedFileFitsLimit(body.fileSize);
    const path = createUploadPath(body.fileName);
    const supabase = getSupabaseClient();

    await ensureBucketExists(supabase);

    const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).createSignedUploadUrl(path);

    if (error) {
      throw new Error(`Não foi possível gerar URL assinada de upload: ${error.message}`);
    }

    sendJson(res, 200, {
      ok: true,
      bucket: SUPABASE_BUCKET,
      path: data.path || path,
      token: data.token,
      signedUrl: data.signedUrl
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { ok: false, error: error.message || "Falha ao preparar upload IFC." });
  }
};