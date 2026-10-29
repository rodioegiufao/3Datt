"use strict";
const { app, BrowserWindow, Menu, dialog, shell, ipcMain, clipboard } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Prefs } = require("./prefs");
const gpu = require("./gpu");
const { startServer } = require("./server");
const { IfcConverter, defaultConcurrency } = require("./ifc-converter");
const { loadCatalog, projectStatus, prefetchAll } = require("./projects");
const { patchReport } = require("./patches");

const OPENABLE = /\.(ifc|xkt|glb)$/i;
const prefs = new Prefs(app.getPath("userData"));

// ----------------------------------------------------------------------------- antes do "ready"
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}
const { safeMode, preset: startupPreset } = gpu.applyGpuSwitches(app, prefs);

const siteDir = app.isPackaged ? path.join(process.resourcesPath, "site") : path.resolve(__dirname, "..", "..");
const rendererDir = path.join(__dirname, "..", "renderer");
const cacheRoot = app.getPath("userData");
const converter = new IfcConverter({ cacheDir: path.join(cacheRoot, "xkt-cache") });

let mainWindow = null;
let local = null;
let catalog = [];
let gpuReport = null;
let pendingOpens = [];
let gpuCrashes = 0;

// ----------------------------------------------------------------------------- utilidades
function boostConfig() {
    if (process.env.BIMD_DISABLE_BOOST) return { disabled: true };
    const quality = prefs.get("quality");
    const preset = gpu.presetFor(quality);
    return {
        version: app.getVersion(),
        quality,
        qualityLabel: preset.label,
        preset,
        loadConcurrency: Math.max(2, Math.min(6, os.cpus().length)),
        showHud: prefs.get("showHud")
    };
}

function cleanRendererName(renderer = "") {
    const angle = renderer.match(/^ANGLE \(([^,]+),\s*(.+?)(?:\s+Direct3D.*|\s+\(0x.*|,\s*[^,]*)\)$/);
    return (angle ? angle[2] : renderer).replace(/\s+/g, " ").trim();
}

async function gpuStatus() {
    let hw = null;
    try { hw = gpu.describeGpuInfo(await app.getGPUInfo("complete")); } catch { /* indisponível */ }
    const renderer = gpuReport?.renderer || "";
    let warning = "";
    if (renderer && gpu.isSoftwareRenderer(renderer)) {
        warning = "Renderização por software: a placa de vídeo não está sendo usada. Atualize o driver ou troque o backend em Desempenho.";
    } else if (renderer && hw?.hasDiscrete && !/nvidia|geforce|quadro|rtx|radeon|amd/i.test(renderer)) {
        warning = "Há uma GPU dedicada, mas o app está na integrada. Ative Desempenho → Forçar GPU dedicada e reinicie.";
    }
    return { summary: renderer ? cleanRendererName(renderer) : "", renderer, warning, hardware: hw, webgl: gpuReport };
}

function broadcast(channel, payload) {
    for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload);
}

function notifyRenderer(text, { error = false, ms = 6000 } = {}) {
    mainWindow?.webContents.send("desktop:event", { type: "toast", text, error, ms });
}

// ----------------------------------------------------------------------------- abrir arquivos
function openPaths(paths) {
    const valid = (paths || []).filter((p) => typeof p === "string" && OPENABLE.test(p) && fs.existsSync(p));
    if (!valid.length || !local) return false;
    valid.forEach((p) => prefs.addRecent(p));
    pendingOpens.push(...valid);
    const ifcs = valid.filter((p) => /\.ifc$/i.test(p));
    if (ifcs.length > 1) ifcs.forEach((p) => converter.convert(p).catch(() => {})); // já começa a converter em paralelo
    if (!mainWindow) return true;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    const current = new URL(mainWindow.webContents.getURL() || local.url);
    if (/^\/3D\/ifc_upload(\.html)?$/.test(current.pathname)) {
        mainWindow.webContents.send("desktop:event", { type: "open-pending" });
    } else {
        mainWindow.loadURL(`${local.url}/3D/ifc_upload`);
    }
    return true;
}

