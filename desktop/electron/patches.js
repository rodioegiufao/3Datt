"use strict";
// Ajustes aplicados NA HORA DE SERVIR os arquivos do site para o aplicativo desktop.
//
// Por quê assim: o código do site (pasta 3D/) continua exatamente igual ao que vai para a Vercel.
// O desktop só acrescenta "ganchos" que chamam window.__BIM_DESKTOP__ (definido em renderer/boost.js).
// Se o site mudar e algum trecho não for encontrado, o arquivo é servido sem aquele ajuste
// (o visualizador funciona, só perde aquela otimização) e o teste `npm test` acusa.

const PATCHES = [
    {
        id: "compat-mode-desktop",
        file: "/3D/viewer/viewer-authenticated.js",
        description: "Não entra em 'modo compatibilidade' só por ter 4 núcleos/≤4 GB informados pelo navegador",
        find: "const useCompatibilityMode =",
        replace: "const useCompatibilityMode = window.__BIM_DESKTOP__ ? !supportsWebGL2 :"
    },
    {
        id: "load-concurrency",
        file: "/3D/viewer/viewer-authenticated.js",
        description: "Mais modelos baixados/decodificados em paralelo",
        find: /export const MODEL_LOAD_CONCURRENCY = \d+;/,
        replace: "export const MODEL_LOAD_CONCURRENCY = window.__BIM_DESKTOP__?.loadConcurrency ?? 2;"
    },
    {
        id: "viewer-hook",
        file: "/3D/viewer/viewer-authenticated.js",
        description: "Entrega o Viewer e o FastNavPlugin ao ajuste de GPU do desktop",
        find: /export const fastNavPlugin = new FastNavPlugin\(viewer, \{[\s\S]*?\r?\n\}\);/,
        replace: (match) => `${match}\nwindow.__BIM_DESKTOP__?.onViewer?.(viewer, fastNavPlugin);`
    },
    {
        id: "resize-native",
        file: "/3D/viewer/viewer-authenticated.js",
        description: "Deixa o xeokit dimensionar o canvas com a escala de resolução (nitidez em telas HiDPI)",
        find: "function onWindowResize() {",
        replace: "function onWindowResize() {\n    if (window.__BIM_DESKTOP__) return;"
    },
    {
        id: "fastnav-tune",
        file: "/3D/viewer/app/performance.js",
        description: "Resolução dinâmica e qualidade conforme o perfil de GPU escolhido",
        find: "fastNavPlugin.hidePBR = performanceModeEnabled;",
        replace: "fastNavPlugin.hidePBR = performanceModeEnabled;\n    window.__BIM_DESKTOP__?.tuneFastNav?.(fastNavPlugin, performanceModeEnabled);"
    },
    {
        id: "skip-pyodide",
        file: "/3D/app.js",
        description: "Não baixa o Pyodide (IfcOpenShell em WebAssembly): o desktop converte IFC nativamente",
        find: /await loadClassicScript\("https:\/\/cdn\.jsdelivr\.net\/pyodide\/[^"]+"\);/,
        replace: (match) => `if (!window.__BIM_DESKTOP__) ${match}`
    },
    {
        id: "ifc-prewarm",
        file: "/3D/ifc_upload.js",
        description: "Começa a converter todos os IFC selecionados em paralelo (um processo por núcleo)",
        find: "const files = Array.from(fileList || []);",
        replace: "const files = Array.from(fileList || []);\n            window.__BIM_DESKTOP__?.prewarmIfc?.(files);"
    },
    {
        id: "ifc-native-upload",
        file: "/3D/ifc_upload.js",
        description: "IFC → XKT fora da interface (processo nativo + cache em disco)",
        find: "async function loadIfcUpload(file, uploadContext = {}) {",
        replace: [
            "async function loadIfcUpload(file, uploadContext = {}) {",
            "        if (window.__BIM_DESKTOP__?.maybeConvertIfc) {",
            "            const __desktopProgress = (text) => {",
            "                try {",
            "                    updateUploadQueueItem(uploadContext.fileQueueId || \"\", { statusText: \"Convertendo\", metaText: text });",
            "                    setUploadProgress({ fileName: file.name, percentage: 100, metaText: text, statusText: \"Convertendo\" });",
            "                } catch (_) { /* interface antiga */ }",
            "            };",
            "            const __desktopXkt = await window.__BIM_DESKTOP__.maybeConvertIfc(file, __desktopProgress);",
            "            if (__desktopXkt && __desktopXkt !== file) {",
            "                return loadXktUpload(__desktopXkt, uploadContext);",
            "            }",
            "        }"
        ].join("\n")
    },
    {
        id: "ifc-native-replace",
        file: "/3D/viewer/features/model-replace.js",
        description: "Substituir modelo por IFC também usa a conversão nativa",
        find: "async function replaceModel(id, file) {",
        replace: [
            "async function replaceModel(id, file) {",
            "        if (!busy && window.__BIM_DESKTOP__?.maybeConvertIfc) {",
            "            file = await window.__BIM_DESKTOP__.maybeConvertIfc(file, (text) => showToast(text));",
            "        }"
        ].join("\n")
    }
];

function applyOne(text, patch) {
    if (typeof patch.find === "string") {
        const index = text.indexOf(patch.find);
        if (index < 0) return null;
        if (text.indexOf(patch.find, index + patch.find.length) >= 0) return null; // ambíguo: não arrisca
        const replacement = typeof patch.replace === "function" ? patch.replace(patch.find) : patch.replace;
        return text.slice(0, index) + replacement + text.slice(index + patch.find.length);
    }
    const flags = patch.find.flags.replace("g", "");
    const regex = new RegExp(patch.find.source, flags);
    const match = regex.exec(text);
    if (!match) return null;
    const replacement = typeof patch.replace === "function" ? patch.replace(match[0]) : patch.replace;
    return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length);
}

const report = new Map(); // id -> "applied" | "missing"

function applyPatches(urlPath, text) {
    let out = text;
    for (const patch of PATCHES) {
        if (patch.file !== urlPath) continue;
        const next = applyOne(out, patch);
        if (next === null) {
            report.set(patch.id, "missing");
            console.warn(`[desktop] ajuste "${patch.id}" não encontrado em ${urlPath} — servido sem ele.`);
        } else {
            report.set(patch.id, "applied");
            out = next;
        }
    }
    return out;
}

function hasPatches(urlPath) {
    return PATCHES.some((p) => p.file === urlPath);
}

function patchReport() {
    return PATCHES.map((p) => ({ id: p.id, file: p.file, description: p.description, status: report.get(p.id) || "pending" }));
}

module.exports = { PATCHES, applyPatches, applyOne, hasPatches, patchReport };
