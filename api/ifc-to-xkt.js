const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { createClient } = require("@supabase/supabase-js");

const MIN_SUSPICIOUS_XKT_SIZE_BYTES = 50 * 1024;
const LARGE_IFC_SIZE_BYTES = 500 * 1024;
const MAX_UPLOAD_SIZE_BYTES = 250 * 1024 * 1024;
const SUPABASE_BUCKET = "ifc-conversions"; // Crie este bucket no Supabase Storage; pode ser privado.

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function safeBaseName(fileName) {
  return path.basename(String(fileName || "modelo.ifc")).replace(/[^a-zA-Z0-9._-]/g, "_");
}

function baseNameWithoutIfc(fileName) {
  return safeBaseName(fileName).replace(/\.ifc$/i, "") || "modelo";
}

function ensureLowercaseIfcExtension(fileName) {
  const safeName = safeBaseName(fileName);
  return safeName.toLowerCase().endsWith(".ifc")
    ? `${baseNameWithoutIfc(safeName)}.ifc`
    : safeName;
}

function getUploadedFile(files) {
  const candidate = files?.file || files?.ifc || files?.upload || Object.values(files || {})[0];
  return Array.isArray(candidate) ? candidate[0] : candidate;
}

function isMultipart(req) {
  return String(req.headers["content-type"] || "").toLowerCase().includes("multipart/form-data");
}

function isJson(req) {
  return String(req.headers["content-type"] || "").toLowerCase().includes("application/json");
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk.toString("utf8");
      if (raw.length > 1024 * 1024) {
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
    throw new Error("Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY na Vercel para usar o fluxo de Storage.");
  }

  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
}

function validateStoragePath(storagePath) {
  const normalized = String(storagePath || "").trim();
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.includes("..") ||
    !normalized.toLowerCase().endsWith(".ifc") ||
    !/^[a-zA-Z0-9._/-]+$/.test(normalized)
  ) {
    throw new Error("storagePath inválido.");
  }
  return normalized;
}

function parseMultipartForm(req) {
  return new Promise((resolve, reject) => {
    let formidableModule;
    try {
      formidableModule = require("formidable");
    } catch (error) {
      reject(new Error("Dependência 'formidable' não instalada. Execute npm install."));
      return;
    }

    const createForm = formidableModule.formidable || formidableModule.default || formidableModule;
    const form = createForm({
      keepExtensions: true,
      maxFileSize: MAX_UPLOAD_SIZE_BYTES,
      multiples: false,
      uploadDir: os.tmpdir()
    });

    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ fields, files });
    });
  });
}

function findConvertCommand() {
  const localBin = path.join(process.cwd(), "node_modules", ".bin");
  const candidates = [
    { command: path.join(localBin, "xeokit-convert"), args: [] },
    { command: path.join(localBin, "convert2xkt"), args: [] },
    { command: process.execPath, args: [path.join(process.cwd(), "node_modules", "@xeokit", "xeokit-convert", "convert2xkt.js")] }
  ];

  return candidates.find((candidate) => fs.existsSync(candidate.command) || candidate.command === process.execPath) || candidates[0];
}

function getExpectedWebIfcWasmPath() {
  return path.join(process.cwd(), "node_modules", "web-ifc", "web-ifc-node.wasm");
}

function getWebIfcWasmCandidates() {
  return [
    getExpectedWebIfcWasmPath(),
    path.join(process.cwd(), "node_modules", "web-ifc", "web-ifc.wasm"),
    path.join(process.cwd(), "node_modules", "@xeokit", "xeokit-convert", "node_modules", "web-ifc", "web-ifc-node.wasm"),
    path.join(process.cwd(), "node_modules", "@xeokit", "xeokit-convert", "node_modules", "web-ifc", "web-ifc.wasm")
  ];
}

function findWebIfcWasmPath() {
  return getWebIfcWasmCandidates().find((candidate) => fs.existsSync(candidate));
}

async function copyWasmToTmp(source) {
  const tmpWebIfcDir = path.join(os.tmpdir(), "web-ifc");
  const tmpWasmPath = path.join(tmpWebIfcDir, "web-ifc-node.wasm");

  await fs.promises.mkdir(tmpWebIfcDir, { recursive: true });
  await fs.promises.copyFile(source, tmpWasmPath);

  return tmpWasmPath;
}

async function ensureWebIfcWasm() {
  const expectedPath = getExpectedWebIfcWasmPath();

  if (fs.existsSync(expectedPath)) {
    return expectedPath;
  }

  const source = getWebIfcWasmCandidates()
    .filter((candidate) => candidate !== expectedPath)
    .find((candidate) => fs.existsSync(candidate));

  if (!source) {
    throw new Error("Não foi encontrado nenhum arquivo WASM do web-ifc. Instale a dependência 'web-ifc'.");
  }

  try {
    await fs.promises.mkdir(path.dirname(expectedPath), { recursive: true });
    await fs.promises.copyFile(source, expectedPath);
    return expectedPath;
  } catch (error) {
    console.warn("[ifc-to-xkt] Não foi possível copiar o WASM para node_modules; usando /tmp.", error);
    return copyWasmToTmp(source);
  }
}

