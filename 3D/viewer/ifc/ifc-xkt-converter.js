// Converte IFC → XKT num Web Worker e guarda o resultado no navegador (IndexedDB).
//
// Por que o XKT abre rápido e o IFC travava: o XKT já vem triangulado e compactado; o IFC
// precisa ter o texto STEP interpretado e toda a geometria gerada. Antes isso acontecia na
// thread da página (Pyodide + IfcOpenShell), então a tela congelava até terminar.
// Agora:
//   1. a conversão roda no worker (vendor/ifc-xkt-worker.js) — a página continua fluida;
//   2. o resultado é um XKT, carregado pelo mesmo caminho rápido dos modelos do servidor
//      (e que a compatibilização, a cobertura Wi-Fi e o traçado de circuitos já sabem ler);
//   3. o XKT fica em cache pelo conteúdo do arquivo: abrir o mesmo IFC de novo é imediato.

const CONVERTER_VERSION = "web-ifc-0.0.70/xeokit-convert-1.3.2/v1";
const DEFAULT_EXCLUDE_TYPES = ["IfcSpace", "IfcOpeningElement"];
const WORKER_URL = new URL("../vendor/ifc-xkt-worker.js", import.meta.url);
const WASM_PATH = new URL("../vendor/", import.meta.url).href;

const DB_NAME = "bim-ifc-xkt-cache";
const STORE = "xkt";
const CACHE_LIMIT_BYTES = 600 * 1024 ** 2;
const CACHE_LIMIT_ENTRIES = 30;

// IFC grande usa várias vezes o tamanho do arquivo em memória durante a conversão.
const MAX_PARALLEL = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));

export function isIfcFile(file) {
    return /\.ifc$/i.test(file?.name || "");
}

export function isWorkerConversionSupported() {
    return typeof Worker === "function" && typeof WebAssembly === "object";
}

// ---------------------------------------------------------------------------
// Cache (IndexedDB). Qualquer falha aqui só desliga o cache, nunca a conversão.
// ---------------------------------------------------------------------------
let dbPromise = null;

function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
        try {
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => resolve(null);
            request.onblocked = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
    return dbPromise;
}

function tx(db, mode, run) {
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction(STORE, mode);
            const result = run(transaction.objectStore(STORE));
            transaction.oncomplete = () => resolve(result?.result ?? null);
            transaction.onerror = () => resolve(null);
            transaction.onabort = () => resolve(null);
        } catch {
            resolve(null);
        }
    });
}

async function cacheGet(key) {
    const db = await openDb();
    if (!db) return null;
    const entry = await tx(db, "readonly", (store) => store.get(key));
    if (entry?.blob) {
        // marca como usado agora (o descarte apaga primeiro os mais antigos)
        void tx(db, "readwrite", (store) => store.put({ ...entry, usedAt: Date.now() }));
    }
    return entry || null;
}

async function cachePut(entry) {
    const db = await openDb();
    if (!db) return;
    await tx(db, "readwrite", (store) => store.put(entry));
    const all = (await tx(db, "readonly", (store) => store.getAll())) || [];
    all.sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
    let total = 0;
    const drop = [];
    all.forEach((item, index) => {
        total += item.bytes || 0;
        if (index >= CACHE_LIMIT_ENTRIES || (index > 0 && total > CACHE_LIMIT_BYTES)) drop.push(item.key);
    });
    if (drop.length) await tx(db, "readwrite", (store) => drop.forEach((key) => store.delete(key)));
}

export async function clearIfcXktCache() {
    const db = await openDb();
    if (db) await tx(db, "readwrite", (store) => store.clear());
}

async function cacheKeyFor(file, buffer) {
    try {
        if (crypto?.subtle) {
            const digest = await crypto.subtle.digest("SHA-256", buffer);
            const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
            return `${CONVERTER_VERSION}|sha256:${hex}`;
        }
    } catch { /* sem crypto.subtle (http sem TLS): usa nome+tamanho+data */ }
    return `${CONVERTER_VERSION}|${file.name}|${file.size}|${file.lastModified}`;
}

// ---------------------------------------------------------------------------
// Fila de workers
// ---------------------------------------------------------------------------
let running = 0;
const waiting = [];

function acquireSlot() {
    if (running < MAX_PARALLEL) {
        running += 1;
        return Promise.resolve();
    }
    return new Promise((resolve) => waiting.push(resolve)).then(() => { running += 1; });
}

