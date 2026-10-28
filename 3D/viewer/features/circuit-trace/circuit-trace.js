// Rastrear circuito: a partir do quadro de cargas, mostra no 3D o caminho deduzido do circuito
// (quadro → eletrocalhas/perfilados/eletrodutos → pontos).
//
// O IFC do QiBuilder só informa o circuito nos pontos; o caminho é deduzido pela geometria:
// peças que se encostam formam uma rede, e o circuito segue o trajeto mais curto do quadro até cada ponto.

import { extractEntityGeometry, clearClashGeometryCache } from "../clash/xkt-geometry.js";

// Aplicação (Identificação_Elemento) das peças de infraestrutura que podem levar fiação
const ROUTE_APPLICATIONS = new Set(["conexao", "circular", "retangular aberto", "retangular", "caixa de passagem de fiacao", "caixa"]);
const PANEL_APPLICATIONS = new Set(["quadro de distribuicao", "rack"]);

const COLORS = {
    route: [1, 0.55, 0.1],
    point: [0.2, 0.45, 1],
    panel: [0.1, 0.75, 0.3]
};

const STYLE = `
.circuit-trace-bar{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);z-index:100006;display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;max-width:calc(100vw - 24px);padding:9px 16px;border-radius:24px;background:rgba(38,40,42,.95);color:#fff;font:13px/1.4 Arial,sans-serif;box-shadow:0 4px 20px #0003}
.circuit-trace-bar[hidden]{display:none}
.circuit-trace-bar .ct-dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:4px;vertical-align:middle}
.circuit-trace-bar button{border:0;border-radius:6px;padding:6px 11px;background:#454749;color:#fff;cursor:pointer;font:inherit}
.circuit-trace-bar button:hover{background:#606366}
.circuit-trace-bar button.is-active{background:#e53935}
.circuit-trace-bar .ct-warn{color:#fbbf24}
.quadro-summary-table tr[data-circuit-index]{cursor:pointer}
.quadro-summary-table tr[data-circuit-index]:hover td{background:rgba(255,140,26,.12)}
.quadro-summary-table tr.is-traced td{background:rgba(255,140,26,.25)}
.quadro-summary-hint{font-size:11px;opacity:.75;margin:2px 0 6px}
`;

const normalize = (value) => String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
// "PT-04-299 -" e "PT-04-299" são o mesmo circuito
const normalizeCircuit = (value) => normalize(value).replace(/[\s-]+$/g, "");

function propertySet(metaObject, name) {
    const wanted = normalize(name);
    return (metaObject?.propertySets || []).find((set) => normalize(set?.name) === wanted) || null;
}

function propertyValue(set, name) {
    const wanted = normalize(name);
    return set?.properties?.find((property) => normalize(property?.name) === wanted)?.value;
}

/** Circuitos de um ponto: [{ quadro, circuito }] a partir do conjunto "Circuito" (Quadro_N/Circuito_N). */
function circuitsOf(metaObject) {
    const set = propertySet(metaObject, "Circuito");
    if (!set) return [];
    const result = [];
    for (let i = 1; i <= 40; i++) {
        const circuito = propertyValue(set, `Circuito_${i}`);
        if (circuito === undefined || circuito === null || circuito === "") continue;
        result.push({ quadro: propertyValue(set, `Quadro_${i}`), circuito });
    }
    return result;
}

function applicationOf(metaObject) {
    return normalize(propertyValue(propertySet(metaObject, "Identificação_Elemento"), "Aplicação"));
}