function logWebIfcDiagnostics(wasmPath) {
  console.log("[ifc-to-xkt] cwd:", process.cwd());
  console.log("[ifc-to-xkt] node_modules web-ifc existe:", fs.existsSync(path.join(process.cwd(), "node_modules", "web-ifc")));
  console.log("[ifc-to-xkt] web-ifc-node.wasm existe:", fs.existsSync(getExpectedWebIfcWasmPath()));
  console.log("[ifc-to-xkt] web-ifc.wasm existe:", fs.existsSync(path.join(process.cwd(), "node_modules", "web-ifc", "web-ifc.wasm")));
  console.log("[ifc-to-xkt] wasm usado:", wasmPath);
}

function isWebIfcWasmError(error) {
  const message = error?.message || String(error || "");
  return /web-ifc.*wasm|wasm.*web-ifc|web-ifc-node\.wasm|web-ifc\.wasm|failed to asynchronously prepare wasm|ENOENT/i.test(message);
}

function convertIfcToXkt(inputIfcPath, outputXktPath, wasmPath) {
  return new Promise((resolve, reject) => {
    const converter = findConvertCommand();
    const args = [...converter.args, "-s", inputIfcPath, "-o", outputXktPath];
    const wasmDir = path.dirname(wasmPath);
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";

    console.log(`[ifc-to-xkt] Usando conversor: ${converter.command} ${args.join(" ")}`);

    const proc = spawn(converter.command, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        WEB_IFC_WASM_PATH: wasmDir,
        WEBIFC_WASM_PATH: wasmDir,
        WEB_IFC_PATH: wasmDir,
        NODE_PATH: path.join(process.cwd(), "node_modules")
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      console.log(`[ifc-to-xkt] ${chunk.toString().trim()}`);
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      console.error(`[ifc-to-xkt] ${chunk.toString().trim()}`);
    });

    proc.on("error", reject);
    proc.on("close", (code) => {
      const elapsedMs = Date.now() - startedAt;
      console.log(`[ifc-to-xkt] Tempo de conversão: ${elapsedMs}ms`);

      if (code !== 0) {
        reject(new Error(`convert2xkt finalizou com código ${code}. ${stderr || stdout || "Sem detalhes."}`));
        return;
      }

      resolve({ elapsedMs, stdout, stderr });
    });
  });
}

function cleanup(paths) {
  paths.forEach((filePath) => {
    if (!filePath) return;
    fs.promises.unlink(filePath).catch(() => {});
  });
}

async function convertLocalIfc({ inputIfcPath, outputXktPath }) {
  const ifcSize = (await fs.promises.stat(inputIfcPath)).size;
  console.log(`[ifc-to-xkt] Tamanho do IFC: ${ifcSize} bytes`);

  const wasmPath = await ensureWebIfcWasm();
  logWebIfcDiagnostics(wasmPath);

  if (!wasmPath) {
    throw new Error("Arquivo web-ifc-node.wasm não encontrado. Adicione 'web-ifc' nas dependencies do package.json e faça novo deploy.");
  }

  await convertIfcToXkt(inputIfcPath, outputXktPath, wasmPath);

  if (!fs.existsSync(outputXktPath)) {
    throw new Error("A conversão terminou, mas o arquivo XKT não foi criado.");
  }

  const xktSize = (await fs.promises.stat(outputXktPath)).size;
  console.log(`[ifc-to-xkt] Tamanho do XKT: ${xktSize} bytes`);
  console.log("[ifc-to-xkt] XKT gerado:", xktSize);

  if (xktSize === 0) {
    throw new Error("O XKT gerado ficou com 0 bytes. A conversão falhou.");
  }

  if (ifcSize > LARGE_IFC_SIZE_BYTES && xktSize < MIN_SUSPICIOUS_XKT_SIZE_BYTES) {
    throw new Error("O XKT gerado ficou muito pequeno em relação ao IFC. A conversão provavelmente falhou.");
  }

  return { ifcSize, xktSize };
}

