// Links diretos para uma interferência.
// O link leva para a mesma página do projeto com ?interferencia=<dados>, e o
// visualizador abre já com as duas peças isoladas, coloridas e enquadradas.
//
// Os dados ficam no próprio link (sem banco de dados): modelo + ID de cada peça,
// ponto da colisão e posição da câmera. Por isso o link continua funcionando
// enquanto os modelos com esses IDs estiverem publicados na página.

export const CLASH_LINK_PARAM = "interferencia";

const COLOR_A = [1, 0.82, 0];
const COLOR_B = [1, 0.18, 0.03];
const DEFAULT_UP = [0, 1, 0];
const WAIT_TIMEOUT_MS = 120000;

const round = (values, digits = 3) => values.map((n) => Number(Number(n).toFixed(digits)));

function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value) {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

/** Câmera padrão para uma interferência: vista 3/4 de cima, olhando para o ponto da colisão. */
export function defaultClashCamera(position, distance = 4) {
    const dir = [0.62, 0.5, 0.6];
    const len = Math.hypot(...dir);
    const eye = position.map((v, i) => v + (dir[i] / len) * distance);
    return { eye, look: [...position], up: [...DEFAULT_UP] };
}

/**
 * Monta o link de uma interferência.
 * @param {object} clash resultado da análise (objectA, objectB, position, mode)
 * @param {object} options { index, total, camera: {eye, look, up}, baseUrl }
 */
export function buildClashLink(clash, { index = 0, total = 1, camera = null, baseUrl = null } = {}) {
    const payload = {
        v: 1,
        n: index + 1,
        t: total,
        m: clash.mode === "clearance" ? 1 : 0,
        a: [clash.objectA.modelId, clash.objectA.objectId],
        b: [clash.objectB.modelId, clash.objectB.objectId]
    };
    if (Array.isArray(clash.position) && clash.position.length === 3) payload.p = round(clash.position);
    if (camera?.eye && camera?.look) {
        payload.e = round(camera.eye, 2);
        payload.l = round(camera.look, 2);
        const up = round(camera.up || DEFAULT_UP, 2);
        if (up.join() !== DEFAULT_UP.join()) payload.u = up;
    }
    const url = new URL(baseUrl || `${window.location.origin}${window.location.pathname}`);
    url.searchParams.set(CLASH_LINK_PARAM, toBase64Url(JSON.stringify(payload)));
    return url.toString();
}

export function readClashLink(search = window.location.search) {
    const raw = new URLSearchParams(search).get(CLASH_LINK_PARAM);
    if (!raw) return null;
    try {
        const data = JSON.parse(fromBase64Url(raw));
        if (data?.v !== 1 || !Array.isArray(data.a) || !Array.isArray(data.b)) return null;
        return data;
    } catch (error) {
        console.warn("[link da interferência] Link inválido.", error);
        return null;
    }
}

export function hasClashLink(search = window.location.search) {
    return new URLSearchParams(search).has(CLASH_LINK_PARAM);
}

// ---------------------------------------------------------------------------
// Abertura do link no visualizador
// ---------------------------------------------------------------------------

const STYLE = `
.clash-link-card{position:fixed;left:50%;bottom:56px;transform:translateX(-50%);z-index:100020;width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:14px 16px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:var(--ui-radius-lg,14px);background:var(--ui-surface,rgba(26,28,32,.92));color:var(--ui-text,#eceef1);box-shadow:var(--ui-shadow,0 10px 30px rgba(10,12,16,.28));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font:400 13px/1.45 var(--ui-font,system-ui,sans-serif)}
.clash-link-card[hidden]{display:none}
.clash-link-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
.clash-link-title{font-weight:600;font-size:15px;line-height:1.25}
.clash-link-sub{font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58));margin-top:2px}
.clash-link-close{width:30px;height:30px;margin:-4px -6px 0 0;border:none;border-radius:7px;background:transparent;color:var(--ui-text-muted,rgba(236,238,241,.58));font-size:14px;cursor:pointer}
.clash-link-close:hover{background:var(--ui-hover,rgba(255,255,255,.09));color:var(--ui-text,#eceef1)}
.clash-link-object{display:grid;grid-template-columns:12px minmax(0,1fr);gap:8px;align-items:baseline;margin:6px 0}
.clash-link-swatch{width:10px;height:10px;border-radius:3px;transform:translateY(1px)}
.clash-link-object strong{font-weight:600}
.clash-link-object small{display:block;font-size:11.5px;color:var(--ui-text-muted,rgba(236,238,241,.58));overflow-wrap:anywhere}
.clash-link-status{font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58))}
.clash-link-actions{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px;margin-top:12px}
.clash-link-actions button{height:34px;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:7px;background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1);font:600 12.5px var(--ui-font,system-ui,sans-serif);cursor:pointer}
.clash-link-actions button:hover{background:rgba(255,255,255,.12)}
.clash-link-actions button.is-primary{background:var(--ui-active-bg,#eceef1);border-color:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c)}
.clash-link-actions button.is-primary:hover{background:#fff}
.clash-link-actions button:focus-visible,.clash-link-close:focus-visible{outline:2px solid var(--ui-focus,#8fc1ff);outline-offset:2px}
body[data-mode="mobile"] .clash-link-card{bottom:76px}
`;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/**
 * Lê ?interferencia= da URL e, quando as duas peças estiverem carregadas,
 * mostra a interferência isolada.
 */
export function openClashFromUrl({ viewer, requestRenderFrame = () => {}, getModelLabel = (id) => id, onDone = () => {} }) {
    const data = readClashLink();
    if (!data) {
        onDone({ found: false });
        return null;
    }

    if (!document.getElementById("clashLinkStyle")) {
        const style = document.createElement("style");
        style.id = "clashLinkStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    const scene = viewer.scene;
    const card = document.createElement("section");
    card.className = "clash-link-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Interferência compartilhada");
    document.body.appendChild(card);

    const modeLabel = data.m === 1 ? "Proximidade / Folga" : "Interferência física";
    const title = data.t > 1 ? `Interferência ${data.n} de ${data.t}` : `Interferência ${data.n || 1}`;

    let ids = [null, null];
    let view = "isolate";            // "isolate" | "context"
    let active = true;
    const originalColors = new Map();

    const allIds = () => scene.objectIds.filter((id) => !String(id).startsWith("__"));

    function resolveSceneId([modelId, objectId]) {
        const objects = scene.objects;
        const candidates = [`${modelId}#${objectId}`, `${modelId}.${objectId}`, objectId];
        const direct = candidates.find((id) => objects[id] && (
            objects[id].model?.id === modelId || id.startsWith(`${modelId}#`) || id.startsWith(`${modelId}.`) || id === objectId
        ));
        if (direct) return direct;
        return Object.keys(objects).find((id) => objects[id].model?.id === modelId &&
            (id.endsWith(`#${objectId}`) || id.endsWith(`.${objectId}`))) || null;
    }

    function describe(sceneId, [modelId, objectId]) {
        const meta = viewer.metaScene?.metaObjects?.[sceneId];
        const type = meta?.type || "";
        const name = meta?.name && meta.name !== type ? meta.name : "";
        return {
            title: name || type || objectId,
            type,
            model: getModelLabel(modelId) || modelId,
            id: meta?.originalSystemId || objectId
        };
    }

    function renderLoading(message) {
        card.innerHTML = `
            <div class="clash-link-head">
                <div><div class="clash-link-title">${escapeHtml(title)}</div><div class="clash-link-sub">${escapeHtml(modeLabel)}</div></div>
                <button type="button" class="clash-link-close" aria-label="Fechar">✕</button>
            </div>
            <div class="clash-link-status" role="status">${escapeHtml(message)}</div>`;
        card.querySelector(".clash-link-close").onclick = exit;
    }

    function renderReady() {
        const a = describe(ids[0], data.a);
        const b = describe(ids[1], data.b);
        const objectRow = (info, color) => `
            <div class="clash-link-object">
                <span class="clash-link-swatch" style="background:${color}"></span>
                <div><strong>${escapeHtml(info.title)}</strong>
                <small>${escapeHtml([info.type, info.model].filter(Boolean).join(" | "))}</small></div>
            </div>`;
        card.innerHTML = `
            <div class="clash-link-head">
                <div><div class="clash-link-title">${escapeHtml(title)}</div><div class="clash-link-sub">${escapeHtml(modeLabel)}</div></div>
                <button type="button" class="clash-link-close" aria-label="Fechar e ver o modelo completo">✕</button>
            </div>
            ${objectRow(a, "#f5c400")}
            ${objectRow(b, "#eb3c14")}
            <div class="clash-link-actions">
                <button type="button" data-action="toggle">${view === "isolate" ? "Ver contexto" : "Isolar"}</button>
                <button type="button" data-action="frame">Reenquadrar</button>
                <button type="button" class="is-primary" data-action="exit">Modelo completo</button>
            </div>`;
        card.querySelector(".clash-link-close").onclick = exit;
        card.querySelector('[data-action="toggle"]').onclick = () => {
            view = view === "isolate" ? "context" : "isolate";
            applyView();
            renderReady();
        };
        card.querySelector('[data-action="frame"]').onclick = () => frame(true);
        card.querySelector('[data-action="exit"]').onclick = exit;
    }

    function applyView() {
        if (!active) return;
        const valid = ids.filter(Boolean);
        const everything = allIds();
        if (view === "isolate") {
            scene.setObjectsXRayed(everything, false);
            scene.setObjectsVisible(everything, false);
        } else {
            scene.setObjectsVisible(everything, true);
            scene.setObjectsXRayed(everything, true);
        }
        scene.setObjectsVisible(valid, true);
        scene.setObjectsXRayed(valid, false);
        ids.forEach((id, i) => {
            const entity = id && scene.objects[id];
            if (!entity) return;
            if (!originalColors.has(id)) originalColors.set(id, entity.colorize ? Array.from(entity.colorize) : null);
            entity.colorize = i === 0 ? COLOR_A : COLOR_B;
        });
        requestRenderFrame();
    }

    function frame(animated = false) {
        let camera = null;
        if (data.e && data.l) camera = { eye: data.e, look: data.l, up: data.u || DEFAULT_UP };
        else if (data.p) camera = defaultClashCamera(data.p);
        if (camera) {
            animated ? viewer.cameraFlight.flyTo({ ...camera, duration: 0.6 }) : viewer.cameraFlight.jumpTo(camera);
        } else {
            const valid = ids.filter(Boolean);
            if (valid.length) viewer.cameraFlight.jumpTo({ aabb: scene.getAABB(valid) });
        }
        requestRenderFrame();
    }

    function restoreColors() {
        for (const [id, color] of originalColors) {
            const entity = scene.objects[id];
            if (entity) entity.colorize = color;
        }
        originalColors.clear();
    }

    function cleanUrl() {
        const url = new URL(window.location.href);
        url.searchParams.delete(CLASH_LINK_PARAM);
        window.history.replaceState(window.history.state, "", url.toString());
    }

    function exit() {
        active = false;
        clearInterval(poll);
        modelLoadedSub && scene.off(modelLoadedSub);
        window.removeEventListener("viewer:models-loaded", onAllLoaded);
        const everything = allIds();
        scene.setObjectsXRayed(everything, false);
        scene.setObjectsVisible(everything, true);
        restoreColors();
        card.remove();
        cleanUrl();
        requestRenderFrame();
        if (!found) onDone({ found: false });
    }

    // Modelos que terminam de carregar depois da abertura entram ocultos (ou em raio-x)
    const modelLoadedSub = scene.on("modelLoaded", (modelId) => {
        if (!active) return;
        if (ids.every(Boolean)) {
            const model = scene.models?.[modelId];
            const newIds = (model?.entityList || []).map((e) => e.id).filter((id) => !ids.includes(id));
            if (newIds.length) {
                if (view === "isolate") scene.setObjectsVisible(newIds, false);
                else scene.setObjectsXRayed(newIds, true);
                requestRenderFrame();
            }
        }
    });

    // Quando a fila inteira termina, reaplica (o viewer pode ter mexido na visibilidade)
    const onAllLoaded = () => { if (active && ids.every(Boolean)) applyView(); };
    window.addEventListener("viewer:models-loaded", onAllLoaded);

    renderLoading("Carregando os modelos desta interferência…");
    const started = Date.now();
    let found = false;
    const poll = setInterval(() => {
        if (!active) return;
        ids = [resolveSceneId(data.a), resolveSceneId(data.b)];
        if (ids.every(Boolean)) {
            clearInterval(poll);
            found = true;
            applyView();
            frame(false);
            renderReady();
            onDone({ found: true });
            return;
        }
        if (Date.now() - started > WAIT_TIMEOUT_MS) {
            clearInterval(poll);
            renderLoading("Não encontrei os elementos desta interferência nesta página. O modelo pode ter sido atualizado ou removido.");
            onDone({ found: false });
        }
    }, 300);

    return {
        exit,
        isActive: () => active && found
    };
}