function filesFromArgv(argv) {
    return argv.slice(1).filter((a) => !a.startsWith("-") && OPENABLE.test(a)).map((a) => path.resolve(a));
}

async function showOpenDialog() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Abrir modelos",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Modelos BIM", extensions: ["ifc", "xkt", "glb"] }]
    });
    if (!result.canceled) openPaths(result.filePaths);
}

async function addModelsDir() {
    const result = await dialog.showOpenDialog(mainWindow, {
        title: "Pasta com modelos (estrutura 3D\\<projeto>\\*.xkt ou arquivos soltos)",
        properties: ["openDirectory", "multiSelections"]
    });
    if (result.canceled) return false;
    const dirs = [...new Set([...prefs.get("modelsDirs"), ...result.filePaths])];
    prefs.set({ modelsDirs: dirs });
    buildMenu();
    return true;
}

async function prefetch(sender) {
    if (!prefs.get("remoteEnabled")) {
        dialog.showMessageBox(mainWindow, { type: "info", message: "O download do site está desativado.", detail: "Ative em Arquivo → Buscar modelos no site." });
        return;
    }
    const send = (payload) => sender?.send("desktop:event", { type: "prefetch-progress", ...payload });
    const result = await prefetchAll(catalog, local, (p) => {
        send(p);
        mainWindow?.setProgressBar(p.total ? p.done / p.total : -1);
    });
    mainWindow?.setProgressBar(-1);
    const ok = result.total - result.failed;
    dialog.showMessageBox(mainWindow, {
        type: result.failed ? "warning" : "info",
        message: result.total ? `${ok} de ${result.total} modelos baixados para uso offline.` : "Todos os modelos já estavam disponíveis offline.",
        detail: result.failed ? "Os que faltaram não foram encontrados no site. Use Arquivo → Adicionar pasta de modelos." : ""
    });
}

// ----------------------------------------------------------------------------- menu
function setPrefAndRestart(patch, message) {
    prefs.set(patch);
    buildMenu();
    dialog.showMessageBox(mainWindow, {
        type: "question", buttons: ["Reiniciar agora", "Depois"], defaultId: 0, cancelId: 1,
        message, detail: "Esta opção vale a partir do próximo início do aplicativo."
    }).then(({ response }) => { if (response === 0) { app.relaunch(); app.exit(0); } });
}

function setQuality(quality) {
    const msaaChanged = gpu.presetFor(quality).msaa !== startupPreset.msaa;
    prefs.set({ quality });
    broadcast("desktop:config", boostConfig());
    buildMenu();
    if (msaaChanged) notifyRenderer(`Antialias de hardware ${gpu.presetFor(quality).msaa}x passa a valer ao reiniciar o aplicativo.`, { ms: 7000 });
}

async function showDiagnostics() {
    const status = await gpuStatus();
    const feature = app.getGPUFeatureStatus();
    const hw = status.hardware;
    const lines = [
        `WebGL: ${status.renderer || "(abra um modelo para medir)"}`,
        status.webgl ? `WebGL2: ${status.webgl.webgl2 ? "sim" : "não"} · MSAA: ${status.webgl.samples}x · textura máx.: ${status.webgl.maxTextureSize}` : "",
        "",
        "Placas detectadas:",
        ...(hw?.devices?.length ? hw.devices.map((d) => `  ${d.active ? "●" : "○"} ${d.vendor} ${d.name || `0x${Number(d.deviceId).toString(16)}`} (driver ${d.driver || "?"})`) : ["  (não informado)"]),
        "",
        `WebGL: ${feature.webgl} · WebGL2: ${feature.webgl2} · rasterização: ${feature.gpu_compositing}`,
        `Qualidade: ${gpu.presetFor(prefs.get("quality")).label} · MSAA solicitado: ${startupPreset.msaa}x`,
        `GPU dedicada forçada: ${prefs.get("forceDedicatedGpu") ? "sim" : "não"} · backend: ${prefs.get("angle")} · FPS desbloqueado: ${prefs.get("unlockFps") ? "sim" : "não"}${safeMode ? " · MODO DE SEGURANÇA" : ""}`,
        `CPU: ${os.cpus()[0]?.model?.trim()} (${os.cpus().length} threads) · RAM: ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB`,
        `Conversões IFC em paralelo: ${converter.concurrency} · heap JS: ${gpu.rendererHeapMb()} MB`,
        "",
        "Ajustes no visualizador:",
        ...patchReport().map((p) => `  ${p.status === "applied" ? "✓" : p.status === "missing" ? "✗" : "·"} ${p.id}`)
    ].filter((l) => l !== null);
    const { response } = await dialog.showMessageBox(mainWindow, {
        type: status.warning ? "warning" : "info",
        title: "Diagnóstico de GPU",
        message: status.warning || "A placa de vídeo está em uso.",
        detail: lines.join("\n"),
        buttons: ["OK", "Copiar", "Abrir chrome://gpu"]
    });
    if (response === 1) clipboard.writeText(`${status.warning}\n${lines.join("\n")}`);
    if (response === 2) {
        const win = new BrowserWindow({ width: 1000, height: 800, title: "chrome://gpu" });
        win.setMenu(null);
        win.loadURL("chrome://gpu");
    }
}