async function handleJsonStorageConversion(req, res, tempPaths) {
  const body = await readJsonBody(req);
  const storagePath = validateStoragePath(body.storagePath);
  const originalName = safeBaseName(body.originalName || path.basename(storagePath));

  console.log("[ifc-to-xkt] storagePath:", storagePath);

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.storage.from(SUPABASE_BUCKET).download(storagePath);
  if (error) {
    throw new Error(`Não foi possível baixar o IFC do Supabase Storage: ${error.message}`);
  }

  const ifcBuffer = Buffer.from(await data.arrayBuffer());
  const uniquePrefix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const outputName = `${baseNameWithoutIfc(originalName)}.xkt`;
  const inputIfcPath = path.join(os.tmpdir(), `${uniquePrefix}-${ensureLowercaseIfcExtension(originalName)}`);
  const outputXktPath = path.join(os.tmpdir(), `${uniquePrefix}-${outputName}`);
  tempPaths.push(inputIfcPath, outputXktPath);

  await fs.promises.writeFile(inputIfcPath, ifcBuffer);
  const ifcSize = ifcBuffer.length;
  console.log("[ifc-to-xkt] IFC baixado do Supabase:", ifcSize);

  const sizes = await convertLocalIfc({ inputIfcPath, outputXktPath });
  const xktBuffer = await fs.promises.readFile(outputXktPath);
  const outputPath = `outputs/${new Date().toISOString().slice(0, 10)}/${uniquePrefix}-${outputName}`;

  const upload = await supabase.storage.from(SUPABASE_BUCKET).upload(outputPath, xktBuffer, {
    contentType: "application/octet-stream",
    upsert: true
  });
  if (upload.error) {
    throw new Error(`Não foi possível salvar o XKT no Supabase Storage: ${upload.error.message}`);
  }

  console.log("[ifc-to-xkt] outputPath:", outputPath);

  if (storagePath.startsWith("uploads/")) {
    const removeUpload = await supabase.storage
      .from(SUPABASE_BUCKET)
      .remove([storagePath]);

    if (removeUpload.error) {
      console.warn("[ifc-to-xkt] Não foi possível remover IFC original:", removeUpload.error.message);
    }
  } else {
    console.warn("[ifc-to-xkt] IFC original não foi removido porque está fora de uploads/:", storagePath);
  }

  const signed = await supabase.storage.from(SUPABASE_BUCKET).createSignedUrl(outputPath, 60 * 60);
  if (signed.error) {
    throw new Error(`Não foi possível criar URL assinada para download: ${signed.error.message}`);
  }

  sendJson(res, 200, {
    ok: true,
    downloadUrl: signed.data.signedUrl,
    outputPath,
    fileName: outputName,
    ifcSize: sizes.ifcSize,
    xktSize: sizes.xktSize
  });
}

async function handleMultipartConversion(req, res, tempPaths) {
  const { files } = await parseMultipartForm(req);
  const file = getUploadedFile(files);

  if (!file) {
    sendJson(res, 400, { error: "Nenhum arquivo IFC foi enviado." });
    return;
  }

  let uploadedPath = file.filepath || file.path;
  tempPaths.push(uploadedPath);
  const originalName = safeBaseName(file.originalFilename || file.name || "modelo.ifc");

  if (!originalName.toLowerCase().endsWith(".ifc")) {
    sendJson(res, 400, { error: "Envie um arquivo com extensão .ifc." });
    return;
  }

  const uniquePrefix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const normalizedInputName = ensureLowercaseIfcExtension(originalName);
  const inputIfcPath = path.join(os.tmpdir(), `${uniquePrefix}-${normalizedInputName}`);
  const outputXktPath = path.join(os.tmpdir(), `${uniquePrefix}-${baseNameWithoutIfc(originalName)}.xkt`);
  tempPaths.push(inputIfcPath, outputXktPath);

  await fs.promises.rename(uploadedPath, inputIfcPath);
  tempPaths.splice(tempPaths.indexOf(uploadedPath), 1);

  const { xktSize } = await convertLocalIfc({ inputIfcPath, outputXktPath });
  const downloadName = path.basename(outputXktPath).replace(`${uniquePrefix}-`, "");
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Content-Disposition", `attachment; filename=\"${downloadName}\"`);
  res.setHeader("Content-Length", String(xktSize));

  const stream = fs.createReadStream(outputXktPath);
  stream.on("close", () => cleanup(tempPaths));
  stream.on("error", (error) => {
    console.error("[ifc-to-xkt] Erro ao enviar XKT", error);
    cleanup(tempPaths);
    if (!res.headersSent) sendJson(res, 500, { error: "Erro ao enviar o arquivo XKT gerado." });
  });
  stream.pipe(res);
}
const { require3DUser } = require("./_auth");
async function ifcToXktHandler(req, res) {
  const tempPaths = [];

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    sendJson(res, 405, { error: "Método não permitido. Use POST com JSON de storagePath ou multipart/form-data para arquivos pequenos." });
    return;
  }

  try {
    await require3DUser(req);
    if (isJson(req)) {
      await handleJsonStorageConversion(req, res, tempPaths);
      cleanup(tempPaths);
      return;
    }

    if (isMultipart(req)) {
      await handleMultipartConversion(req, res, tempPaths);
      return;
    }

    sendJson(res, 415, { error: "Content-Type não suportado. Use application/json com storagePath ou multipart/form-data para arquivos pequenos." });
  } catch (error) {
    console.error("[ifc-to-xkt] Erro detalhado:", error);
    cleanup(tempPaths);
    const message = isWebIfcWasmError(error)
      ? "Falha na conversão: o arquivo WASM do web-ifc não foi encontrado no servidor. Adicione a dependência web-ifc ao package.json e faça novo deploy na Vercel."
      : error.message || "Falha ao converter IFC para XKT.";
    sendJson(res, error.statusCode || 500, { error: message });
  }
}

module.exports = ifcToXktHandler;
module.exports.config = {
  api: {
    bodyParser: false
  }
};
