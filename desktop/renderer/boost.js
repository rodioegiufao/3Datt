// BIM Viewer Desktop — ajustes injetados nas páginas do visualizador (antes dos módulos do site).
// Não altera o comportamento no navegador: só existe dentro do aplicativo.
(() => {
    "use strict";
    const api = window.bimDesktop || null;
    let cfg = window.__BIM_DESKTOP_CONFIG__ || {};
    if (cfg.disabled) return; // comparação A/B em desenvolvimento

    // ------------------------------------------------------------------------------------------
    // 1) Contexto WebGL na GPU de alto desempenho, sem preserveDrawingBuffer no canvas principal
    // ------------------------------------------------------------------------------------------
    const MAIN_CANVAS_ID = "meuCanvas";
    const isMainCanvas = (c) => c && c.id === MAIN_CANVAS_ID && c.tagName === "CANVAS";
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, attrs) {
        if (type === "webgl2" || type === "webgl" || type === "experimental-webgl") {
            attrs = Object.assign({}, attrs, { powerPreference: "high-performance" });
            if (isMainCanvas(this)) {
                // O site usa preserveDrawingBuffer:true só para prints; aqui o print força um quadro
                // na hora (veja abaixo), e a GPU não precisa copiar a imagem a cada quadro.
                attrs.preserveDrawingBuffer = false;
                attrs.antialias = true;
            }
        }
        return nativeGetContext.call(this, type, attrs);
    };

    const D = {
        isDesktop: true,
        version: cfg.version,
        loadConcurrency: cfg.loadConcurrency || 4,
        viewer: null,
        fastNav: null,
        perfMode: false,
        navScale: null
    };
    window.__BIM_DESKTOP__ = D;

    const forceRender = () => {
        try { D.viewer?.scene?.render?.(true); } catch { /* cena ainda não pronta */ }
    };
    const wrapReadback = (proto, method, isSource) => {
        const original = proto[method];
        if (typeof original !== "function") return;
        proto[method] = function (...args) {
            if (isSource(this, args)) forceRender();
            return original.apply(this, args);
        };
    };
    wrapReadback(HTMLCanvasElement.prototype, "toDataURL", (self) => isMainCanvas(self));
    wrapReadback(HTMLCanvasElement.prototype, "toBlob", (self) => isMainCanvas(self));
    wrapReadback(CanvasRenderingContext2D.prototype, "drawImage", (_self, args) => isMainCanvas(args[0]));
    if (window.createImageBitmap) {
        const nativeCIB = window.createImageBitmap;
        window.createImageBitmap = function (source, ...rest) {
            if (isMainCanvas(source)) forceRender();
            return nativeCIB.call(this, source, ...rest);
        };
    }

    // ------------------------------------------------------------------------------------------
    // 2) Qualidade: supersampling parado + resolução dinâmica em movimento
    // ------------------------------------------------------------------------------------------
    const preset = () => cfg.preset || { restScaleMin: 1.5, restScaleMax: 2, navFloor: 0.6, hideEdgesWhileMoving: false, hideSAOWhileMoving: false, saoSamples: 20, targetFrameMs: 16.7 };
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const restScale = () => {
        const p = preset();
        return clamp(Math.max(window.devicePixelRatio || 1, p.restScaleMin), 0.5, p.restScaleMax);
    };

    function applyQuality() {
        const { viewer, fastNav } = D;
        if (!viewer || !fastNav || D.perfMode) return;
        const p = preset();
        const rest = restScale();
        if (D.navScale === null || D.navScale > rest) D.navScale = rest * 0.85;
        D.navScale = clamp(D.navScale, rest * p.navFloor, rest);
        fastNav.scaleCanvasResolution = true;
        fastNav.defaultScaleCanvasResolutionFactor = rest;
        fastNav.scaleCanvasResolutionFactor = D.navScale;
        fastNav.hideEdges = Boolean(p.hideEdgesWhileMoving);
        fastNav.hideSAO = Boolean(p.hideSAOWhileMoving);
        fastNav.hideColorTexture = false;
        fastNav.hidePBR = false;
        if (!moving) viewer.scene.canvas.resolutionScale = rest;
        const sao = viewer.scene.sao;
        if (sao && "numSamples" in sao && p.saoSamples) sao.numSamples = p.saoSamples;
        viewer.scene.glRedraw?.();
    }

    D.tuneFastNav = (fastNav, performanceModeEnabled) => {
        D.fastNav = fastNav;
        D.perfMode = Boolean(performanceModeEnabled);
        if (!D.perfMode) applyQuality();
    };

    // Resolução dinâmica: mede o tempo entre quadros enquanto a câmera se move e ajusta a escala
    // para manter ~60 FPS com a maior resolução que a placa aguenta.
    let moving = false;
    let moveTimer = 0;
    let lastRendered = 0;
    let samples = [];
    const frameTimes = []; // para o painel de FPS

    function onRendered() {
        const now = performance.now();
        frameTimes.push(now);
        while (frameTimes.length && now - frameTimes[0] > 1000) frameTimes.shift();
        if (!moving || D.perfMode) { lastRendered = 0; return; }
        if (lastRendered) samples.push(now - lastRendered);
        lastRendered = now;
        if (samples.length < 24) return;
        const sorted = samples.slice().sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        samples = [];
        const p = preset();
        const rest = restScale();
        let next = D.navScale;
        if (median > p.targetFrameMs * 1.4) next = D.navScale * 0.85;
        else if (median < p.targetFrameMs * 1.1) next = D.navScale * 1.08;
        next = clamp(next, rest * p.navFloor, rest);
        if (Math.abs(next - D.navScale) > 0.01) {
            D.navScale = next;
            if (D.fastNav) D.fastNav.scaleCanvasResolutionFactor = next;
            D.viewer.scene.canvas.resolutionScale = next;
        }
    }

    D.onViewer = (viewer, fastNav) => {
        D.viewer = viewer;
        D.fastNav = fastNav;
        viewer.scene.on("rendered", onRendered);
        viewer.scene.camera.on("matrix", () => {
            moving = true;
            clearTimeout(moveTimer);
            moveTimer = setTimeout(() => { moving = false; lastRendered = 0; samples = []; }, 250);
        });
        applyQuality();
        setTimeout(reportGpu, 0);
        if (cfg.showHud) toggleHud(true);
    };

    // ------------------------------------------------------------------------------------------
    // 3) Diagnóstico de GPU + painel de desempenho (F3)
    // ------------------------------------------------------------------------------------------
    let gpuInfo = null;
    function readGpuInfo() {
        if (gpuInfo) return gpuInfo;
        const gl = D.viewer?.scene?.canvas?.gl;
        if (!gl) return null;
        const ext = gl.getExtension("WEBGL_debug_renderer_info");
        gpuInfo = {
            renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
            vendor: ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
            webgl2: typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext,
            samples: gl.getParameter(gl.SAMPLES),
            maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE)
        };
        return gpuInfo;
    }

    function reportGpu() {
        const info = readGpuInfo();
        if (!info) return;
        api?.reportGpu?.(info);
        if (/swiftshader|basic render|llvmpipe|software/i.test(info.renderer || "")) {
            toast("A placa de vídeo não está sendo usada (renderização por software). Veja Desempenho → Diagnóstico de GPU.", { error: true, ms: 12000 });
        }
    }

    let hud = null;
    let hudTimer = 0;
    function toggleHud(force) {
        const show = typeof force === "boolean" ? force : !hud;
        if (!show) {
            clearInterval(hudTimer);
            hud?.remove();
            hud = null;
            return;
        }
        if (hud) return;
        hud = document.createElement("div");
        hud.className = "bimd-hud";
        document.body.appendChild(hud);
        const update = () => {
            const v = D.viewer;
            if (!v || !hud) return;
            const info = readGpuInfo() || {};
            const c = v.scene.canvas.canvas;
            const fps = frameTimes.length;
            hud.innerHTML = [
                `<b>${fps}</b> FPS ${moving ? "· navegando" : "· parado (renderiza só quando muda)"}`,
                `${c.width}×${c.height} px · escala ${v.scene.canvas.resolutionScale.toFixed(2)}${D.perfMode ? " · modo leve" : ""}`,
                `Qualidade: ${cfg.qualityLabel || cfg.quality} · MSAA ${info.samples ?? "?"}x`,
                `${escapeHtml(info.renderer || "GPU desconhecida")}`,
                `Objetos: ${(v.scene.numObjects ?? Object.keys(v.scene.objects || {}).length).toLocaleString("pt-BR")} · modelos: ${Object.keys(v.scene.models || {}).length}`
            ].join("<br>");
        };
        update();
        hudTimer = setInterval(update, 500);
    }
    D.toggleHud = toggleHud;

    const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

    // ------------------------------------------------------------------------------------------
    // 4) IFC nativo: converte fora da interface e carrega como XKT
    // ------------------------------------------------------------------------------------------
    const isIfc = (file) => /\.ifc$/i.test(file?.name || "");
    const describeProgress = (p) => `${p?.stage || "Convertendo…"}${p?.elapsed ? ` (${Math.round(p.elapsed / 1000)} s)` : ""}`;

    async function fileFromUrl(url, name) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        return new File([blob], name, { type: "application/octet-stream" });
    }

    async function convertPathToXktFile(filePath, displayName, onText) {
        const result = await api.convertIfc(filePath, (p) => onText?.(describeProgress(p)));
        onText?.(result.cached ? "IFC já convertido (cache) — abrindo…" : `Convertido em ${Number(result.seconds || 0).toFixed(1)} s — abrindo…`);
        return fileFromUrl(result.url, displayName.replace(/\.ifc$/i, "") + ".xkt");
    }

    D.maybeConvertIfc = async (file, onText) => {
        if (!api || !isIfc(file)) return file;
        const filePath = api.pathForFile(file);
        if (!filePath) return file;
        const note = toast(`Convertendo ${file.name} com o processador do computador…`, { ms: 0 });
        try {
            const xkt = await convertPathToXktFile(filePath, file.name, (text) => { onText?.(text); note.set(`${file.name}: ${text}`); });
            note.close(2500);
            return xkt;
        } catch (error) {
            console.error("[desktop] conversão nativa falhou; tentando o leitor do navegador.", error);
            note.set(`Falha na conversão nativa de ${file.name}: ${error.message}. Tentando o leitor do navegador (mais lento)…`, true);
            note.close(10000);
            return file;
        }
    };

    D.prewarmIfc = (files) => {
        if (!api) return;
        const paths = Array.from(files || []).filter(isIfc).map((f) => api.pathForFile(f)).filter(Boolean);
        if (paths.length > 1) api.prewarmIfc(paths);
    };

    // Arquivos abertos pelo menu, pela tela inicial ou por duplo-clique no Windows
    let processingPending = false;
    async function processPendingOpens() {
        if (!api || processingPending || document.body?.dataset?.project !== "ifc_upload") return;
        processingPending = true;
        try {
            const uploadApi = await waitFor(() => window.ifcUploadApi, 60000);
            if (!uploadApi) return;
            const items = await api.takePendingOpens();
            if (!items?.length) return;
            const note = toast(`Preparando ${items.length} arquivo(s)…`, { ms: 0 });
            const files = await Promise.all(items.map(async (item) => {
                try {
                    if (item.ifcPath) {
                        return await convertPathToXktFile(item.ifcPath, item.name, (text) => note.set(`${item.name}: ${text}`));
                    }
                    return await fileFromUrl(item.url, item.name);
                } catch (error) {
                    console.error(error);
                    toast(`Não foi possível abrir ${item.name}: ${error.message}`, { error: true, ms: 10000 });
                    return null;
                }
            }));
            note.close(1500);
            const ok = files.filter(Boolean);
            if (ok.length) {
                await waitFor(() => !uploadApi.isBusy?.(), 600000);
                await uploadApi.processFiles(ok);
            }
        } finally {
            processingPending = false;
        }
    }

    function waitFor(check, timeoutMs) {
        return new Promise((resolve) => {
            const started = Date.now();
            const tick = () => {
                const value = check();
                if (value) return resolve(value);
                if (Date.now() - started > timeoutMs) return resolve(null);
                setTimeout(tick, 150);
            };
            tick();
        });
    }

    // ------------------------------------------------------------------------------------------
    // 5) Avisos e eventos vindos do menu
    // ------------------------------------------------------------------------------------------
    const STYLE = `
.bimd-hud{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483000;padding:8px 12px;border-radius:8px;background:rgba(10,14,20,.82);color:#e8eef7;font:12px/1.5 ui-monospace,Consolas,monospace;pointer-events:none;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.3)}
.bimd-hud b{color:#7fe3a0;font-size:14px}
.bimd-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483001;display:grid;gap:8px;width:min(560px,calc(100vw - 32px));pointer-events:none}
.bimd-toast{padding:10px 14px;border-radius:9px;background:rgba(18,24,33,.94);color:#f1f5fb;font:13px/1.45 system-ui,Segoe UI,sans-serif;box-shadow:0 8px 22px rgba(0,0,0,.32);border-left:3px solid #5ea1ff}
.bimd-toast.is-error{border-left-color:#ff6b6b}`;

    function ensureUi() {
        if (document.getElementById("bimdStyle") || !document.head) return;
        const style = document.createElement("style");
        style.id = "bimdStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    function toast(text, { error = false, ms = 5000 } = {}) {
        ensureUi();
        let box = document.querySelector(".bimd-toasts");
        if (!box) {
            box = document.createElement("div");
            box.className = "bimd-toasts";
            (document.body || document.documentElement).appendChild(box);
        }
        const el = document.createElement("div");
        el.className = `bimd-toast${error ? " is-error" : ""}`;
        el.setAttribute("role", "status");
        el.textContent = text;
        box.appendChild(el);
        const handle = {
            set(t, isError = false) { el.textContent = t; el.classList.toggle("is-error", isError); },
            close(delay = 0) { setTimeout(() => el.remove(), delay); }
        };
        if (ms) handle.close(ms);
        return handle;
    }
    D.toast = toast;

    if (api) {
        api.onConfig((next) => {
            cfg = { ...cfg, ...next };
            D.loadConcurrency = cfg.loadConcurrency || D.loadConcurrency;
            D.navScale = null;
            applyQuality();
            if (D.viewer) toast(`Qualidade: ${cfg.qualityLabel || cfg.quality}`, { ms: 2500 });
        });
        api.onEvent((event) => {
            if (event?.type === "toggle-hud") toggleHud();
            if (event?.type === "open-pending") processPendingOpens();
            if (event?.type === "toast") toast(event.text, { error: event.error, ms: event.ms ?? 6000 });
        });
    }

    document.addEventListener("DOMContentLoaded", () => {
        ensureUi();
        processPendingOpens();
    });
})();
