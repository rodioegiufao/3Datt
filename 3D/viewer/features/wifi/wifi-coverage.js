// Cobertura (Wi-Fi e câmeras): painel, leitura das paredes/lajes da arquitetura e mapa no piso.
// Carregado sob demanda pelo viewer-authenticated.js (somente perfis com permissão).

import {
    Mesh,
    ReadableGeometry,
    PhongMaterial,
    Texture,
    LineSet,
    math
} from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";
import { extractEntityGeometry } from "../clash/xkt-geometry.js";
import {
    AP_MODELS,
    TX_POWER_PRESETS,
    OBSTACLE_IFC_TYPES,
    FLOOR_IFC_TYPES,
    PROPAGATION,
    SIGNAL_LEVELS,
    NO_SIGNAL_COLOR,
    NO_SIGNAL_LABEL,
    getAccessPointModelId,
    classifyObstacle,
    getEirpDbm,
    sliceObstacles,
    segmentsBounds,
    computeSignalGrid,
    summarizeSignalGrid,
    buildFloorMask,
    smoothGrid,
    renderHeatmapPixels,
    collectFloorFaces,
    dominantFloorY,
    SegmentGrid
} from "./wifi-coverage-core.js";
import {
    CAMERA_MODELS,
    CAMERA_SETTINGS,
    CAMERA_BLOCKING_KINDS,
    explainCameraView,
    getCameraModelId,
    getCameraLevels,
    aimFromTarget,
    cameraGizmoLines,
    cameraFootprintBounds,
    computeCameraGrid,
    summarizeCameraGrid
} from "./camera-coverage-core.js";

const WALL_TYPES = new Set(["IfcWall", "IfcWallStandardCase", "IfcWallElementedCase"]);
const HEATMAP_MARGIN = 3;          // metros além das paredes
const SLAB_LIFT = 0.03;            // altura do mapa acima da face superior da laje (m)
const GROUND_LIFT = 0.01;          // retângulo de fundo (sem recorte), abaixo do mapa sobre as lajes
const OVERHEAD_CLEARANCE = 2.3;    // objetos que começam acima disso (marquise, forro, laje) são ocultados
const MAX_GRID_CELLS = 250000;
const AIM_STORAGE_KEY = `cameraAims:${window.location.pathname}`;
const IGNORED_STORAGE_KEY = `coverageIgnored:${window.location.pathname}`;
const KIND_LABELS = Object.freeze({
    masonry: "alvenaria", drywall: "drywall", concrete: "concreto", door: "porta",
    glass: "vidro", fence: "gradil", ignored: "ignorado"
});

const STYLE = `
#wifiCoveragePanel{position:fixed;top:80px;right:20px;width:360px;max-width:calc(100% - 40px);max-height:calc(100vh - 110px);overflow:auto;background:rgba(33,33,33,.92);color:#f7f7f7;padding:14px;border-radius:8px;box-shadow:0 6px 16px rgba(0,0,0,.35);z-index:300001;font-family:Arial,sans-serif;font-size:13px;backdrop-filter:blur(6px)}
#wifiCoveragePanel[hidden]{display:none}
#wifiCoveragePanel [hidden]{display:none !important}
#wifiCoveragePanel .wifi-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}
#wifiCoveragePanel .wifi-title{font-size:16px;font-weight:700}
#wifiCoveragePanel .wifi-subtitle{font-size:12px;opacity:.75}
#wifiCoveragePanel .wifi-close{background:none;border:0;color:#fff;font-size:18px;cursor:pointer}
#wifiCoveragePanel .wifi-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;background:#111;border-radius:8px;padding:3px;margin-bottom:6px}
#wifiCoveragePanel .wifi-tabs button{border:0;border-radius:6px;padding:7px;background:none;color:#ddd;font-weight:700;cursor:pointer}
#wifiCoveragePanel .wifi-tabs button.is-active{background:#2563eb;color:#fff}
#wifiCoveragePanel label{display:block;margin:8px 0 3px;font-size:12px;opacity:.85}
#wifiCoveragePanel .wifi-check{display:flex;align-items:center;gap:6px;margin-top:10px;opacity:1}
#wifiCoveragePanel select{width:100%;padding:7px;border-radius:6px;border:1px solid #444;background:#111;color:#fff}
#wifiCoveragePanel .wifi-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
#wifiCoveragePanel .wifi-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:6px;padding:8px;margin-top:8px;font-size:12px;line-height:1.5}
#wifiCoveragePanel .wifi-actions{display:flex;gap:8px;margin-top:12px}
#wifiCoveragePanel .wifi-actions button{flex:1;padding:9px;border:0;border-radius:6px;font-weight:700;cursor:pointer}
#wifiCoveragePanel .wifi-run{background:#16a34a;color:#fff}
#wifiCoveragePanel .wifi-run:disabled{opacity:.5;cursor:wait}
#wifiCoveragePanel .wifi-off{background:#3f3f46;color:#fff}
#wifiCoveragePanel .wifi-status{margin-top:10px;font-size:12px;min-height:16px}
#wifiCoveragePanel .wifi-status.is-aiming{color:#93c5fd;font-weight:700}
#wifiCoveragePanel progress{width:100%;margin-top:6px}
#wifiCoveragePanel .wifi-legend div{display:flex;align-items:center;gap:8px;margin:3px 0}
#wifiCoveragePanel .wifi-legend span{display:inline-block;width:14px;height:14px;border-radius:3px;flex:none}
#wifiCoveragePanel .wifi-ap-list{list-style:none;margin:4px 0 0;padding:0;max-height:180px;overflow:auto}
#wifiCoveragePanel .wifi-ap-list button.wifi-link{width:100%;text-align:left;background:none;border:0;color:#cfe;padding:3px 0;cursor:pointer;font-size:12px}
#wifiCoveragePanel .wifi-ap-list button.wifi-link:hover{text-decoration:underline}
#wifiCoveragePanel .wifi-diag{display:none}
#wifiCoveragePanel .wifi-diag.is-visible{display:block}
#wifiCoveragePanel .wifi-diag ul{list-style:none;margin:4px 0;padding:0}
#wifiCoveragePanel .wifi-diag li{display:flex;justify-content:space-between;gap:6px;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.06)}
#wifiCoveragePanel .wifi-diag .ok{color:#86efac}
#wifiCoveragePanel .wifi-diag .bad{color:#fca5a5}
#wifiCoveragePanel .wifi-diag button{background:#3f3f46;color:#fff;border:0;border-radius:5px;padding:3px 7px;cursor:pointer;font-size:11px;flex:none}
#wifiCoveragePanel .wifi-cam-item .wifi-diag-btn{background:#3f3f46;color:#fff;border:0;border-radius:5px;padding:5px 7px;cursor:pointer}
#wifiCoveragePanel .wifi-cam-item .wifi-diag-btn.is-aiming{background:#f59e0b}
#wifiCoveragePanel .wifi-cam-item{display:grid;grid-template-columns:1fr auto auto auto;gap:6px;align-items:center;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)}
#wifiCoveragePanel .wifi-cam-item small{display:block;opacity:.7}
#wifiCoveragePanel .wifi-cam-item .wifi-aim{background:#2563eb;color:#fff;border:0;border-radius:5px;padding:5px 8px;font-weight:700;cursor:pointer}
#wifiCoveragePanel .wifi-cam-item .wifi-aim.is-aiming{background:#f59e0b}
#wifiCoveragePanel .wifi-cam-item .wifi-clear{background:none;border:0;color:#aaa;cursor:pointer;font-size:14px}
`;

