"use strict";
// Preferências do aplicativo (JSON na pasta de dados do usuário).
// Lidas de forma síncrona logo no início porque algumas (GPU, MSAA, backend gráfico)
// precisam ser aplicadas antes de o Electron ficar pronto.

const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = Object.freeze({
    quality: "max",              // "max" | "balanced" | "performance"
    unlockFps: false,            // remove o limite de quadros (vsync) — reinicia
    angle: "auto",               // "auto" | "d3d11" | "gl" | "vulkan" — reinicia
    forceDedicatedGpu: true,     // preferência "Alto desempenho" do Windows — reinicia
    profile: "admin",            // "admin" (completo) | "cliente" (apresentação)
    modelsDirs: [],              // pastas extras com modelos (estrutura 3D/<projeto>/*.xkt ou soltos)
    remoteEnabled: true,         // busca modelos ausentes no site e guarda em cache
    remoteOrigin: "https://www.engrodrigodamasceno.com.br",
    showHud: false,
    port: 47831,                 // porta fixa: mantém sessionStorage/IndexedDB entre execuções
    recent: [],
    window: null
});

class Prefs {
    constructor(userDataDir) {
        this.file = path.join(userDataDir, "desktop-prefs.json");
        this.data = { ...DEFAULTS };
        try {
            const stored = JSON.parse(fs.readFileSync(this.file, "utf8"));
            // migração da versão anterior (uma única pasta)
            if (stored.modelsDir && !stored.modelsDirs) stored.modelsDirs = [stored.modelsDir];
            delete stored.modelsDir;
            Object.assign(this.data, stored);
        } catch { /* primeira execução */ }
        if (!Array.isArray(this.data.modelsDirs)) this.data.modelsDirs = [];
        if (!Array.isArray(this.data.recent)) this.data.recent = [];
    }

    get(key) { return this.data[key]; }

    set(patch) {
        Object.assign(this.data, patch);
        try {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            const tmp = `${this.file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
            fs.renameSync(tmp, this.file);
        } catch (error) {
            console.error("[prefs] falha ao salvar", error);
        }
        return this.data;
    }

    addRecent(filePath) {
        const recent = [filePath, ...this.data.recent.filter((p) => p !== filePath)].slice(0, 10);
        this.set({ recent });
    }
}

module.exports = { Prefs, DEFAULTS };