export function createCircuitTraceFeature({
    viewer,
    xktLoader,
    getModelRecord = () => null,      // (modelId) => { src, file } do projeto
    requestRenderFrame = () => {},
    onVisibilityChange = () => {}
}) {
    const scene = viewer.scene;
    const metaObjects = () => viewer.metaScene?.metaObjects || {};
    const worker = new Worker(new URL("./circuit-trace-worker.js", import.meta.url), { type: "module" });
    const pending = new Map();
    const builtModels = new Map();   // modelKey -> Promise
    let requestCounter = 0;
    let current = null;              // { quadro, circuito, ids: {route, points, panel}, mode }
    let visibilitySnapshot = null;
    const originalColors = new Map();

    worker.onmessage = ({ data }) => {
        const handler = pending.get(data.requestId);
        if (!handler) return;
        pending.delete(data.requestId);
        if (data.type === "error") handler.reject(new Error(data.message));
        else handler.resolve(data);
    };

    function ask(message, transfer = []) {
        const requestId = ++requestCounter;
        return new Promise((resolve, reject) => {
            pending.set(requestId, { resolve, reject });
            worker.postMessage({ ...message, requestId }, transfer);
        });
    }

    // -----------------------------------------------------------------------
    // Interface: barra inferior
    // -----------------------------------------------------------------------
    if (!document.getElementById("circuitTraceStyle")) {
        const style = document.createElement("style");
        style.id = "circuitTraceStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }
    const bar = document.createElement("div");
    bar.className = "circuit-trace-bar";
    bar.hidden = true;
    bar.setAttribute("role", "status");
    const barText = document.createElement("span");
    const legend = document.createElement("span");
    legend.innerHTML = `<span class="ct-dot" style="background:rgb(255,140,26)"></span>caminho
        <span class="ct-dot" style="background:rgb(51,115,255);margin-left:8px"></span>pontos
        <span class="ct-dot" style="background:rgb(26,191,77);margin-left:8px"></span>quadro`;
    const isolateButton = document.createElement("button");
    isolateButton.type = "button";
    isolateButton.textContent = "Isolar";
    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.textContent = "Limpar";
    bar.append(barText, legend, isolateButton, clearButton);
    document.body.appendChild(bar);

    function setBar(text, { warn = false, busy = false } = {}) {
        bar.hidden = false;
        barText.textContent = text;
        barText.className = warn ? "ct-warn" : "";
        legend.hidden = busy;
        isolateButton.hidden = busy || !current;
        clearButton.hidden = busy && !current;
    }

    // -----------------------------------------------------------------------
    // Geometria do modelo elétrico
    // -----------------------------------------------------------------------
    function classify(metaObject, panelId) {
        if (!metaObject) return null;
        if (metaObject.id === panelId) return "panel";
        const application = applicationOf(metaObject);
        if (PANEL_APPLICATIONS.has(application)) return "panel";
        // eletrocalha/eletroduto/perfilado/conexão são caminho, mesmo com o circuito nas propriedades
        if (ROUTE_APPLICATIONS.has(application) && application !== "caixa") return "route";
        if (circuitsOf(metaObject).length) return "point";
        if (application === "caixa") return "route";
        return null;
    }

    function liveTransform(modelId) {
        const live = scene.models?.[modelId];
        return {
            position: live?.position ? Array.from(live.position) : [0, 0, 0],
            rotation: live?.rotation ? Array.from(live.rotation) : [0, 0, 0]
        };
    }

    function analysisSource(modelId) {
        const record = getModelRecord(modelId) || {};
        if (typeof Blob !== "undefined" && record.file instanceof Blob) {
            return /\.xkt$/i.test(record.file.name || record.src || "")
                ? { src: URL.createObjectURL(record.file), revoke: true }
                : null;
        }
        const src = String(record.src || "");
        return /^(blob:|https?:|data:)/i.test(src) || src.includes("/") ? { src, revoke: false } : null;
    }

    /** Lê a geometria das peças relevantes do modelo (direto da tela ou de uma cópia temporária). */
    async function readModelElements(modelId, panelId) {
        const metas = metaObjects();
        const transform = liveTransform(modelId);
        const wanted = Object.values(scene.objects).filter((entity) =>
            entity.model?.id === modelId && classify(metas[entity.id], panelId));
        clearClashGeometryCache(modelId);
        const extract = (entities, idOf) => entities
            .map((entity) => {
                const geometry = extractEntityGeometry(entity, { modelId, transform, metaObjects: metas });
                return geometry ? { ...geometry, liveId: idOf(entity) } : null;
            })
            .filter(Boolean);

        let geometries = extract(wanted, (entity) => entity.id);
        if (!geometries.length && wanted.length) {
            const source = analysisSource(modelId);
            if (!source) throw new Error("não foi possível ler a geometria deste modelo (arquivo indisponível).");
            const tempId = `__circuit_${modelId}_${Date.now()}`;
            const tempModel = xktLoader.load({
                id: tempId,
                src: source.src,
                globalizeObjectIds: true,
                visible: false,
                pickable: false,
                edges: false,
                saoEnabled: false,
                dtxEnabled: false
            });
            try {
                await new Promise((resolve, reject) => {
                    tempModel.on("loaded", resolve);
                    tempModel.on("error", (error) => reject(error instanceof Error ? error : new Error(String(error))));
                });
                tempModel.position = [...transform.position];
                tempModel.rotation = [...transform.rotation];
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                const wantedStable = new Set(wanted.map((entity) => String(entity.id).split("#").pop()));
                const tempEntities = Object.values(scene.objects).filter((entity) =>
                    entity.model?.id === tempId && wantedStable.has(String(entity.id).split("#").pop()));
                geometries = extract(tempEntities, (entity) => `${modelId}#${String(entity.id).split("#").pop()}`);
            } finally {
                tempModel.destroy();
                if (source.revoke) URL.revokeObjectURL(source.src);
                clearClashGeometryCache(modelId);
            }
        }

        return geometries
            .filter((geometry) => scene.objects[geometry.liveId])
            .map((geometry) => ({
                id: geometry.liveId,
                kind: classify(metas[geometry.liveId], panelId),
                positions: Float32Array.from(geometry.positions),
                indices: Uint32Array.from(geometry.indices)
            }))
            .filter((element) => element.kind);
    }

    function ensureGraph(modelId, panelId) {
        const modelKey = `${modelId}|${JSON.stringify(liveTransform(modelId))}`;
        if (!builtModels.has(modelKey)) {
            const promise = (async () => {
                setBar("Lendo a infraestrutura do modelo elétrico…", { busy: true });
                const elements = await readModelElements(modelId, panelId);
                if (!elements.some((element) => element.kind === "route")) {
                    throw new Error("nenhuma eletrocalha, perfilado ou eletroduto encontrado neste modelo.");
                }
                setBar(`Montando a rede de caminhos (${elements.length} peças)… só na primeira vez`, { busy: true });
                const transfer = elements.flatMap((element) => [element.positions.buffer, element.indices.buffer]);
                const built = await ask({ type: "build", modelKey, elements }, transfer);
                return { modelKey, stats: built.stats };
            })();
            promise.catch(() => builtModels.delete(modelKey));
            builtModels.set(modelKey, promise);
        }
        return builtModels.get(modelKey);
    }

    // -----------------------------------------------------------------------
    // Visualização
    // -----------------------------------------------------------------------
    function colorize(ids, color) {
        for (const id of ids) {
            const entity = scene.objects[id];
            if (!entity) continue;
            if (!originalColors.has(id)) originalColors.set(id, entity.colorize ? Array.from(entity.colorize) : null);
            entity.colorize = color;
        }
    }

    function restoreColors() {
        for (const [id, color] of originalColors) {
            const entity = scene.objects[id];
            if (entity) entity.colorize = color;
        }
        originalColors.clear();
    }

    function applyMode(mode) {
        if (!current) return;
        const all = scene.objectIds.filter((id) => !String(id).startsWith("__"));
        const highlighted = [...current.ids.route, ...current.ids.points, current.ids.panel];
        if (!visibilitySnapshot) {
            visibilitySnapshot = { visible: new Set(scene.visibleObjectIds), xrayed: new Set(scene.xrayedObjectIds) };
        }
        if (mode === "isolate") {
            scene.setObjectsXRayed(all, false);
            scene.setObjectsVisible(all, false);
        } else {
            scene.setObjectsVisible(all.filter((id) => visibilitySnapshot.visible.has(id)), true);
            scene.setObjectsXRayed(all, true);
        }
        scene.setObjectsVisible(highlighted, true);
        scene.setObjectsXRayed(highlighted, false);
        current.mode = mode;
        isolateButton.textContent = mode === "isolate" ? "Mostrar contexto" : "Isolar";
        isolateButton.classList.toggle("is-active", mode === "isolate");
        onVisibilityChange();
        requestRenderFrame();
    }

    function clear() {
        restoreColors();
        if (visibilitySnapshot) {
            const all = scene.objectIds.filter((id) => !String(id).startsWith("__"));
            scene.setObjectsVisible(all, false);
            scene.setObjectsVisible(all.filter((id) => visibilitySnapshot.visible.has(id)), true);
            scene.setObjectsXRayed(all, false);
            scene.setObjectsXRayed(all.filter((id) => visibilitySnapshot.xrayed.has(id)), true);
            visibilitySnapshot = null;
            onVisibilityChange();
        }
        current = null;
        bar.hidden = true;
        document.querySelectorAll(".quadro-summary-table tr.is-traced").forEach((row) => row.classList.remove("is-traced"));
        requestRenderFrame();
    }

    isolateButton.addEventListener("click", () => applyMode(current?.mode === "isolate" ? "context" : "isolate"));
    clearButton.addEventListener("click", clear);

    // -----------------------------------------------------------------------
    // Rastrear
    // -----------------------------------------------------------------------
    /** Todos os quadros/racks do modelo com o mesmo nome do clicado (ex.: dois "FD1" em pavimentos diferentes). */
    function panelIdsFor(panelId) {
        const metas = metaObjects();
        const modelId = scene.objects[panelId]?.model?.id;
        const name = normalize(metas[panelId]?.name);
        const ids = Object.values(scene.objects)
            .filter((entity) => entity.model?.id === modelId && entity.id !== panelId)
            .filter((entity) => normalize(metas[entity.id]?.name) === name && classify(metas[entity.id], null) === "panel")
            .map((entity) => entity.id);
        return [panelId, ...ids];
    }

    /** Pontos de cada circuito do quadro/rack, no mesmo modelo: { circuito: [ids] }. */
    function circuitsOfPanel(quadro, modelId) {
        const wantedQuadro = normalize(quadro);
        const result = {};
        for (const metaObject of Object.values(metaObjects())) {
            if (scene.objects[metaObject.id]?.model?.id !== modelId) continue;
            for (const entry of circuitsOf(metaObject)) {
                if (normalize(entry.quadro) !== wantedQuadro) continue;
                const key = normalizeCircuit(entry.circuito);
                (result[key] ||= []).includes(metaObject.id) || result[key].push(metaObject.id);
            }
        }
        return result;
    }

    /**
     * Comprimento estimado de todos os circuitos de um quadro/rack (ex.: verificação de 90 m do cabeamento).
     * Retorna { circuitoNormalizado: { length, reached, unreached, gaps } }.
     */
    async function traceLengths({ quadro, panelId, circuits: explicitCircuits = null }) {
        const modelId = scene.objects[panelId]?.model?.id || String(panelId).split("#")[0];
        const { modelKey } = await ensureGraph(modelId, panelId);
        // circuits: { chave: [ids dos pontos] } já filtrados (ex.: só o pavimento do rack)
        const circuits = explicitCircuits || circuitsOfPanel(quadro, modelId);
        const { results } = await ask({ type: "traceMany", modelKey, panelIds: panelIdsFor(panelId), circuits });
        if (!current) bar.hidden = true;
        return results;
    }
    /**
     * quadro: nome do quadro (ex.: "QDL-1"); circuito: texto do circuito (ex.: "7 - ILU - Reatores");
     * panelId: id do objeto do quadro na cena.
     */
    async function trace({ quadro, circuito, panelId, pointIds: explicitPointIds = null }) {
        const panelEntity = scene.objects[panelId];
        const modelId = panelEntity?.model?.id || String(panelId).split("#")[0];
        const wantedQuadro = normalize(quadro);
        const wantedCircuit = normalizeCircuit(circuito);

        // pontos do circuito (qualquer modelo carregado), ou os informados pela tabela
        const pointIds = explicitPointIds ? explicitPointIds.filter((id) => scene.objects[id]) : [];
        if (!explicitPointIds) for (const metaObject of Object.values(metaObjects())) {
            if (!scene.objects[metaObject.id]) continue;
            if (circuitsOf(metaObject).some((entry) =>
                normalize(entry.quadro) === wantedQuadro && normalizeCircuit(entry.circuito) === wantedCircuit)) {
                pointIds.push(metaObject.id);
            }
        }
        if (!pointIds.length) {
            setBar(`Nenhum ponto encontrado para ${quadro} • ${circuito}.`, { warn: true });
            return null;
        }

        try {
            const { modelKey } = await ensureGraph(modelId, panelId);
            const sameModelPoints = pointIds.filter((id) => scene.objects[id]?.model?.id === modelId);
            const panelIds = panelIdsFor(panelId);
            const result = await ask({ type: "trace", modelKey, panelIds, pointIds: sameModelPoints });

            restoreColors();
            current = {
                quadro, circuito,
                ids: {
                    route: result.route.filter((id) => !panelIds.includes(id) && !pointIds.includes(id)),
                    points: pointIds,
                    // o rack/quadro de onde o circuito sai de fato (com nomes repetidos, o mais próximo)
                    panel: panelIds.find((id) => result.route.includes(id)) || panelId
                },
                mode: "context"
            };
            colorize(current.ids.route, COLORS.route);
            colorize(current.ids.points, COLORS.point);
            colorize([current.ids.panel], COLORS.panel);
            applyMode("context");

            const aabb = scene.getAABB([...current.ids.route, ...pointIds, current.ids.panel]);
            viewer.cameraFlight.flyTo({ aabb, duration: 0.6 });

            const notReached = result.unreached.length + (pointIds.length - sameModelPoints.length);
            const meters = Math.round(result.length).toLocaleString("pt-BR");
            setBar(
                `${quadro} • ${circuito}: ${result.reached.length}/${pointIds.length} ponto(s) • ~${meters} m de infraestrutura` +
                (result.gaps ? ` • ${result.gaps} folga(s) de modelagem` : "") +
                (notReached ? ` • ${notReached} ponto(s) sem caminho até o quadro` : ""),
                { warn: notReached > 0 }
            );
            return result;
        } catch (error) {
            console.error("[circuito]", error);
            setBar(`Não foi possível rastrear o circuito: ${error?.message || error}`, { warn: true });
            return null;
        }
    }

    return {
        trace,
        traceLengths,
        normalizeCircuit,
        clear,
        forgetModel(modelId) {
            for (const key of [...builtModels.keys()]) {
                if (key.startsWith(`${modelId}|`)) {
                    builtModels.delete(key);
                    worker.postMessage({ type: "forget", modelKey: key });
                }
            }
        },
        destroy() {
            clear();
            worker.terminate();
            bar.remove();
        }
    };
}