function togglePresentation() {
    if (!mainWindow) return;
    const on = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(on);
    mainWindow.setMenuBarVisibility(!on);
}

function buildMenu() {
    const q = prefs.get("quality");
    const angle = prefs.get("angle");
    const go = (p) => mainWindow?.loadURL(local.url + p);
    const dirs = prefs.get("modelsDirs");
    const isWin = process.platform === "win32";
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: "Arquivo", submenu: [
                { label: "Início", accelerator: "CmdOrCtrl+H", click: () => go("/") },
                { label: "Abrir modelos IFC / XKT / GLB…", accelerator: "CmdOrCtrl+O", click: showOpenDialog },
                { type: "separator" },
                { label: "Adicionar pasta de modelos…", click: addModelsDir },
                {
                    label: "Pastas de modelos", enabled: dirs.length > 0, submenu: dirs.length ? [
                        ...dirs.map((d) => ({ label: d, click: () => shell.openPath(d) })),
                        { type: "separator" },
                        { label: "Remover todas", click: () => { prefs.set({ modelsDirs: [] }); buildMenu(); } }
                    ] : [{ label: "(nenhuma)", enabled: false }]
                },
                { type: "separator" },
                { label: "Buscar modelos ausentes no site", type: "checkbox", checked: prefs.get("remoteEnabled"), click: (i) => { prefs.set({ remoteEnabled: i.checked }); } },
                { label: "Baixar todos os modelos para uso offline…", click: () => prefetch(mainWindow?.webContents) },
                { type: "separator" },
                { role: "quit", label: "Sair" }
            ]
        },
        {
            label: "Exibir", submenu: [
                { label: "Modo apresentação (tela cheia)", accelerator: "F11", click: togglePresentation },
                { label: "Painel de desempenho (FPS/GPU)", accelerator: "F3", click: () => mainWindow?.webContents.send("desktop:event", { type: "toggle-hud" }) },
                { type: "separator" },
                { label: "Recarregar", accelerator: "F5", click: () => mainWindow?.webContents.reload() },
                { role: "resetZoom", label: "Zoom da interface padrão" },
                { role: "zoomIn", label: "Aumentar interface" },
                { role: "zoomOut", label: "Diminuir interface" },
                { type: "separator" },
                { role: "toggleDevTools", label: "Ferramentas do desenvolvedor" }
            ]
        },
        {
            label: "Desempenho", submenu: [
                ...["max", "balanced", "performance"].map((key) => ({
                    label: `Qualidade ${gpu.QUALITY_PRESETS[key].label.toLowerCase()}`,
                    type: "radio", checked: q === key, click: () => setQuality(key)
                })),
                { type: "separator" },
                { label: "Forçar GPU dedicada", type: "checkbox", checked: prefs.get("forceDedicatedGpu"), click: (i) => setPrefAndRestart({ forceDedicatedGpu: i.checked }, i.checked ? "GPU dedicada será usada." : "O Windows escolherá a GPU.") },
                { label: "Desbloquear FPS (acima da taxa do monitor)", type: "checkbox", checked: prefs.get("unlockFps"), click: (i) => setPrefAndRestart({ unlockFps: i.checked }, "Limite de FPS alterado.") },
                {
                    label: "Backend gráfico", submenu: [
                        ["auto", "Automático (recomendado)"], ...(isWin ? [["d3d11", "Direct3D 11"]] : []), ["gl", "OpenGL"], ["vulkan", "Vulkan (experimental)"]
                    ].map(([value, label]) => ({ label, type: "radio", checked: angle === value, click: () => setPrefAndRestart({ angle: value }, `Backend gráfico: ${label}.`) }))
                },
                { type: "separator" },
                { label: "Diagnóstico de GPU…", click: showDiagnostics },
                { label: "Reiniciar em modo de segurança (driver com problema)", click: () => { app.relaunch({ args: [...process.argv.slice(1), "--safe-mode"] }); app.exit(0); } }
            ]
        },
        {
            label: "Perfil", submenu: [
                { label: "Completo (todas as ferramentas)", type: "radio", checked: prefs.get("profile") !== "cliente", click: () => { prefs.set({ profile: "admin" }); mainWindow?.webContents.reload(); } },
                { label: "Cliente (apresentação, ferramentas restritas)", type: "radio", checked: prefs.get("profile") === "cliente", click: () => { prefs.set({ profile: "cliente" }); mainWindow?.webContents.reload(); } }
            ]
        },
        {
            label: "Cache", submenu: [
                { label: "Abrir pasta de cache", click: () => shell.openPath(cacheRoot) },
                { label: "Limpar conversões de IFC", click: () => { converter.clear(); notifyRenderer("Conversões de IFC apagadas."); } },
                { label: "Limpar modelos baixados do site", click: () => { fs.rmSync(path.join(cacheRoot, "model-cache"), { recursive: true, force: true }); notifyRenderer("Modelos baixados apagados."); mainWindow?.webContents.send("desktop:event", { type: "refresh" }); } }
            ]
        },
        {
            label: "Ajuda", submenu: [
                {
                    label: "Sobre", click: () => dialog.showMessageBox(mainWindow, {
                        type: "info", title: "BIM Viewer Desktop", message: `BIM Viewer Desktop ${app.getVersion()}`,
                        detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\nDados e cache: ${cacheRoot}`
                    })
                }
            ]
        }
    ]));
}

// ----------------------------------------------------------------------------- IPC
function registerIpc() {
    ipcMain.handle("ifc:convert", async (event, { filePath, jobId }) => {
        if (typeof filePath !== "string" || !/\.ifc$/i.test(filePath) || !fs.existsSync(filePath)) {
            throw new Error("Arquivo IFC não encontrado.");
        }
        const result = await converter.convert(filePath, (progress) => {
            if (!event.sender.isDestroyed()) event.sender.send("ifc:progress", { jobId, progress });
        });
        prefs.addRecent(filePath);
        return {
            url: `/__desktop/cache/${result.key}.xkt`,
            name: path.basename(filePath),
            cached: result.cached,
            seconds: result.seconds ?? 0,
            objects: result.objects ?? null
        };
    });
    ipcMain.on("ifc:prewarm", (_e, paths) => {
        (Array.isArray(paths) ? paths : []).filter((p) => /\.ifc$/i.test(p) && fs.existsSync(p))
            .forEach((p) => converter.convert(p).catch(() => {}));
    });
    ipcMain.handle("open:dialog", () => showOpenDialog());
    ipcMain.handle("open:paths", (_e, paths) => openPaths(paths));
    ipcMain.handle("open:take", () => {
        const items = pendingOpens.map((p) => (/\.ifc$/i.test(p)
            ? { name: path.basename(p), ifcPath: p }
            : { name: path.basename(p), url: local.registerFile(p) }));
        pendingOpens = [];
        return items;
    });
    ipcMain.handle("desktop:action", async (event, name) => {
        if (name === "add-models-dir") return addModelsDir();
        if (name === "prefetch") return prefetch(event.sender);
        return null;
    });
    ipcMain.on("gpu:report", (_e, info) => {
        if (!info || typeof info !== "object") return;
        const first = !gpuReport;
        gpuReport = info;
        if (first) {
            gpuStatus().then((s) => {
                if (s.warning) notifyRenderer(s.warning, { error: true, ms: 15000 });
                console.log(`[desktop] GPU em uso: ${s.summary}`);
            });
        }
    });
}

// ----------------------------------------------------------------------------- janela
function createWindow() {
    const saved = prefs.get("window") || {};
    mainWindow = new BrowserWindow({
        width: saved.width || 1500,
        height: saved.height || 920,
        x: saved.x, y: saved.y,
        minWidth: 960, minHeight: 620,
        title: "BIM Viewer Desktop",
        backgroundColor: "#16191d",
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            webSecurity: true,
            backgroundThrottling: false,
            spellcheck: false,
            v8CacheOptions: "bypassHeatCheck"
        }
    });
    if (saved.maximized !== false) mainWindow.maximize();
    mainWindow.once("ready-to-show", () => mainWindow.show());

    const wc = mainWindow.webContents;
    wc.setWindowOpenHandler(({ url }) => {
        if (url.startsWith(`${local.url}/`) || url.startsWith("blob:")) {
            return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true } } };
        }
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
        return { action: "deny" };
    });
    wc.on("will-navigate", (event, target) => {
        if (target.startsWith(`${local.url}/`) || target === local.url) return;
        event.preventDefault();
        if (/^https?:\/\//.test(target)) shell.openExternal(target);
    });
    wc.on("did-finish-load", () => raiseProcessPriority());
    wc.on("render-process-gone", (_e, details) => {
        if (details.reason === "clean-exit") return;
        dialog.showMessageBox(mainWindow, {
            type: "error", buttons: ["Recarregar", "Fechar"],
            message: "O visualizador parou de responder.",
            detail: details.reason === "oom"
                ? "Faltou memória para o modelo. Tente a qualidade Desempenho ou feche outros programas."
                : `Motivo: ${details.reason}`
        }).then(({ response }) => { if (response === 0) wc.reload(); });
    });

    const saveBounds = () => {
        if (!mainWindow || mainWindow.isFullScreen()) return;
        prefs.set({ window: { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() } });
    };
    mainWindow.on("close", saveBounds);
    mainWindow.on("closed", () => { mainWindow = null; });
    mainWindow.loadURL(`${local.url}/`);
}

// Prioridade "acima do normal" para os processos de GPU e da página 3D (fluidez ao apresentar)
function raiseProcessPriority() {
    try {
        for (const m of app.getAppMetrics()) {
            if (m.type === "GPU" || m.type === "Tab") os.setPriority(m.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
        }
    } catch { /* sem permissão: ignora */ }
}

// ----------------------------------------------------------------------------- ciclo de vida
app.on("second-instance", (_e, argv) => {
    const files = filesFromArgv(argv);
    if (files.length) openPaths(files);
    else if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});

app.on("child-process-gone", (_e, details) => {
    if (details.type !== "GPU" || details.reason === "clean-exit") return;
    gpuCrashes++;
    if (gpuCrashes === 2 && !safeMode) {
        dialog.showMessageBox(mainWindow, {
            type: "warning", buttons: ["Reiniciar em modo de segurança", "Continuar"], defaultId: 0,
            message: "O driver da placa de vídeo travou duas vezes.",
            detail: "O modo de segurança usa o backend OpenGL e não força a GPU dedicada. Atualizar o driver da placa costuma resolver."
        }).then(({ response }) => { if (response === 0) { app.relaunch({ args: [...process.argv.slice(1), "--safe-mode"] }); app.exit(0); } });
    }
});

async function boot() {
    // Windows: registra o .exe como "Alto desempenho" (vale a partir do próximo início do processo)
    const isPortable = Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
    if (!safeMode) {
        const changed = await gpu.syncWindowsGpuPreference(prefs.get("forceDedicatedGpu"));
        if (changed && !isPortable && !process.argv.includes("--gpu-pref-applied")) {
            app.relaunch({ args: [...process.argv.slice(1), "--gpu-pref-applied"] });
            app.exit(0);
            return;
        }
    }

    const { net } = require("electron");
    local = await startServer({
        siteDir,
        rendererDir,
        nodeModulesDirs: [path.join(app.getAppPath(), "node_modules")],
        remoteCacheDir: path.join(cacheRoot, "model-cache"),
        conversionCacheDir: converter.cacheDir,
        getModelsDirs: () => prefs.get("modelsDirs"),
        getPrefs: () => prefs.data,
        getBoostConfig: boostConfig,
        fetchImpl: (url, init) => net.fetch(url, init),
        preferredPort: prefs.get("port"),
        getState: async () => ({
            version: app.getVersion(),
            qualityLabel: gpu.presetFor(prefs.get("quality")).label,
            gpu: await gpuStatus(),
            projects: projectStatus(catalog, local.findLocal),
            recent: prefs.get("recent").filter((p) => fs.existsSync(p)).map((p) => ({ path: p, name: path.basename(p), dir: path.dirname(p) })),
            patches: patchReport(),
            conversionConcurrency: converter.concurrency
        })
    });
    catalog = await loadCatalog(siteDir).catch((error) => { console.error("[desktop] catálogo:", error); return []; });
    setTimeout(() => converter.trimCache(), 15000);

    registerIpc();
    buildMenu();
    createWindow();

    const files = filesFromArgv(process.argv);
    if (files.length) mainWindow.webContents.once("did-finish-load", () => openPaths(files));
    if (process.env.BIMD_SMOKE) runSmokeTest(process.env.BIMD_SMOKE);
}

// Teste automático de fumaça (desenvolvimento): BIMD_SMOKE=/3D/farmacia npx electron .
function runSmokeTest(target) {
    const wc = mainWindow.webContents;
    const logs = [];
    wc.on("console-message", (event) => logs.push(`${event.level}: ${event.message}`.slice(0, 300)));
    wc.once("did-finish-load", () => {
        if (target !== "/") wc.loadURL(local.url + target);
        setTimeout(async () => {
            const probe = await wc.executeJavaScript(`(() => {
                const D = window.__BIM_DESKTOP__ || {};
                const v = D.viewer;
                return {
                    hooked: Boolean(v), perfMode: D.perfMode, navScale: D.navScale,
                    resolutionScale: v?.scene?.canvas?.resolutionScale,
                    canvas: v ? [v.scene.canvas.canvas.width, v.scene.canvas.canvas.height] : null,
                    models: v ? Object.keys(v.scene.models) : [],
                    objects: v ? Object.keys(v.scene.objects).length : 0,
                    preserve: v?.scene?.canvas?.gl?.getContextAttributes?.().preserveDrawingBuffer,
                    samples: v?.scene?.canvas?.gl?.getParameter?.(v.scene.canvas.gl.SAMPLES),
                    user: window.__VIEWER_AUTH_USER__?.perfil || null,
                    uploadApi: Boolean(window.ifcUploadApi),
                    fastNav: D.fastNav ? { rest: D.fastNav.defaultScaleCanvasResolutionFactor, nav: D.fastNav.scaleCanvasResolutionFactor } : null,
                    snapshotPixels: (() => { try { const u = document.getElementById('meuCanvas').toDataURL('image/png'); return u.length; } catch (e) { return String(e); } })()
                };
            })()`).catch((e) => ({ error: String(e) }));
            const image = await wc.capturePage();
            fs.writeFileSync(process.env.BIMD_SMOKE_PNG || path.join(os.tmpdir(), "bimd-smoke.png"), image.toPNG());
            console.log("SMOKE " + JSON.stringify({ probe, gpu: gpuReport, errors: logs.filter((l) => /^(2|3|error|warning)/.test(l)).slice(0, 25) }, null, 1));
            app.exit(0);
        }, Number(process.env.BIMD_SMOKE_WAIT || 25000));
    });
}

app.whenReady().then(boot).catch((error) => {
    dialog.showErrorBox("Falha ao abrir o BIM Viewer Desktop", String(error?.stack || error));
    app.quit();
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { local?.close(); });

module.exports = { defaultConcurrency };
