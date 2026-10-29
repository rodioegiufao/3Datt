"use strict";
// Processo separado (utilityProcess do Electron / child_process no teste) que converte IFC → XKT
// com web-ifc + xeokit-convert. Roda fora da interface: a janela continua fluida e vários
// arquivos podem ser convertidos ao mesmo tempo, um por núcleo.

const fs = require("node:fs");
const path = require("node:path");

const port = process.parentPort
    ? { send: (m) => process.parentPort.postMessage(m), on: (cb) => process.parentPort.on("message", (e) => cb(e.data)) }
    : { send: (m) => process.send(m), on: (cb) => process.on("message", cb) };

// Mensagens do xeokit-convert → etapas legíveis para a barra de progresso
const STAGES = [
    [/Reading input file/i, "Lendo arquivo IFC…"],
    [/Input file size/i, "Interpretando IFC (web-ifc)…"],
    [/Converting/i, "Gerando geometria…"],
    [/parsed OK/i, "Montando modelo XKT…"],
    [/built OK/i, "Compactando XKT…"],
    [/Writing XKT/i, "Gravando no cache…"]
];

async function convert({ src, out, excludeTypes, minTileSize }) {
    const started = Date.now();
    const send = (stage) => port.send({ type: "progress", stage, elapsed: Date.now() - started });
    send("Carregando conversor…");

    const [{ convert2xkt }, WebIFC] = await Promise.all([
        import("@xeokit/xeokit-convert/src/convert2xkt.js"),
        import("web-ifc")
    ]);

    send("Lendo arquivo IFC…");
    const sourceData = fs.readFileSync(src);
    const tmp = `${out}.${process.pid}.part`;
    let stats = null;

    try {
      await convert2xkt({
        WebIFC,
        sourceData,
        sourceFormat: "ifc",
        output: tmp,
        excludeTypes,
        minTileSize,
        reuseGeometries: true,
        includeTextures: true,
        includeNormals: true,
        outputStats: (s) => { stats = { ...s }; },
        log: (message) => {
            for (const [pattern, stage] of STAGES) {
                if (pattern.test(message)) { send(stage); break; }
            }
        }
      });
    } catch (error) {
        try { fs.unlinkSync(tmp); } catch { /* nada gravado */ }
        throw error;
    }

    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.renameSync(tmp, out);
    return {
        seconds: (Date.now() - started) / 1000,
        objects: stats?.numObjects ?? null,
        triangles: stats?.numTriangles ?? null,
        xktVersion: stats?.xktVersion ?? null,
        xktBytes: fs.statSync(out).size
    };
}

port.on(async (job) => {
    try {
        const result = await convert(job);
        port.send({ type: "done", result });
    } catch (error) {
        port.send({ type: "error", message: String(error?.message || error) });
    }
});

port.send({ type: "ready" });