function releaseSlot() {
    running -= 1;
    waiting.shift()?.();
}

function runWorker(buffer, { excludeTypes, onStage }) {
    return new Promise((resolve, reject) => {
        let worker;
        try {
            worker = new Worker(WORKER_URL);
        } catch (error) {
            reject(error);
            return;
        }
        const finish = (fn, value) => {
            worker.terminate(); // devolve toda a memória do WebAssembly ao sistema
            fn(value);
        };
        worker.onmessage = ({ data }) => {
            if (data?.type === "progress") onStage?.(data.stage);
            else if (data?.type === "done") finish(resolve, data);
            else if (data?.type === "error") finish(reject, new Error(data.message));
        };
        worker.onerror = (event) => {
            event.preventDefault?.();
            finish(reject, new Error(event?.message || "Falha ao iniciar o conversor de IFC."));
        };
        worker.postMessage({ type: "convert", buffer, excludeTypes, wasmPath: WASM_PATH }, [buffer]);
    });
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const jobs = new Map(); // File -> conversão em andamento (reaproveitada por quem abrir o mesmo arquivo)
const done = new WeakMap(); // File -> resultado já pronto (conversão antecipada terminou antes de abrir)

/**
 * Converte um arquivo .ifc em um File .xkt.
 * @param {File} file
 * @param {{ onProgress?: (text: string) => void, excludeTypes?: string[] }} [options]
 * @returns {Promise<{ file: File, cached: boolean, stats: object|null, seconds: number }>}
 */
export function convertIfcFileToXkt(file, { onProgress, excludeTypes = DEFAULT_EXCLUDE_TYPES } = {}) {
    if (done.has(file)) return Promise.resolve(done.get(file));
    const listeners = jobs.get(file)?.listeners;
    if (listeners) {
        if (onProgress) listeners.add(onProgress);
        return jobs.get(file).promise;
    }

    const job = { listeners: new Set(onProgress ? [onProgress] : []), promise: null };
    const started = performance.now();
    let stage = "Na fila de conversão…";
    const emit = () => {
        const seconds = Math.round((performance.now() - started) / 1000);
        const text = seconds >= 2 ? `${stage} (${seconds} s)` : stage;
        job.listeners.forEach((fn) => { try { fn(text); } catch { /* interface */ } });
    };
    const setStage = (text) => { stage = text; emit(); };
    const ticker = setInterval(emit, 1000);

    job.promise = (async () => {
        const xktName = `${file.name.replace(/\.ifc$/i, "")}.xkt`;
        setStage("Lendo arquivo IFC…");
        const buffer = await file.arrayBuffer();
        const key = await cacheKeyFor(file, buffer);

        const hit = await cacheGet(key);
        if (hit?.blob) {
            setStage("IFC já convertido antes — abrindo do cache…");
            return {
                file: new File([hit.blob], xktName, { type: "application/octet-stream" }),
                cached: true,
                stats: hit.stats || null,
                seconds: (performance.now() - started) / 1000
            };
        }

        setStage("Na fila de conversão…");
        await acquireSlot();
        let result;
        try {
            setStage("Preparando conversor…");
            result = await runWorker(buffer, { excludeTypes, onStage: setStage });
        } finally {
            releaseSlot();
        }

        const blob = new Blob([result.xkt], { type: "application/octet-stream" });
        void cachePut({ key, name: file.name, bytes: blob.size, blob, stats: result.stats, usedAt: Date.now() });
        setStage("Convertido — abrindo modelo…");
        return {
            file: new File([blob], xktName, { type: "application/octet-stream" }),
            cached: false,
            stats: result.stats || null,
            seconds: (performance.now() - started) / 1000
        };
    })().then((result) => {
        done.set(file, result);
        return result;
    }).finally(() => {
        clearInterval(ticker);
        jobs.delete(file);
    });

    jobs.set(file, job);
    return job.promise;
}

/** Começa a converter vários IFC de uma vez (respeitando o limite de workers). */
export function prewarmIfcFiles(files) {
    if (!isWorkerConversionSupported()) return;
    for (const file of files || []) {
        if (isIfcFile(file)) convertIfcFileToXkt(file).catch(() => { /* tratado ao abrir */ });
    }
}