export function createWifiCoverageFeature({
    viewer,
    xktLoader,
    getModelIds,
    getModelSources,
    resolveSceneObjectId = () => null,
    requestRenderFrame = () => {},
    onVisibilityChange = () => {}
}) {
    const scene = viewer.scene;
    const canvas = scene.canvas.canvas;
    const metaObjects = () => viewer.metaScene?.metaObjects || {};
    const archGeometryCache = new Map(); // archModelId -> { obstacles: [...], slabs: [...] }

    let mode = "wifi";                 // "wifi" | "camera"
    let heatmap = null;                // { mesh, geometry, material, texture }
    let frustumLines = null;           // LineSet dos cones das câmeras
    let lastRunMode = null;            // modo do mapa atualmente desenhado
    let visibilitySnapshot = null;
    let running = false;
    let cancelRequested = false;
    let enabled = true;
    let aiming = null;                 // { camera, purpose: "aim" | "diagnose", subscription }
    let highlightedIds = [];

    const cameraAims = loadAims();     // id da câmera -> { azimuthDeg, tiltDeg }
    const ignoredObstacles = loadIgnored(); // ids de paredes/portas que não bloqueiam a câmera

    // -----------------------------------------------------------------------
    // UI
    // -----------------------------------------------------------------------
    if (!document.getElementById("wifiCoverageStyle")) {
        const style = document.createElement("style");
        style.id = "wifiCoverageStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    const toolbarButton = document.createElement("button");
    toolbarButton.id = "btnWifiCoverage";
    toolbarButton.type = "button";
    toolbarButton.className = "tool-button";
    toolbarButton.title = "Cobertura Wi-Fi e câmeras";
    toolbarButton.innerHTML = `<span style="font-size: 1.2em;">📶</span>\n            Cobertura`;
    const helpButton = document.getElementById("btnHelp");
    const toolbar = helpButton?.parentElement || document.getElementById("btnMaterialsPanel")?.parentElement;
    if (helpButton) toolbar.insertBefore(toolbarButton, helpButton); else toolbar?.appendChild(toolbarButton);

    const panel = document.createElement("div");
    panel.id = "wifiCoveragePanel";
    panel.hidden = true;
    panel.innerHTML = `
        <div class="wifi-header">
            <div>
                <div class="wifi-title">Cobertura</div>
                <div class="wifi-subtitle" id="wifiSubtitle">Estimativa de sinal dos access points</div>
            </div>
            <button type="button" class="wifi-close" aria-label="Fechar painel">✕</button>
        </div>
        <div class="wifi-tabs" role="tablist">
            <button type="button" data-mode="wifi" class="is-active">Wi-Fi</button>
            <button type="button" data-mode="camera">Câmeras</button>
        </div>
        <label for="wifiArchModel">IFC da arquitetura (paredes)</label>
        <select id="wifiArchModel"></select>
        <label for="wifiStorey">Pavimento</label>
        <select id="wifiStorey"></select>

        <div data-section="wifi">
            <label for="wifiApModel">Modelo do access point</label>
            <select id="wifiApModel"></select>
            <div class="wifi-row">
                <div><label for="wifiBand">Banda</label><select id="wifiBand"></select></div>
                <div><label for="wifiPower">Potência</label><select id="wifiPower"></select></div>
            </div>
        </div>

        <div data-section="camera" hidden>
            <label for="camModel">Modelo da câmera</label>
            <select id="camModel"></select>
            <label class="wifi-check"><input type="checkbox" id="camNight"> Noite (limitar ao alcance do IR)</label>
        </div>

        <label for="wifiResolution">Resolução do mapa</label>
        <select id="wifiResolution">
            <option value="0.25">0,25 m (alta qualidade)</option>
            <option value="0.5">0,5 m (rápido)</option>
            <option value="1">1 m (rascunho)</option>
        </select>
        <label class="wifi-check"><input type="checkbox" id="wifiClipFloor" checked> Recortar o mapa no piso (IfcSlab)</label>

        <div class="wifi-card" id="wifiModelSpec"></div>
        <div class="wifi-card"><div id="wifiDeviceSummary"></div><ul class="wifi-ap-list" id="wifiDeviceList"></ul></div>
        <div class="wifi-card wifi-diag" id="camDiagnostic" data-section="camera"></div>
        <div class="wifi-actions">
            <button type="button" class="wifi-run" id="wifiRun">Rodar sinal</button>
            <button type="button" class="wifi-off" id="wifiOff">Desligar</button>
        </div>
        <div class="wifi-status" id="wifiStatus"></div>
        <progress id="wifiProgress" max="1" value="0" hidden></progress>
        <div class="wifi-card wifi-legend" id="wifiLegend"></div>
    `;
    document.body.appendChild(panel);

    const $ = (selector) => panel.querySelector(selector);
    const archSelect = $("#wifiArchModel");
    const storeySelect = $("#wifiStorey");
    const apModelSelect = $("#wifiApModel");
    const bandSelect = $("#wifiBand");
    const powerSelect = $("#wifiPower");
    const cameraModelSelect = $("#camModel");
    const nightCheckbox = $("#camNight");
    const resolutionSelect = $("#wifiResolution");
    const clipFloorCheckbox = $("#wifiClipFloor");
    const statusElement = $("#wifiStatus");
    const progressElement = $("#wifiProgress");
    const runButton = $("#wifiRun");

    const addOption = (select, value, text) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.appendChild(option);
    };
    const fmtNumber = (value, digits = 0) => Number(value).toLocaleString("pt-BR", { maximumFractionDigits: digits });

    Object.values(AP_MODELS).forEach((model) => addOption(apModelSelect, model.id, model.label));
    Object.entries(TX_POWER_PRESETS).forEach(([key, preset]) => addOption(powerSelect, key, preset.label));
    Object.values(CAMERA_MODELS).forEach((model) => addOption(cameraModelSelect, model.id, model.label));

    function setMode(nextMode) {
        if (aiming) stopAim();
        mode = nextMode;
        panel.querySelectorAll(".wifi-tabs button").forEach((button) => {
            button.classList.toggle("is-active", button.dataset.mode === mode);
        });
        panel.querySelectorAll("[data-section]").forEach((section) => {
            section.hidden = section.dataset.section !== mode;
        });
        $("#wifiSubtitle").textContent = mode === "wifi"
            ? "Estimativa de sinal dos access points"
            : "Área vista pelas câmeras (DORI)";
        runButton.textContent = mode === "wifi" ? "Rodar sinal" : "Rodar câmeras";
        renderModelSpec();
        renderLegend();
        refreshDeviceList();
        drawFrustums(currentStorey());
    }

    function refreshBandOptions() {
        const model = AP_MODELS[apModelSelect.value];
        const previous = bandSelect.value;
        bandSelect.innerHTML = "";
        Object.entries(model?.bands || {}).forEach(([key, band]) => addOption(bandSelect, key, band.label));
        if (previous && model?.bands?.[previous]) bandSelect.value = previous;
        renderModelSpec();
    }

    function renderModelSpec() {
        const spec = $("#wifiModelSpec");
        if (mode === "camera") {
            const model = CAMERA_MODELS[cameraModelSelect.value];
            if (!model) { spec.textContent = ""; return; }
            const m = (value) => fmtNumber(value, 1);
            spec.innerHTML = `
                <b>${model.label}</b><br>
                Resolução: ${model.resolution} • Lente: ${model.focal}<br>
                Ângulo de visão: H ${model.hFovDeg}° / V ${model.vFovDeg}° • IR: ${model.irRangeM} m<br>
                DORI: identificar ${m(model.dori.identify)} m • reconhecer ${m(model.dori.recognize)} m •
                observar ${m(model.dori.observe)} m • detectar ${m(model.dori.detect)} m`;
            return;
        }
        const model = AP_MODELS[apModelSelect.value];
        const band = model?.bands?.[bandSelect.value];
        if (!model || !band) { spec.textContent = ""; return; }
        const eirp = getEirpDbm(model.id, bandSelect.value, powerSelect.value);
        spec.innerHTML = `
            <b>${model.label}</b><br>
            Potência máx.: ${band.txPowerDbm} dBm • Ganho: ${fmtNumber(band.antennaGainDbi, 1)} dBi<br>
            EIRP usada: ${fmtNumber(eirp, 1)} dBm • Taxa: ${band.throughput}<br>
            MIMO: ${model.mimo} • Clientes: ${model.maxClients}`;
    }

    function renderLegend() {
        const swatch = (rgb) => `<span style="background:rgb(${rgb.join(",")})"></span>`;
        if (mode === "camera") {
            $("#wifiLegend").innerHTML =
                getCameraLevels(cameraModelSelect.value).map((level) => `<div>${swatch(level.color)}${level.label}</div>`).join("") +
                `<div><span style="background:transparent;border:1px dashed #777"></span>Fora da visão / bloqueado por parede</div>`;
            return;
        }
        $("#wifiLegend").innerHTML =
            SIGNAL_LEVELS.map((level) => `<div>${swatch(level.color)}${level.label}</div>`).join("") +
            `<div>${swatch(NO_SIGNAL_COLOR)}${NO_SIGNAL_LABEL}</div>`;
    }

    function setStatus(text, progress = null, { aimingStyle = false } = {}) {
        statusElement.textContent = text;
        statusElement.classList.toggle("is-aiming", aimingStyle);
        progressElement.hidden = progress === null;
        if (progress !== null) progressElement.value = progress;
    }

    // -----------------------------------------------------------------------
    // Leitura do modelo
    // -----------------------------------------------------------------------
    const modelIdOf = (objectId) => String(objectId).split("#")[0];

    function sceneEntityFor(metaObjectId) {
        return scene.objects[metaObjectId] || scene.objects[resolveSceneObjectId(metaObjectId)] || null;
    }

    function findDevices(getModelId) {
        const result = [];
        for (const metaObject of Object.values(metaObjects())) {
            const deviceModelId = getModelId(metaObject);
            if (!deviceModelId) continue;
            const entity = sceneEntityFor(metaObject.id);
            if (!entity?.aabb) continue;
            const a = entity.aabb;
            result.push({
                id: metaObject.id,
                name: metaObject.name || metaObject.id,
                sourceModelId: entity.model?.id || modelIdOf(metaObject.id),
                deviceModelId,
                aabb: Array.from(a),
                x: (a[0] + a[3]) / 2,
                y: (a[1] + a[4]) / 2,
                z: (a[2] + a[5]) / 2
            });
        }
        return result;
    }

    const findAccessPoints = () => findDevices(getAccessPointModelId);
    const findCameras = () => findDevices(getCameraModelId);

    function getArchStoreys(archModelId) {
        const storeys = [];
        for (const metaObject of Object.values(metaObjects())) {
            if (metaObject?.type !== "IfcBuildingStorey" || modelIdOf(metaObject.id) !== archModelId) continue;
            const subtree = typeof metaObject.getObjectIDsInSubtree === "function"
                ? metaObject.getObjectIDsInSubtree()
                : [metaObject.id];
            let floorY = Infinity, ceilingY = -Infinity, wallCount = 0;
            const sceneIds = [];
            for (const id of subtree) {
                const entity = sceneEntityFor(id);
                if (!entity) continue;
                sceneIds.push(entity.id);
                if (!WALL_TYPES.has(metaObjects()[id]?.type) || !entity.aabb) continue;
                wallCount++;
                floorY = Math.min(floorY, entity.aabb[1]);
                ceilingY = Math.max(ceilingY, entity.aabb[4]);
            }
            if (!wallCount) continue;
            storeys.push({ id: metaObject.id, name: metaObject.name || metaObject.id, floorY, ceilingY, sceneIds, floorTopY: null });
        }
        return storeys.sort((a, b) => a.floorY - b.floorY);
    }

    const GEOMETRY_TYPES = [...Object.keys(OBSTACLE_IFC_TYPES), ...FLOOR_IFC_TYPES];
    const FLOOR_TYPE_SET = new Set(FLOOR_IFC_TYPES);

    async function loadArchGeometry(archModelId) {
        if (archGeometryCache.has(archModelId)) return archGeometryCache.get(archModelId);

        const liveModel = scene.models[archModelId];
        const transform = {
            position: liveModel?.position ? Array.from(liveModel.position) : [0, 0, 0],
            rotation: liveModel?.rotation ? Array.from(liveModel.rotation) : [0, 0, 0]
        };
        const isWanted = (entity) => GEOMETRY_TYPES.includes(metaObjects()[entity.id]?.type);
        const extract = (entities) => entities
            .map((entity) => extractEntityGeometry(entity, { modelId: archModelId, transform, metaObjects: metaObjects() }))
            .filter(Boolean);

        // 1) tenta ler direto do modelo carregado (funciona se já houver geometria legível em cache)
        const liveEntities = Object.values(scene.objects).filter((entity) => entity.model?.id === archModelId && isWanted(entity));
        let geometries = extract(liveEntities);

        // 2) senão, abre uma cópia invisível só com paredes/portas/janelas/pilares/lajes, lê a geometria e descarta
        if (!geometries.length && liveEntities.length) {
            // Cópia temporária: do arquivo do computador (upload/pasta) ou do endereço no servidor
            const record = getModelSources().find((model) => model.id === archModelId);
            let src = null;
            let revokeSrc = false;
            if (typeof Blob !== "undefined" && record?.file instanceof Blob) {
                if (!/\.xkt$/i.test(record.file.name || record.src || "")) {
                    throw new Error("Para usar a arquitetura na cobertura, carregue-a como .xkt.");
                }
                src = URL.createObjectURL(record.file);
                revokeSrc = true;
            } else if (/^(blob:|https?:|data:)/i.test(String(record?.src || "")) || String(record?.src || "").includes("/")) {
                src = record.src;
            }
            if (!src) throw new Error(`Arquivo do modelo ${archModelId} não encontrado (carregue-o de novo).`);
            setStatus("Lendo paredes e lajes da arquitetura…", 0);
            const tempId = `__wifi_${archModelId}_${Date.now()}`;
            const tempModel = xktLoader.load({
                id: tempId,
                src,
                globalizeObjectIds: true,
                readableGeometryEnabled: true,
                includeTypes: GEOMETRY_TYPES,
                visible: false,
                pickable: false,
                edges: false,
                saoEnabled: false,
                dtxEnabled: false
            });
            try {
                await new Promise((resolve, reject) => {
                    tempModel.on("loaded", resolve);
                    tempModel.on("error", reject);
                });
                if (liveModel?.position) tempModel.position = Array.from(liveModel.position);
                if (liveModel?.rotation) tempModel.rotation = Array.from(liveModel.rotation);
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                geometries = extract(Object.values(scene.objects).filter((entity) => entity.model?.id === tempId));
            } finally {
                tempModel.destroy();
                if (revokeSrc) URL.revokeObjectURL(src);
            }
        }

        const obstacles = [];
        const slabs = [];
        for (const geometry of geometries) {
            const liveId = `${archModelId}#${geometry.objectId}`;
            const meta = metaObjects()[liveId] || { type: geometry.type, name: geometry.name };
            const item = { id: liveId, aabb: geometry.aabb, positions: geometry.positions, indices: geometry.indices };
            if (FLOOR_TYPE_SET.has(meta.type)) {
                slabs.push(item);
            } else {
                obstacles.push({ ...item, kind: classifyObstacle(meta) || "masonry" });
            }
        }
        const result = { obstacles, slabs };
        archGeometryCache.set(archModelId, result);
        return result;
    }

    // -----------------------------------------------------------------------
    // Visibilidade: só a arquitetura do pavimento + os dispositivos desse pavimento
    // -----------------------------------------------------------------------
    function isolateForCoverage(storey, deviceModelIds, extraIds = []) {
        if (!visibilitySnapshot) visibilitySnapshot = scene.visibleObjectIds.slice();
        const minY = storey.floorY - 0.3;
        const maxY = storey.ceilingY + 0.8;
        // Arquitetura do pavimento, sem o que fica sobre a cabeça (marquise, forro, laje, telhado),
        // que tamparia o mapa visto de cima
        const overheadY = (storey.floorTopY ?? storey.floorY) + OVERHEAD_CLEARANCE;
        const show = new Set(storey.sceneIds.filter((id) => {
            const aabb = scene.objects[id]?.aabb;
            return !aabb || aabb[1] < overheadY;
        }));
        extraIds.forEach((id) => { if (scene.objects[id]) show.add(id); });

        for (const entity of Object.values(scene.objects)) {
            if (!deviceModelIds.has(entity.model?.id) || !entity.aabb) continue;
            const centerY = (entity.aabb[1] + entity.aabb[4]) / 2;
            if (centerY >= minY && centerY <= maxY) show.add(entity.id);
        }

        scene.setObjectsVisible(scene.objectIds, false);
        scene.setObjectsXRayed(scene.objectIds, false);
        scene.setObjectsVisible(Array.from(show), true);
        onVisibilityChange();
    }

    function restoreVisibility() {
        if (!visibilitySnapshot) return;
        scene.setObjectsVisible(scene.objectIds, false);
        scene.setObjectsVisible(visibilitySnapshot.filter((id) => scene.objects[id]), true);
        visibilitySnapshot = null;
        onVisibilityChange();
    }

    // -----------------------------------------------------------------------
    // Mapa no piso
    // -----------------------------------------------------------------------
    function destroyHeatmap() {
        if (!heatmap) return;
        heatmap.mesh.destroy();
        heatmap.geometry.destroy();
        heatmap.material.destroy();
        heatmap.texture.destroy();
        heatmap = null;
        lastRunMode = null;
        requestRenderFrame();
    }

    /**
     * image: resultado de renderHeatmapPixels. Pixels com alfa 0 ficam transparentes
     * (usado nas câmeras, para mostrar só a área vista).
     */
    /**
     * image: resultado de renderHeatmapPixels.
     * floorFaces: faces das lajes (x,y,z ×3 por triângulo) — o mapa é estendido sobre cada uma, na cota dela.
     * groundY: se informado, desenha também um retângulo de fundo nessa cota (modo sem recorte).
     * transparent: pixels com alfa 0 ficam transparentes (câmeras: só a área vista aparece).
     */
    function drawHeatmap(image, { cols, rows }, bounds, cellSize, { floorFaces = null, groundY = null, baseY = 0, transparent = false } = {}) {
        destroyHeatmap();

        const textureCanvas = document.createElement("canvas");
        textureCanvas.width = image.width;
        textureCanvas.height = image.height;
        textureCanvas.getContext("2d").putImageData(new ImageData(image.data, image.width, image.height), 0, 0);

        // Linha 0 da imagem = minZ (v = 0); flipY desligado para manter essa correspondência.
        // A textura cobre exatamente cols × rows células, a partir de minX/minZ.
        const minX = bounds[0], minZ = bounds[1];
        const width = cols * cellSize, depth = rows * cellSize;
        const origin = [minX + width / 2, baseY, minZ + depth / 2];

        const positions = [], normals = [], uv = [], indices = [];
        const addVertex = (x, y, z) => {
            positions.push(x - origin[0], y - origin[1], z - origin[2]);
            normals.push(0, 1, 0);
            uv.push((x - minX) / width, (z - minZ) / depth);
        };

        if (floorFaces?.length) {
            for (let i = 0; i < floorFaces.length; i += 9) {
                const base = positions.length / 3;
                addVertex(floorFaces[i], floorFaces[i + 1] + SLAB_LIFT, floorFaces[i + 2]);
                addVertex(floorFaces[i + 3], floorFaces[i + 4] + SLAB_LIFT, floorFaces[i + 5]);
                addVertex(floorFaces[i + 6], floorFaces[i + 7] + SLAB_LIFT, floorFaces[i + 8]);
                indices.push(base, base + 1, base + 2);
            }
        }
        if (groundY !== null || !floorFaces?.length) {
            const y = (groundY ?? baseY) + GROUND_LIFT;
            const base = positions.length / 3;
            addVertex(minX, y, minZ);
            addVertex(minX + width, y, minZ);
            addVertex(minX + width, y, minZ + depth);
            addVertex(minX, y, minZ + depth);
            indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }

        const texture = new Texture(scene, { src: textureCanvas.toDataURL("image/png"), flipY: false });
        const geometry = new ReadableGeometry(scene, { primitive: "triangles", positions, normals, uv, indices });
        const material = new PhongMaterial(scene, {
            diffuse: [0, 0, 0],
            ambient: [0, 0, 0],
            specular: [0, 0, 0],
            emissive: [1, 1, 1],
            emissiveMap: texture,
            // o diffuseMap não muda a cor (difusa = 0), só fornece o alfa da textura
            ...(transparent ? { diffuseMap: texture, alphaMode: "blend" } : { alphaMode: "opaque" }),
            alpha: 1,
            backfaces: true
        });
        const mesh = new Mesh(scene, {
            isObject: false,
            origin,
            geometry,
            material,
            pickable: false,
            collidable: false,
            clippable: true
        });
        heatmap = { mesh, geometry, material, texture };
        requestRenderFrame();
    }

    // -----------------------------------------------------------------------
    // Câmeras: mira e cones
    // -----------------------------------------------------------------------
    function loadAims() {
        try {
            const stored = JSON.parse(window.localStorage.getItem(AIM_STORAGE_KEY) || "{}");
            return new Map(Object.entries(stored));
        } catch (_error) {
            return new Map();
        }
    }

    function saveAims() {
        try {
            window.localStorage.setItem(AIM_STORAGE_KEY, JSON.stringify(Object.fromEntries(cameraAims)));
        } catch (_error) {
            // navegador sem armazenamento: a mira vale só nesta sessão
        }
    }

    function loadIgnored() {
        try {
            return new Set(JSON.parse(window.localStorage.getItem(IGNORED_STORAGE_KEY) || "[]"));
        } catch (_error) {
            return new Set();
        }
    }

    function saveIgnored() {
        try {
            window.localStorage.setItem(IGNORED_STORAGE_KEY, JSON.stringify(Array.from(ignoredObstacles)));
        } catch (_error) {
            // sem armazenamento: vale só nesta sessão
        }
    }

    function withAim(camera) {
        const aim = cameraAims.get(camera.id);
        return aim ? { ...camera, ...aim, modelId: camera.deviceModelId } : null;
    }

    function destroyFrustums() {
        frustumLines?.destroy();
        frustumLines = null;
        requestRenderFrame();
    }

    function drawFrustums(storey) {
        destroyFrustums();
        if (mode !== "camera" || !storey) return;
        const floorY = storey.floorTopY ?? storey.floorY;
        const positions = [];
        const indices = [];
        for (const camera of getCamerasForStorey(storey)) {
            const aimed = withAim(camera);
            if (!aimed) continue;
            const model = CAMERA_MODELS[cameraModelSelect.value] || CAMERA_MODELS[aimed.modelId];
            const gizmo = cameraGizmoLines(aimed, model, floorY + SLAB_LIFT);
            const base = positions.length / 3;
            positions.push(...gizmo.positions);
            gizmo.indices.forEach((index) => indices.push(base + index));
        }
        if (!positions.length) return;
        frustumLines = new LineSet(scene, { positions, indices, color: [0.15, 0.39, 0.92], opacity: 0.9 });
        requestRenderFrame();
    }

    function startAim(camera, purpose = "aim") {
        if (running) return;
        if (aiming) stopAim();
        const storey = currentStorey();
        if (!storey) return;

        // Mostra só o pavimento para facilitar o clique no piso
        if (!visibilitySnapshot) isolateForCoverage(storey, new Set([camera.sourceModelId]));

        const subscription = scene.input.on("mouseclicked", (canvasPos) => onAimClick(canvasPos));
        aiming = { camera, purpose, subscription };
        canvas.style.cursor = "crosshair";
        document.addEventListener("keydown", onAimKey);
        setStatus(
            purpose === "aim"
                ? "Clique no piso para onde a câmera deve apontar (Esc cancela). Pode girar e aproximar a vista normalmente."
                : "Clique num ponto do piso que deveria estar coberto por esta câmera (Esc cancela).",
            null,
            { aimingStyle: true }
        );
        refreshDeviceList();
    }

    function stopAim() {
        if (!aiming) return;
        scene.input.off(aiming.subscription);
        aiming = null;
        canvas.style.cursor = "";
        document.removeEventListener("keydown", onAimKey);
        refreshDeviceList();
    }

    function onAimKey(event) {
        if (event.key === "Escape") {
            stopAim();
            setStatus("Cancelado.");
        }
    }

    /** Ponto onde o clique encontra o plano do piso do pavimento (ou null). */
    function clickToFloor(canvasPos, storey) {
        const origin = new Float64Array(3);
        const direction = new Float64Array(3);
        const cam = scene.camera;
        math.canvasPosToWorldRay(canvas, cam.viewMatrix, cam.projMatrix, cam.projection, canvasPos, origin, direction);
        const planeY = storey.floorTopY ?? storey.floorY;
        if (Math.abs(direction[1]) < 1e-6) return null;
        const t = (planeY - origin[1]) / direction[1];
        if (t <= 0) return null;
        return { x: origin[0] + direction[0] * t, y: planeY, z: origin[2] + direction[2] * t };
    }

    function onAimClick(canvasPos) {
        if (!aiming) return;
        const storey = currentStorey();
        const camera = aiming.camera;
        if (!storey) { stopAim(); return; }

        const target = clickToFloor(canvasPos, storey);
        if (!target) return;

        if (aiming.purpose === "diagnose") {
            stopAim();
            runDiagnostic(camera, target);
            return;
        }

        const aim = aimFromTarget(camera, target);
        if (!aim) {
            setStatus("Clique um pouco mais longe da câmera.", null, { aimingStyle: true });
            return;
        }
        cameraAims.set(camera.id, aim);
        saveAims();
        stopAim();
        drawFrustums(storey);
        setStatus(`Câmera direcionada: azimute ${fmtNumber(aim.azimuthDeg)}° • inclinação ${fmtNumber(aim.tiltDeg)}°.`);

        // Se o mapa de câmeras já está na tela, recalcula com a nova mira
        if (lastRunMode === "camera") run({ fly: false });
    }

    // -----------------------------------------------------------------------
    // Diagnóstico: por que a câmera não vê este ponto?
    // -----------------------------------------------------------------------
    function setHighlighted(ids) {
        if (highlightedIds.length) scene.setObjectsHighlighted(highlightedIds, false);
        highlightedIds = ids.filter((id) => scene.objects[id]);
        if (highlightedIds.length) {
            scene.setObjectsVisible(highlightedIds, true);
            scene.setObjectsHighlighted(highlightedIds, true);
        }
        requestRenderFrame();
    }

    function clearDiagnostic() {
        setHighlighted([]);
        const card = $("#camDiagnostic");
        card.classList.remove("is-visible");
        card.innerHTML = "";
    }

    let lastDiagnostic = null;

    async function runDiagnostic(camera, target) {
        const storey = currentStorey();
        const aimed = withAim(camera);
        if (!storey || !aimed) return;
        lastDiagnostic = { camera, target };
        setStatus("Analisando o caminho até o ponto…");

        let prepared;
        try {
            prepared = await prepareStorey(storey, "camera");
        } catch (error) {
            setStatus(`Erro: ${error.message || error}`);
            return;
        }
        const { obstacles, slice, referenceY } = prepared;
        const model = CAMERA_MODELS[cameraModelSelect.value];
        const view = explainCameraView(aimed, model, target, referenceY, nightCheckbox.checked);

        const segBounds = segmentsBounds(slice.coords);
        const grid = new SegmentGrid(slice, [
            Math.min(segBounds[0], aimed.x, target.x) - 1, Math.min(segBounds[1], aimed.z, target.z) - 1,
            Math.max(segBounds[2], aimed.x, target.x) + 1, Math.max(segBounds[3], aimed.z, target.z) + 1
        ], 1);
        const crossings = grid.obstaclesAlong(aimed.x, aimed.z, target.x, target.z, CAMERA_SETTINGS.selfClearance)
            .map(({ owner, distance }) => {
                const obstacle = obstacles[owner];
                const meta = metaObjects()[obstacle.id] || {};
                const ignored = ignoredObstacles.has(obstacle.id);
                return {
                    id: obstacle.id,
                    name: meta.name || obstacle.id,
                    type: meta.type || "",
                    kind: ignored ? "ignored" : obstacle.kind,
                    ignored,
                    blocks: !ignored && CAMERA_BLOCKING_KINDS.has(obstacle.kind),
                    distance
                };
            });
        const blockers = crossings.filter((item) => item.blocks);
        setHighlighted(blockers.map((item) => item.id));

        const index = getCamerasForStorey(storey).findIndex((item) => item.id === camera.id) + 1;
        const mark = (ok) => `<span class="${ok ? "ok" : "bad"}">${ok ? "✔" : "✖"}</span>`;
        const n1 = (value) => fmtNumber(value, 1);
        const card = $("#camDiagnostic");
        let verticalHint = "";
        if (!view.inVertical && view.inFront) {
            verticalHint = view.verticalDeg < 0
                ? " — ponto abaixo da imagem (perto demais da câmera): mire mais perto dele ou mais para baixo"
                : " — ponto acima da imagem: mire mais longe (menos inclinação)";
        }
        const reasons = [];
        if (!view.inFront || !view.inHorizontal) reasons.push("fora do ângulo horizontal");
        if (view.inFront && !view.inVertical) reasons.push("fora do ângulo vertical");
        if (!view.inRange) reasons.push("além da distância de detecção");
        if (blockers.length) reasons.push(`bloqueado por ${blockers.length} objeto(s)`);

        card.innerHTML = `
            <b>Diagnóstico • Câmera ${index}</b><br>
            ${mark(view.inRange)} Distância: ${n1(view.distance)} m (limite ${n1(view.maxRange)} m)<br>
            ${mark(view.inFront && view.inHorizontal)} Ângulo horizontal: ${n1(view.horizontalDeg)}° do centro (limite ${n1(view.horizontalLimitDeg)}°)<br>
            ${mark(view.inFront && view.inVertical)} Ângulo vertical: ${n1(view.verticalDeg)}° (limite ±${n1(view.verticalLimitDeg)}°)${verticalHint}<br>
            <div style="margin-top:6px"><b>Objetos no caminho</b> (corte a ${n1(CAMERA_SETTINGS.targetHeight)} m do piso)</div>
            <ul id="camDiagList"></ul>
            <div style="margin-top:6px"><b>${reasons.length ? `Não vê: ${reasons.join(", ")}.` : "A câmera vê este ponto."}</b></div>
            <div id="camIgnoredInfo" style="margin-top:6px;opacity:.85"></div>`;
        const list = card.querySelector("#camDiagList");
        if (!crossings.length) {
            const item = document.createElement("li");
            item.textContent = "Nenhum.";
            list.appendChild(item);
        }
        for (const crossing of crossings) {
            const item = document.createElement("li");
            const text = document.createElement("span");
            text.innerHTML = `${crossing.blocks ? '<span class="bad">■</span>' : '<span class="ok">□</span>'} `;
            text.appendChild(document.createTextNode(
                `${crossing.name} (${crossing.type.replace(/^Ifc/, "")} • ${KIND_LABELS[crossing.kind] || crossing.kind}) a ${n1(crossing.distance)} m`
            ));
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = crossing.ignored ? "Voltar a bloquear" : "Ignorar";
            button.title = crossing.ignored ? "Este objeto volta a bloquear a câmera" : "Este objeto deixa de bloquear a câmera";
            button.hidden = !crossing.ignored && !crossing.blocks;
            button.onclick = () => {
                if (crossing.ignored) ignoredObstacles.delete(crossing.id); else ignoredObstacles.add(crossing.id);
                saveIgnored();
                runDiagnostic(camera, target);
                if (lastRunMode === "camera") run({ fly: false });
            };
            item.append(text, button);
            list.appendChild(item);
        }
        renderIgnoredInfo();
        card.classList.add("is-visible");
        setStatus(blockers.length ? "Os objetos que bloqueiam estão destacados no 3D." : "");
    }

    function renderIgnoredInfo() {
        const info = $("#camIgnoredInfo");
        if (!info) return;
        info.innerHTML = "";
        if (!ignoredObstacles.size) return;
        info.appendChild(document.createTextNode(`${ignoredObstacles.size} objeto(s) ignorado(s) pelas câmeras `));
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = "Restaurar todos";
        reset.onclick = () => {
            ignoredObstacles.clear();
            saveIgnored();
            if (lastDiagnostic) runDiagnostic(lastDiagnostic.camera, lastDiagnostic.target);
            if (lastRunMode === "camera") run({ fly: false });
        };
        info.appendChild(reset);
    }

    // -----------------------------------------------------------------------
    // Listas e seleção
    // -----------------------------------------------------------------------
    let storeysCache = [];
    const currentStorey = () => storeysCache.find((item) => item.id === storeySelect.value) || null;

    // Nome do modelo como no Explorer (nome do arquivo nos uploads), não o id interno
    const modelLabel = (id) => String(scene.models?.[id]?.displayName || id || "").trim() || String(id);

    function refreshModelOptions() {
        const previous = archSelect.value;
        archSelect.innerHTML = "";
        const ids = getModelIds()
            .filter((id) => !String(id).startsWith("__"))
            .sort((a, b) => modelLabel(a).localeCompare(modelLabel(b), "pt-BR"));
        ids.forEach((id) => addOption(archSelect, id, modelLabel(id)));
        // Arquitetura pré-selecionada: procura "ARQ" no nome (ex.: XKT-ARQ-TCE), não só no id
        const guess = ids.find((id) => /(^|[^a-z])arq/i.test(modelLabel(id))) || ids.find((id) => /ARQ/i.test(id));
        archSelect.value = ids.includes(previous) ? previous : (guess || ids[0] || "");
        refreshStoreyOptions();
    }

    function refreshStoreyOptions() {
        const previous = storeySelect.value;
        storeySelect.innerHTML = "";
        storeysCache = archSelect.value ? getArchStoreys(archSelect.value) : [];
        storeysCache.forEach((storey) => addOption(storeySelect, storey.id, storey.name));
        if (storeysCache.some((storey) => storey.id === previous)) storeySelect.value = previous;
        if (!storeysCache.length) addOption(storeySelect, "", "Nenhum pavimento com paredes neste modelo — escolha a arquitetura");
        refreshDeviceList();
    }

    function devicesForStorey(devices, storey) {
        if (!storey) return [];
        const archModelId = archSelect.value;
        return devices.filter((device) =>
            device.sourceModelId !== archModelId &&
            device.y >= storey.floorY - 0.5 &&
            device.y <= storey.ceilingY + 0.8
        );
    }

    const getAccessPointsForStorey = (storey) => devicesForStorey(findAccessPoints(), storey);
    const getCamerasForStorey = (storey) => devicesForStorey(findCameras(), storey);

    function refreshDeviceList() {
        const storey = currentStorey();
        const list = $("#wifiDeviceList");
        list.innerHTML = "";

        if (mode === "wifi") {
            const aps = getAccessPointsForStorey(storey);
            $("#wifiDeviceSummary").innerHTML = `<b>${aps.length}</b> access point(s) neste pavimento • ${findAccessPoints().length} no projeto`;
            aps.forEach((ap, index) => {
                const item = document.createElement("li");
                const button = document.createElement("button");
                button.type = "button";
                button.className = "wifi-link";
                button.textContent = `AP ${index + 1} • ${modelLabel(ap.sourceModelId)} • ${ap.name}`;
                button.onclick = () => viewer.cameraFlight.flyTo({ aabb: ap.aabb, duration: 0.6 });
                item.appendChild(button);
                list.appendChild(item);
            });
            return;
        }

        const cameras = getCamerasForStorey(storey);
        const aimedCount = cameras.filter((camera) => cameraAims.has(camera.id)).length;
        $("#wifiDeviceSummary").innerHTML =
            `<b>${cameras.length}</b> câmera(s) neste pavimento • ${aimedCount} direcionada(s) • ${findCameras().length} no projeto`;
        cameras.forEach((camera, index) => {
            const aim = cameraAims.get(camera.id);
            const item = document.createElement("li");
            item.className = "wifi-cam-item";

            const info = document.createElement("button");
            info.type = "button";
            info.className = "wifi-link";
            info.textContent = `Câmera ${index + 1} • ${camera.name}`;
            const detail = document.createElement("small");
            detail.textContent = aim
                ? `Azimute ${fmtNumber(aim.azimuthDeg)}° • inclinação ${fmtNumber(aim.tiltDeg)}° • altura ${fmtNumber(camera.y - (storey.floorTopY ?? storey.floorY), 2)} m`
                : "Sem direção — clique em Mirar";
            info.appendChild(detail);
            info.onclick = () => viewer.cameraFlight.flyTo({ aabb: camera.aabb, duration: 0.6 });

            const aimButton = document.createElement("button");
            aimButton.type = "button";
            const isAiming = aiming?.camera.id === camera.id && aiming.purpose === "aim";
            aimButton.className = `wifi-aim${isAiming ? " is-aiming" : ""}`;
            aimButton.textContent = isAiming ? "Cancelar" : "Mirar";
            aimButton.onclick = () => (isAiming ? stopAim() : startAim(camera));

            const clearButton = document.createElement("button");
            clearButton.type = "button";
            clearButton.className = "wifi-clear";
            clearButton.title = "Apagar direção";
            clearButton.textContent = "✕";
            clearButton.hidden = !aim;
            clearButton.onclick = () => {
                cameraAims.delete(camera.id);
                saveAims();
                drawFrustums(storey);
                refreshDeviceList();
                if (lastRunMode === "camera") run({ fly: false });
            };

            const diagButton = document.createElement("button");
            diagButton.type = "button";
            const isDiagnosing = aiming?.camera.id === camera.id && aiming.purpose === "diagnose";
            diagButton.className = `wifi-diag-btn${isDiagnosing ? " is-aiming" : ""}`;
            diagButton.title = "Diagnóstico: clique num ponto que deveria estar coberto";
            diagButton.textContent = "🔍";
            diagButton.hidden = !aim;
            diagButton.onclick = () => (isDiagnosing ? stopAim() : startAim(camera, "diagnose"));

            item.append(info, aimButton, diagButton, clearButton);
            list.appendChild(item);
        });
    }

    // -----------------------------------------------------------------------
    // Execução
    // -----------------------------------------------------------------------
    /** Geometria, piso e corte das paredes do pavimento para o modo informado. */
    async function prepareStorey(storey, runMode) {
        const { obstacles, slabs } = await loadArchGeometry(archSelect.value);
        if (!obstacles.length) throw new Error("Não foi possível ler as paredes deste IFC.");

        // Lajes do pavimento: altura real do piso e recorte do mapa
        const floorSlabs = slabs.filter((slab) => slab.aabb[4] >= storey.floorY - 0.5 && slab.aabb[1] <= storey.floorY + 0.6);
        const floorTop = dominantFloorY(floorSlabs, storey.floorY);
        if (floorTop !== null) storey.floorTopY = floorTop;
        const baseY = storey.floorTopY ?? storey.floorY;

        const heightAboveFloor = runMode === "wifi" ? PROPAGATION.receiverHeight : CAMERA_SETTINGS.targetHeight;
        const referenceY = baseY + heightAboveFloor;
        const slice = sliceObstacles(obstacles, referenceY);
        const kinds = obstacles.map((obstacle) =>
            runMode === "camera" && ignoredObstacles.has(obstacle.id) ? "ignored" : obstacle.kind
        );
        return { obstacles, slabs, floorSlabs, baseY, referenceY, slice, kinds };
    }

    async function run({ fly = true } = {}) {
        if (running || !enabled) return;
        if (aiming) stopAim();
        const runMode = mode;
        const archModelId = archSelect.value;
        const storey = currentStorey();
        if (!archModelId || !storey) { setStatus("Selecione o IFC da arquitetura e o pavimento."); return; }

        let devices;
        if (runMode === "wifi") {
            devices = getAccessPointsForStorey(storey);
            if (!devices.length) { setStatus("Nenhum access point encontrado neste pavimento."); return; }
        } else {
            const cameras = getCamerasForStorey(storey);
            if (!cameras.length) { setStatus("Nenhuma câmera encontrada neste pavimento."); return; }
            devices = cameras.map(withAim).filter(Boolean);
            if (!devices.length) { setStatus("Nenhuma câmera direcionada. Clique em Mirar em pelo menos uma."); return; }
        }

        running = true;
        cancelRequested = false;
        runButton.disabled = true;
        try {
            const { floorSlabs, baseY, referenceY, slice, kinds } = await prepareStorey(storey, runMode);
            if (cancelRequested) return;
            let floor = null;
            if (!slice.owners.length) { setStatus("Nenhuma parede corta a altura de referência neste pavimento."); return; }

            const wallBounds = segmentsBounds(slice.coords);
            const bounds = [
                Math.min(wallBounds[0], ...devices.map((device) => device.x)) - HEATMAP_MARGIN,
                Math.min(wallBounds[1], ...devices.map((device) => device.z)) - HEATMAP_MARGIN,
                Math.max(wallBounds[2], ...devices.map((device) => device.x)) + HEATMAP_MARGIN,
                Math.max(wallBounds[3], ...devices.map((device) => device.z)) + HEATMAP_MARGIN
            ];
            if (runMode === "camera") {
                // A área de cálculo inclui todo o alcance de cada câmera, mesmo fora da edificação
                const model = CAMERA_MODELS[cameraModelSelect.value];
                for (const device of devices) {
                    const reach = cameraFootprintBounds(device, model, referenceY, nightCheckbox.checked);
                    bounds[0] = Math.min(bounds[0], reach[0]);
                    bounds[1] = Math.min(bounds[1], reach[1]);
                    bounds[2] = Math.max(bounds[2], reach[2]);
                    bounds[3] = Math.max(bounds[3], reach[3]);
                }
            }
            let cellSize = Number(resolutionSelect.value) || 0.5;
            const area = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
            if (area / (cellSize * cellSize) > MAX_GRID_CELLS) cellSize = Math.sqrt(area / MAX_GRID_CELLS);

            isolateForCoverage(storey, new Set(devices.map((device) => device.sourceModelId)), floorSlabs.map((slab) => slab.id));
            const label = runMode === "wifi" ? `Calculando sinal de ${devices.length} AP(s)…` : `Calculando visão de ${devices.length} câmera(s)…`;
            setStatus(label, 0);

            const common = {
                obstacleSlice: slice,
                obstacleKinds: kinds,
                bounds,
                cellSize,
                shouldCancel: () => cancelRequested,
                onProgress: (value) => setStatus(label, value)
            };
            let result;
            if (runMode === "wifi") {
                const bandData = AP_MODELS[apModelSelect.value].bands[bandSelect.value];
                result = await computeSignalGrid({
                    ...common,
                    accessPoints: devices,
                    band: bandSelect.value,
                    eirpDbm: getEirpDbm(apModelSelect.value, bandSelect.value, powerSelect.value),
                    freqMHz: bandData.freqMHz,
                    receiverY: referenceY
                });
            } else {
                result = await computeCameraGrid({
                    ...common,
                    cameras: devices.map((device) => ({ ...device, modelId: cameraModelSelect.value })),
                    targetY: referenceY,
                    nightMode: nightCheckbox.checked
                });
            }
            if (!result || cancelRequested) return;

            // Piso: o mapa é estendido sobre as faces das lajes (cada uma na sua cota)
            let mask = null;
            let floorFaces = null;
            let groundY = null;
            let floorNote = "";
            if (floorSlabs.length) {
                const faces = collectFloorFaces(floorSlabs, { floorY: storey.floorY });
                if (faces.length) {
                    floorFaces = faces;
                    let lowest = Infinity;
                    for (let i = 1; i < faces.length; i += 3) lowest = Math.min(lowest, faces[i]);
                    if (clipFloorCheckbox.checked) {
                        floor = buildFloorMask(floorSlabs, { bounds, cellSize, cols: result.cols, rows: result.rows, floorY: storey.floorY });
                        if (floor.count) mask = floor.mask;
                    } else {
                        groundY = lowest;   // fora das lajes, um plano de fundo na cota mais baixa
                    }
                } else {
                    floorNote = " • Lajes sem face horizontal no nível do piso.";
                }
            } else if (clipFloorCheckbox.checked) {
                floorNote = " • Nenhuma IfcSlab encontrada neste pavimento; mapa sem recorte.";
            }

            setStatus("Desenhando o mapa…", 1);
            await new Promise((resolve) => setTimeout(resolve, 0));

            if (runMode === "wifi") {
                const image = renderHeatmapPixels(smoothGrid(result.grid, result.cols, result.rows), result.cols, result.rows);
                drawHeatmap(image, result, bounds, cellSize, { floorFaces, groundY, baseY, transparent: false });
                destroyFrustums();
                const summary = summarizeSignalGrid(result.grid, mask);
                const bandLabel = AP_MODELS[apModelSelect.value].bands[bandSelect.value].label;
                const areaText = mask
                    ? `${fmtNumber(summary.goodPercent)}% do piso ≥ −67 dBm (${fmtNumber(summary.cellCount * cellSize * cellSize)} m²)`
                    : `${fmtNumber(summary.goodPercent)}% da área ≥ −67 dBm (inclui a margem externa)`;
                setStatus(`${storey.name} • ${bandLabel} • ${devices.length} AP(s) • ${areaText}${floorNote}`);
            } else {
                const image = renderHeatmapPixels(result.grid, result.cols, result.rows, {
                    levels: getCameraLevels(cameraModelSelect.value),
                    visibility: result.visibility,
                    shadeRange: 2
                });
                drawHeatmap(image, result, bounds, cellSize, { floorFaces, groundY, baseY, transparent: true });
                drawFrustums(storey);
                const summary = summarizeCameraGrid(result, cameraModelSelect.value, cellSize, mask);
                const ignored = getCamerasForStorey(storey).length - devices.length;
                const pct = (value) => (mask && summary.floor ? ` (${fmtNumber((value / summary.floor) * 100)}% do piso)` : "");
                setStatus(
                    `${storey.name} • ${devices.length} câmera(s)` +
                    `${ignored ? ` • ${ignored} sem direção ignorada(s)` : ""}` +
                    ` • Identificação: ${fmtNumber(summary.identify)} m²${pct(summary.identify)}` +
                    ` • Reconhecimento: ${fmtNumber(summary.recognize)} m²${pct(summary.recognize)}` +
                    ` • Detecção: ${fmtNumber(summary.detect)} m²${pct(summary.detect)}${floorNote}`
                );
            }
            lastRunMode = runMode;

            if (fly) {
                viewer.cameraFlight.flyTo({
                    aabb: [bounds[0], storey.floorY, bounds[1], bounds[2], storey.ceilingY, bounds[3]],
                    duration: 0.8
                });
            }
        } catch (error) {
            console.error("[cobertura] Falha no cálculo:", error);
            setStatus(`Erro: ${error.message || error}`);
        } finally {
            running = false;
            runButton.disabled = false;
        }
    }

    function turnOff() {
        cancelRequested = true;
        stopAim();
        clearDiagnostic();
        destroyHeatmap();
        destroyFrustums();
        restoreVisibility();
        setStatus("");
    }

    function openPanel() {
        refreshModelOptions();
        panel.hidden = false;
        toolbarButton.classList.add("active");
    }

    function closePanel() {
        stopAim();
        panel.hidden = true;
        toolbarButton.classList.remove("active");
    }

    toolbarButton.addEventListener("click", () => {
        if (!enabled) return;
        if (panel.hidden) openPanel(); else closePanel();
    });
    $(".wifi-close").addEventListener("click", closePanel);
    panel.querySelectorAll(".wifi-tabs button").forEach((button) => {
        button.addEventListener("click", () => setMode(button.dataset.mode));
    });
    archSelect.addEventListener("change", refreshStoreyOptions);
    storeySelect.addEventListener("change", () => {
        refreshDeviceList();
        drawFrustums(currentStorey());
    });
    apModelSelect.addEventListener("change", refreshBandOptions);
    bandSelect.addEventListener("change", renderModelSpec);
    powerSelect.addEventListener("change", renderModelSpec);
    cameraModelSelect.addEventListener("change", () => { renderModelSpec(); renderLegend(); drawFrustums(currentStorey()); });
    runButton.addEventListener("click", () => run());
    $("#wifiOff").addEventListener("click", turnOff);

    refreshBandOptions();
    setMode("wifi");

    return {
        enable() {
            enabled = true;
            toolbarButton.hidden = false;
        },
        disable() {
            enabled = false;
            turnOff();
            closePanel();
            toolbarButton.hidden = true;
        },
        clearCache(modelId) {
            if (modelId) archGeometryCache.delete(modelId); else archGeometryCache.clear();
        }
    };
}
