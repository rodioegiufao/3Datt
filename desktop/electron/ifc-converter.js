"use strict";
// Fila de conversão IFC → XKT com cache em disco.
// - Cada arquivo roda num processo próprio (não trava a janela; memória devolvida ao terminar).
// - Vários IFC em paralelo, limitado por núcleos e memória RAM.
// - Cache por caminho + tamanho + data de modificação: abrir o mesmo IFC de novo é instantâneo.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const CONVERTER_VERSION = "xeokit-convert-1.3.2/web-ifc-0.0.70/v1";
const EXCLUDE_TYPES = ["IfcSpace", "IfcOpeningElement"];
const MIN_TILE_SIZE = 1000;
const CACHE_LIMIT_BYTES = 20 * 1024 ** 3; // 20 GB

function defaultConcurrency() {
    const cores = os.cpus()?.length || 2;
    const ramGb = os.totalmem() / 1024 ** 3;
    // IFC grande pode usar ~8x o tamanho do arquivo em memória durante a conversão
    return Math.max(1, Math.min(cores - 1, Math.floor(ramGb / 6), 4));
}

function workerHeapMb() {
    const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
    return Math.max(2048, Math.min(4096, Math.floor(totalMb * 0.6)));
}

/**
 * spawnWorker(): retorna { send(msg), onMessage(cb), onExit(cb), kill() }.
 * No Electron usa utilityProcess; nos testes (Node puro) usa child_process.fork.
 */
function defaultSpawn(workerPath) {
    let utilityProcess = null;
    try { ({ utilityProcess } = require("electron")); } catch { /* Node puro */ }
    const execArgv = [`--max-old-space-size=${workerHeapMb()}`];
    if (utilityProcess && typeof utilityProcess.fork === "function") {
        const child = utilityProcess.fork(workerPath, [], { serviceName: "Conversor IFC", execArgv, stdio: "inherit" });
        return {
            send: (m) => child.postMessage(m),
            onMessage: (cb) => child.on("message", cb),
            onExit: (cb) => child.on("exit", cb),
            kill: () => child.kill()
        };
    }
    const { fork } = require("node:child_process");
    const child = fork(workerPath, [], { execArgv, stdio: ["ignore", "inherit", "inherit", "ipc"] });
    return {
        send: (m) => child.send(m),
        onMessage: (cb) => child.on("message", cb),
        onExit: (cb) => child.on("exit", cb),
        kill: () => child.kill()
    };
}

class IfcConverter {
    constructor({ cacheDir, workerPath = path.join(__dirname, "ifc-worker.js"), concurrency = defaultConcurrency(), spawn = defaultSpawn }) {
        this.cacheDir = cacheDir;
        this.workerPath = workerPath;
        this.concurrency = concurrency;
        this.spawn = spawn;
        this.jobs = new Map();     // key -> Promise
        this.listeners = new Map(); // key -> Set<fn>
        this.queue = [];
        this.running = 0;
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    keyFor(filePath) {
        const st = fs.statSync(filePath);
        return crypto.createHash("sha1")
            .update([path.resolve(filePath).toLowerCase(), st.size, Math.floor(st.mtimeMs), CONVERTER_VERSION].join("|"))
            .digest("hex");
    }

    cachedPath(key) {
        return path.join(this.cacheDir, `${key}.xkt`);
    }

    /** Converte (ou reaproveita o cache). onProgress({ stage, elapsed, queued }) */
    convert(filePath, onProgress = () => {}) {
        const key = this.keyFor(filePath);
        const out = this.cachedPath(key);
        if (fs.existsSync(out)) {
            const now = new Date();
            try { fs.utimesSync(out, now, now); } catch { /* só para o LRU */ }
            return Promise.resolve({ key, file: out, cached: true });
        }
        if (!this.listeners.has(key)) this.listeners.set(key, new Set());
        this.listeners.get(key).add(onProgress);
        if (this.jobs.has(key)) return this.jobs.get(key);

        const promise = new Promise((resolve, reject) => {
            this.queue.push({ key, filePath, out, resolve, reject });
            this.emit(key, { stage: "Na fila de conversão…", elapsed: 0, queued: true });
            this.pump();
        }).finally(() => {
            this.jobs.delete(key);
            this.listeners.delete(key);
        });
        this.jobs.set(key, promise);
        return promise;
    }

    emit(key, progress) {
        for (const fn of this.listeners.get(key) || []) {
            try { fn(progress); } catch { /* janela fechada */ }
        }
    }

    pump() {
        while (this.running < this.concurrency && this.queue.length) {
            const job = this.queue.shift();
            this.running++;
            this.run(job).finally(() => {
                this.running--;
                this.pump();
            });
        }
    }

    run({ key, filePath, out, resolve, reject }) {
        return new Promise((done) => {
            let settled = false;
            const finish = (fn, value) => {
                if (settled) return;
                settled = true;
                fn(value);
                done();
            };
            let worker;
            try {
                worker = this.spawn(this.workerPath);
            } catch (error) {
                finish(reject, error);
                return;
            }
            worker.onMessage((msg) => {
                if (msg?.type === "ready") {
                    worker.send({ src: filePath, out, excludeTypes: EXCLUDE_TYPES, minTileSize: MIN_TILE_SIZE });
                } else if (msg?.type === "progress") {
                    this.emit(key, { stage: msg.stage, elapsed: msg.elapsed, queued: false });
                } else if (msg?.type === "done") {
                    finish(resolve, { key, file: out, cached: false, ...msg.result });
                    worker.kill();
                } else if (msg?.type === "error") {
                    finish(reject, new Error(msg.message));
                    worker.kill();
                }
            });
            worker.onExit((code) => {
                finish(reject, new Error(`O conversor IFC encerrou inesperadamente (código ${code}). O arquivo pode ser grande demais para a memória disponível.`));
            });
        });
    }

    /** Mantém o cache abaixo do limite apagando os mais antigos (LRU por data de acesso). */
    trimCache(limitBytes = CACHE_LIMIT_BYTES) {
        let entries = [];
        try {
            entries = fs.readdirSync(this.cacheDir)
                .filter((name) => name.endsWith(".xkt"))
                .map((name) => {
                    const file = path.join(this.cacheDir, name);
                    const st = fs.statSync(file);
                    return { file, size: st.size, time: st.mtimeMs };
                });
        } catch { return; }
        let total = entries.reduce((sum, e) => sum + e.size, 0);
        entries.sort((a, b) => a.time - b.time);
        for (const entry of entries) {
            if (total <= limitBytes) break;
            try { fs.unlinkSync(entry.file); total -= entry.size; } catch { /* em uso */ }
        }
        // restos de conversões interrompidas
        try {
            for (const name of fs.readdirSync(this.cacheDir)) {
                if (name.endsWith(".part")) fs.rmSync(path.join(this.cacheDir, name), { force: true });
            }
        } catch { /* ok */ }
    }

    clear() {
        for (const name of fs.readdirSync(this.cacheDir)) {
            fs.rmSync(path.join(this.cacheDir, name), { force: true });
        }
    }
}

module.exports = { IfcConverter, defaultConcurrency, CONVERTER_VERSION };
