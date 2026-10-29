// Importação de apontamentos BCF (.bcfzip / .bcf) dentro da Compatibilização BIM.
// Lê os tópicos (título, status, responsável, descrição, comentários, foto) e,
// ao clicar num apontamento, leva a câmera até ele e destaca as peças citadas.
//
// Coordenadas: o BCF usa o sistema do IFC (Z para cima); o visualizador usa Y para cima.
// Conversão: (x, y, z) do BCF → (x, z, -y) no visualizador.
import { SectionPlane } from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";

const JSZIP_URL = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

const STYLE = `
#collisionPanel .clash-tabs{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:0 0 14px;padding:3px;border-radius:10px;background:rgba(0,0,0,.22)}
#collisionPanel .clash-tabs button{height:28px;border:none;border-radius:7px;background:transparent;color:var(--ui-text-muted,rgba(236,238,241,.58));font:500 12px var(--ui-font,system-ui,sans-serif);cursor:pointer}
#collisionPanel .clash-tabs button:hover{background:var(--ui-hover,rgba(255,255,255,.09));color:var(--ui-text,#eceef1)}
#collisionPanel .clash-tabs button.is-active{background:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c);font-weight:600}
#collisionPanel .bcf-drop{display:flex;flex-direction:column;align-items:center;gap:6px;padding:18px 12px;margin-bottom:12px;border:1.5px dashed rgba(255,255,255,.18);border-radius:10px;text-align:center;color:var(--ui-text-muted,rgba(236,238,241,.58));font-size:12px;cursor:pointer;transition:border-color .15s ease,background-color .15s ease}
#collisionPanel .bcf-drop:hover,#collisionPanel .bcf-drop.is-over{border-color:rgba(255,255,255,.4);background:rgba(255,255,255,.04)}
#collisionPanel .bcf-drop strong{color:var(--ui-text,#eceef1);font-size:13px}
#collisionPanel .bcf-drop svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
#collisionPanel .bcf-file{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58))}
#collisionPanel .bcf-file > span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#collisionPanel .bcf-file b{color:var(--ui-text,#eceef1);font-weight:600}
#collisionPanel .bcf-link{flex:0 0 auto;border:none;background:none;padding:2px 4px;color:var(--ui-text-muted,rgba(236,238,241,.58));font:500 12px var(--ui-font,system-ui,sans-serif);cursor:pointer;text-decoration:underline}
#collisionPanel .bcf-link:hover{color:var(--ui-text,#eceef1)}
#collisionPanel .bcf-filters{display:grid;grid-template-columns:minmax(0,1fr) 120px;gap:8px;margin-bottom:10px}
#collisionPanel .bcf-filters input,#collisionPanel .bcf-filters select{margin-top:0!important}
#collisionPanel .bcf-list{display:flex;flex-direction:column;gap:2px;max-height:min(46vh,420px);overflow-y:auto;margin:0 -4px 10px;padding:0 4px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}
#collisionPanel .bcf-item{display:grid;grid-template-columns:56px minmax(0,1fr);gap:10px;align-items:start;width:100%;padding:6px;border:none;border-radius:8px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
#collisionPanel .bcf-item:hover{background:var(--ui-hover,rgba(255,255,255,.09))}
#collisionPanel .bcf-item.is-active{background:rgba(255,255,255,.14)}
#collisionPanel .bcf-thumb{width:56px;height:42px;border-radius:6px;object-fit:cover;background:rgba(255,255,255,.06)}
#collisionPanel .bcf-title{font-size:12.5px;font-weight:600;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#collisionPanel .bcf-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 8px;margin-top:3px;font-size:11px;color:var(--ui-text-muted,rgba(236,238,241,.58))}
#collisionPanel .bcf-status{padding:1px 7px;border-radius:999px;font-size:10.5px;font-weight:600;background:rgba(229,57,53,.2);color:#ff8a80}
#collisionPanel .bcf-status.is-closed{background:rgba(34,160,90,.22);color:#7ee2a8}
#collisionPanel .bcf-detail{margin-bottom:10px;padding:10px 12px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:10px;background:rgba(255,255,255,.04);font-size:12px;line-height:1.5}
#collisionPanel .bcf-detail h4{margin:0 0 4px;font-size:13px;font-weight:600}
#collisionPanel .bcf-detail img{display:block;width:100%;margin:8px 0;border-radius:6px}
#collisionPanel .bcf-detail .bcf-desc{white-space:pre-wrap;color:var(--ui-text,#eceef1)}
#collisionPanel .bcf-detail .bcf-comment{margin-top:8px;padding-top:8px;border-top:1px solid var(--ui-border,rgba(255,255,255,.08))}
#collisionPanel .bcf-detail .bcf-comment small{display:block;color:var(--ui-text-muted,rgba(236,238,241,.58));font-size:11px}
#collisionPanel .bcf-note{margin-top:6px;font-size:11.5px;color:#f2b94b}
#collisionPanel .bcf-actions{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px;margin-top:8px}
#collisionPanel .bcf-actions button{height:32px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:7px;background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1);font:600 12px var(--ui-font,system-ui,sans-serif);cursor:pointer}
#collisionPanel .bcf-actions button:hover{background:rgba(255,255,255,.12)}
#collisionPanel .bcf-actions button.is-active{background:var(--ui-active-bg,#eceef1);border-color:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c)}
#collisionPanel .bcf-empty{font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58));margin:4px 0 10px}
`;

const UPLOAD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/></svg>';

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isClosedStatus = (status) => /conclu|closed|resolv|fechad|done/i.test(String(status || ""));
const formatDate = (iso) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("pt-BR");
};

let jszipPromise = null;
export function ensureJSZip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    jszipPromise ||= new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = JSZIP_URL;
        script.onload = () => resolve(window.JSZip);
        script.onerror = () => { jszipPromise = null; reject(new Error("Não foi possível carregar o leitor de arquivos .zip.")); };
        document.head.appendChild(script);
    });
    return jszipPromise;
}

// ---------------------------------------------------------------------------
// Leitura do arquivo
// ---------------------------------------------------------------------------
const childText = (node, name) => node?.getElementsByTagName(name)?.[0]?.textContent?.trim() || "";
const vec = (node) => node ? [Number(childText(node, "X")), Number(childText(node, "Y")), Number(childText(node, "Z"))] : null;

function parseXml(text) {
    const doc = new DOMParser().parseFromString(String(text).replace(/^\uFEFF/, ""), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("XML inválido no BCF.");
    return doc;
}

function parseViewpoint(text) {
    const doc = parseXml(text);
    const components = [...doc.getElementsByTagName("Component")].map((c) => ({
        guid: c.getAttribute("IfcGuid") || "",
        selected: c.getAttribute("Selected") === "true" || c.parentElement?.tagName === "Selection",
        visible: c.getAttribute("Visible") !== "false"
    })).filter((c) => c.guid);
    const visibilityNode = doc.getElementsByTagName("Visibility")[0];
    const defaultVisibility = visibilityNode ? visibilityNode.getAttribute("DefaultVisibility") !== "false" : true;
    const exceptions = visibilityNode
        ? [...visibilityNode.getElementsByTagName("Component")].map((c) => c.getAttribute("IfcGuid")).filter(Boolean)
        : [];
    const persp = doc.getElementsByTagName("PerspectiveCamera")[0];
    const ortho = doc.getElementsByTagName("OrthogonalCamera")[0];
    const cam = persp || ortho;
    const camera = cam ? {
        type: persp ? "perspective" : "ortho",
        eye: vec(cam.getElementsByTagName("CameraViewPoint")[0]),
        dir: vec(cam.getElementsByTagName("CameraDirection")[0]),
        up: vec(cam.getElementsByTagName("CameraUpVector")[0]),
        fov: Number(childText(cam, "FieldOfView")) || 45,
        scale: Number(childText(cam, "ViewToWorldScale")) || null
    } : null;
    const clippingPlanes = [...doc.getElementsByTagName("ClippingPlane")].map((p) => ({
        location: vec(p.getElementsByTagName("Location")[0]),
        direction: vec(p.getElementsByTagName("Direction")[0])
    })).filter((p) => p.location && p.direction);
    return { components, defaultVisibility, exceptions, camera, clippingPlanes };
}

function parseMarkup(text) {
    const doc = parseXml(text);
    const topic = doc.getElementsByTagName("Topic")[0];
    if (!topic) return null;
    const comments = [...doc.getElementsByTagName("Comment")]
        .filter((c) => c.getAttribute("Guid"))
        .map((c) => ({
            author: childText(c, "Author"),
            date: childText(c, "Date"),
            text: [...c.children].find((child) => child.tagName === "Comment")?.textContent?.trim() || ""
        }))
        .filter((c) => c.text);
    const viewpoints = [...doc.getElementsByTagName("Viewpoints")].map((v) => ({
        file: childText(v, "Viewpoint"),
        snapshot: childText(v, "Snapshot")
    }));
    return {
        guid: topic.getAttribute("Guid") || "",
        type: topic.getAttribute("TopicType") || "",
        status: topic.getAttribute("TopicStatus") || "",
        title: childText(topic, "Title") || "Sem título",
        priority: childText(topic, "Priority"),
        index: Number(childText(topic, "Index")) || null,
        labels: [...topic.getElementsByTagName("Labels")].map((l) => l.textContent.trim()).filter(Boolean),
        author: childText(topic, "CreationAuthor"),
        assignedTo: childText(topic, "AssignedTo"),
        description: childText(topic, "Description"),
        created: childText(topic, "CreationDate"),
        comments,
        viewpoints
    };
}

/** Lê .bcfzip/.zip (pastas por tópico) ou um .bcf solto (só a marcação). */
export async function readBcfFile(file) {
    const name = file.name || "arquivo";
    if (/\.bcf$/i.test(name) && !/\.bcfzip$/i.test(name)) {
        const topic = parseMarkup(await file.text());
        if (!topic) throw new Error("Nenhum apontamento encontrado no arquivo.");
        return [{ ...topic, viewpoint: null, snapshotUrl: null }];
    }
    const JSZip = await ensureJSZip();
    const zip = await JSZip.loadAsync(file);
    const folders = new Map();
    zip.forEach((path, entry) => {
        if (entry.dir) return;
        const parts = path.split("/");
        if (parts.length < 2) return;
        const folder = parts.slice(0, -1).join("/");
        if (!folders.has(folder)) folders.set(folder, {});
        folders.get(folder)[parts[parts.length - 1].toLowerCase()] = entry;
    });

    const topics = [];
    for (const [folder, files] of folders) {
        if (!files["markup.bcf"]) continue;
        const topic = parseMarkup(await files["markup.bcf"].async("string"));
        if (!topic) continue;
        const ref = topic.viewpoints[0] || {};
        const viewpointEntry = files[(ref.file || "viewpoint.bcfv").toLowerCase()] || Object.entries(files).find(([n]) => n.endsWith(".bcfv"))?.[1];
        const snapshotEntry = files[(ref.snapshot || "snapshot.png").toLowerCase()] || Object.entries(files).find(([n]) => /\.(png|jpe?g)$/.test(n))?.[1];
        let viewpoint = null;
        try {
            viewpoint = viewpointEntry ? parseViewpoint(await viewpointEntry.async("string")) : null;
        } catch (error) {
            console.warn("[BCF] Ponto de vista ilegível em", folder, error);
        }
        const snapshotUrl = snapshotEntry
            ? URL.createObjectURL(await snapshotEntry.async("blob"))
            : null;
        topics.push({ ...topic, folder, viewpoint, snapshotUrl });
    }
    topics.sort((a, b) => (b.index ?? 0) - (a.index ?? 0) || String(b.created).localeCompare(String(a.created)));
    if (!topics.length) throw new Error("Nenhum apontamento (markup.bcf) encontrado no arquivo.");
    return topics;
}

// ---------------------------------------------------------------------------
// Aplicação no visualizador
// ---------------------------------------------------------------------------
const toViewer = (v) => [v[0], v[2], -v[1]];          // Z para cima (IFC) → Y para cima
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return scale(a, 1 / l); };

export function createBcfImport({ viewer, panel, requestRenderFrame = () => {} }) {
    const scene = viewer.scene;
    if (!document.getElementById("bcfImportStyle")) {
        const style = document.createElement("style");
        style.id = "bcfImportStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    // Abas: o conteúdo atual do painel vira a aba "Análise"
    const header = panel.querySelector(".collision-panel-header");
    const analysis = document.createElement("div");
    analysis.className = "clash-tab-analysis";
    while (header.nextSibling) analysis.appendChild(header.nextSibling);
    const tabs = document.createElement("div");
    tabs.className = "clash-tabs";
    tabs.setAttribute("role", "tablist");
    tabs.innerHTML = '<button type="button" class="is-active" data-tab="analysis">Análise</button><button type="button" data-tab="bcf">Apontamentos BCF</button>';
    const section = document.createElement("div");
    section.className = "clash-tab-bcf";
    section.hidden = true;
    header.after(tabs, analysis, section);

    let topics = [];
    let fileName = "";
    let activeGuid = null;
    let isolate = false;
    let applied = null;           // { ids, planes }
    let guidIndex = null;

    function buildGuidIndex() {
        guidIndex = new Map();
        for (const metaObject of Object.values(viewer.metaScene?.metaObjects || {})) {
            const guid = metaObject.originalSystemId || String(metaObject.id).split("#").pop();
            if (!guid || !scene.objects[metaObject.id]) continue;
            if (!guidIndex.has(guid)) guidIndex.set(guid, []);
            guidIndex.get(guid).push(metaObject.id);
        }
    }
    scene.on("modelLoaded", () => { guidIndex = null; });
    const idsFor = (guids) => {
        if (!guidIndex) buildGuidIndex();
        return guids.flatMap((g) => guidIndex.get(g) || []);
    };

    function clearApplied() {
        if (!applied) return;
        const all = scene.objectIds.filter((id) => !String(id).startsWith("__"));
        scene.setObjectsSelected(applied.ids, false);
        scene.setObjectsXRayed(all, false);
        if (applied.hidden?.length) scene.setObjectsVisible(applied.hidden, true);
        applied.planes.forEach((p) => p.destroy());
        applied = null;
        requestRenderFrame();
    }

    function applyTopic(topic) {
        clearApplied();
        const vp = topic.viewpoint;
        const notes = [];
        if (!vp) {
            notes.push("Este apontamento não tem ponto de vista salvo.");
            return notes;
        }
        const selectedGuids = vp.components.filter((c) => c.selected).map((c) => c.guid);
        const allGuids = vp.components.map((c) => c.guid);
        const ids = idsFor(selectedGuids.length ? selectedGuids : allGuids);
        const all = scene.objectIds.filter((id) => !String(id).startsWith("__"));
        const state = { ids, planes: [], hidden: [] };

        // Visibilidade do BCF (padrão invisível + exceções)
        if (vp.defaultVisibility === false && vp.exceptions.length) {
            const keep = new Set(idsFor(vp.exceptions));
            state.hidden = all.filter((id) => !keep.has(id) && scene.objects[id]?.visible);
            scene.setObjectsVisible(state.hidden, false);
        }
        if (ids.length) {
            scene.setObjectsVisible(ids, true);
            scene.setObjectsSelected(ids, true);
            if (isolate) {
                scene.setObjectsXRayed(all, true);
                scene.setObjectsXRayed(ids, false);
            }
        } else if (allGuids.length) {
            notes.push("As peças citadas no apontamento não foram encontradas nos modelos carregados.");
        }

        // Câmera: confere se as coordenadas do BCF batem com as do modelo
        const cam = vp.camera;
        let coordinatesMatch = false;
        if (cam?.eye && cam?.dir) {
            const eye = toViewer(cam.eye);
            const dir = norm(toViewer(cam.dir));
            const up = cam.up ? toViewer(cam.up) : [0, 1, 0];
            if (ids.length) {
                const a = scene.getAABB(ids);
                const center = [(a[0] + a[3]) / 2, (a[1] + a[4]) / 2, (a[2] + a[5]) / 2];
                const size = Math.max(a[3] - a[0], a[4] - a[1], a[5] - a[2], 1);
                // Distância da peça à linha de visão da câmera do BCF
                const toCenter = sub(center, eye);
                const along = dot(toCenter, dir);
                const off = Math.hypot(...sub(toCenter, scale(dir, along)));
                coordinatesMatch = along > 0 && off < Math.max(3, size * 1.5);
                if (coordinatesMatch) {
                    viewer.cameraFlight.flyTo({ eye, look: add(eye, scale(dir, along)), up, duration: 0.6 });
                } else {
                    // Coordenadas diferentes (origem deslocada): mantém o ângulo do BCF e enquadra a peça
                    const distance = Math.max(3, size * 2.2);
                    viewer.cameraFlight.flyTo({ eye: sub(center, scale(dir, distance)), look: center, up, duration: 0.6 });
                }
            } else {
                const sceneBox = scene.aabb;
                const sceneCenter = [(sceneBox[0] + sceneBox[3]) / 2, (sceneBox[1] + sceneBox[4]) / 2, (sceneBox[2] + sceneBox[5]) / 2];
                const sceneSize = Math.hypot(sceneBox[3] - sceneBox[0], sceneBox[4] - sceneBox[1], sceneBox[5] - sceneBox[2]);
                coordinatesMatch = Math.hypot(...sub(eye, sceneCenter)) < sceneSize * 3;
                if (coordinatesMatch) {
                    viewer.cameraFlight.flyTo({ eye, look: add(eye, scale(dir, Math.max(5, sceneSize * 0.3))), up, duration: 0.6 });
                } else {
                    notes.push("O ponto de vista deste apontamento está em outra posição de coordenadas. Veja a foto do apontamento como referência.");
                }
            }
            if (cam.type === "perspective" && viewer.camera.perspective) viewer.camera.perspective.fov = cam.fov;
        }

        // Planos de corte: só quando as coordenadas batem (senão cortariam no lugar errado)
        if (vp.clippingPlanes.length) {
            if (coordinatesMatch) {
                vp.clippingPlanes.forEach((plane, i) => {
                    // No BCF a direção aponta para o lado escondido; no visualizador, para o lado que fica
                    state.planes.push(new SectionPlane(scene, {
                        id: `bcfClip${Date.now()}_${i}`,
                        pos: toViewer(plane.location),
                        dir: scale(toViewer(plane.direction), -1)
                    }));
                });
            } else {
                notes.push("O corte do apontamento não foi aplicado: o modelo está em coordenadas diferentes das do arquivo BCF.");
            }
        }
        applied = state;
        requestRenderFrame();
        return notes;
    }

    function filtered() {
        const query = (section.querySelector(".bcf-search")?.value || "").trim().toLowerCase();
        const status = section.querySelector(".bcf-status-filter")?.value || "open";
        return topics.filter((t) => {
            if (status === "open" && isClosedStatus(t.status)) return false;
            if (status === "closed" && !isClosedStatus(t.status)) return false;
            if (!query) return true;
            return [t.title, t.description, t.assignedTo, t.author, t.labels.join(" "), t.index].join(" ").toLowerCase().includes(query);
        });
    }

    function renderDetail(topic, notes = []) {
        const detail = section.querySelector(".bcf-detail-slot");
        if (!topic) {
            detail.innerHTML = "";
            return;
        }
        detail.innerHTML = `
            <div class="bcf-detail">
                <h4>${topic.index ? `#${topic.index} ` : ""}${escapeHtml(topic.title)}</h4>
                <div class="bcf-meta">
                    <span class="bcf-status ${isClosedStatus(topic.status) ? "is-closed" : ""}">${escapeHtml(topic.status || "Sem status")}</span>
                    ${topic.assignedTo ? `<span>Responsável: ${escapeHtml(topic.assignedTo)}</span>` : ""}
                    ${topic.labels.length ? `<span>${escapeHtml(topic.labels.join(", "))}</span>` : ""}
                </div>
                ${topic.snapshotUrl ? `<img src="${topic.snapshotUrl}" alt="Foto do apontamento">` : ""}
                ${topic.description ? `<div class="bcf-desc">${escapeHtml(topic.description)}</div>` : ""}
                ${topic.comments.map((c) => `<div class="bcf-comment"><small>${escapeHtml(c.author)} | ${formatDate(c.date)}</small>${escapeHtml(c.text)}</div>`).join("")}
                ${notes.map((n) => `<div class="bcf-note">${escapeHtml(n)}</div>`).join("")}
                <div class="bcf-actions">
                    <button type="button" data-bcf="isolate" class="${isolate ? "is-active" : ""}">${isolate ? "Isolado" : "Isolar peças"}</button>
                    <button type="button" data-bcf="clear">Limpar vista</button>
                </div>
            </div>`;
    }

    function renderList() {
        const list = section.querySelector(".bcf-list");
        const items = filtered();
        if (!items.length) {
            list.innerHTML = `<p class="bcf-empty">Nenhum apontamento com esse filtro.</p>`;
            return;
        }
        list.innerHTML = items.map((t) => `
            <button type="button" class="bcf-item ${t.guid === activeGuid ? "is-active" : ""}" data-guid="${escapeHtml(t.guid)}">
                ${t.snapshotUrl ? `<img class="bcf-thumb" src="${t.snapshotUrl}" alt="" loading="lazy">` : '<span class="bcf-thumb"></span>'}
                <span>
                    <span class="bcf-title">${t.index ? `#${t.index} ` : ""}${escapeHtml(t.title)}</span>
                    <span class="bcf-meta">
                        <span class="bcf-status ${isClosedStatus(t.status) ? "is-closed" : ""}">${escapeHtml(t.status || "Sem status")}</span>
                        ${t.assignedTo ? `<span>${escapeHtml(t.assignedTo)}</span>` : ""}
                        ${t.comments.length ? `<span>${t.comments.length} comentário(s)</span>` : ""}
                    </span>
                </span>
            </button>`).join("");
    }

    function render() {
        if (!topics.length) {
            section.innerHTML = `
                <label class="bcf-drop" tabindex="0">
                    ${UPLOAD_ICON}
                    <strong>Importar apontamentos BCF</strong>
                    <span>Clique ou arraste aqui um arquivo .bcfzip ou .bcf (Collab, BIMcollab, Navisworks, Revit…)</span>
                    <input type="file" accept=".bcfzip,.bcf,.zip" hidden>
                </label>
                <p class="bcf-empty bcf-status-text" role="status"></p>`;
            bindDrop();
            return;
        }
        const open = topics.filter((t) => !isClosedStatus(t.status)).length;
        section.innerHTML = `
            <div class="bcf-file"><span title="${escapeHtml(fileName)}"><b>${topics.length} apontamento(s)</b>, ${open} em aberto | ${escapeHtml(fileName)}</span>
                <button type="button" class="bcf-link" data-bcf="other">Trocar arquivo</button>
                <input type="file" accept=".bcfzip,.bcf,.zip" hidden></div>
            <div class="bcf-filters">
                <input type="text" class="bcf-search" placeholder="Buscar título, responsável, código…">
                <select class="bcf-status-filter">
                    <option value="open">Em aberto</option>
                    <option value="closed">Concluídos</option>
                    <option value="all">Todos</option>
                </select>
            </div>
            <div class="bcf-detail-slot"></div>
            <div class="bcf-list"></div>`;
        section.querySelector(".bcf-search").addEventListener("input", renderList);
        section.querySelector(".bcf-status-filter").addEventListener("change", renderList);
        section.querySelector('[data-bcf="other"]').addEventListener("click", () => section.querySelector('.bcf-file input').click());
        section.querySelector(".bcf-file input").addEventListener("change", (e) => loadFile(e.target.files?.[0]));
        renderList();
        const active = topics.find((t) => t.guid === activeGuid);
        if (active) renderDetail(active);
    }

    function bindDrop() {
        const drop = section.querySelector(".bcf-drop");
        const input = drop.querySelector("input");
        input.addEventListener("change", (e) => loadFile(e.target.files?.[0]));
        drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
        drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
        drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
        drop.addEventListener("drop", (e) => {
            e.preventDefault();
            drop.classList.remove("is-over");
            loadFile(e.dataTransfer?.files?.[0]);
        });
    }

    async function loadFile(file) {
        if (!file) return;
        const statusText = section.querySelector(".bcf-status-text");
        if (statusText) statusText.textContent = `Lendo ${file.name}…`;
        try {
            const next = await readBcfFile(file);
            topics.forEach((t) => t.snapshotUrl && URL.revokeObjectURL(t.snapshotUrl));
            clearApplied();
            topics = next;
            fileName = file.name;
            activeGuid = null;
            render();
        } catch (error) {
            console.error("[BCF]", error);
            if (statusText) statusText.textContent = `Não foi possível ler o arquivo: ${error.message}`;
            else alert(`Não foi possível ler o arquivo: ${error.message}`);
        }
    }

    // Eventos
    tabs.addEventListener("click", (event) => {
        const tab = event.target.closest("[data-tab]")?.dataset.tab;
        if (!tab) return;
        tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === tab));
        analysis.hidden = tab !== "analysis";
        section.hidden = tab !== "bcf";
        if (tab === "bcf" && !section.childElementCount) render();
    });
    section.addEventListener("click", (event) => {
        const item = event.target.closest(".bcf-item");
        if (item) {
            const topic = topics.find((t) => t.guid === item.dataset.guid);
            if (!topic) return;
            activeGuid = topic.guid;
            const notes = applyTopic(topic);
            renderList();
            renderDetail(topic, notes);
            return;
        }
        const action = event.target.closest("[data-bcf]")?.dataset.bcf;
        if (action === "isolate") {
            isolate = !isolate;
            const topic = topics.find((t) => t.guid === activeGuid);
            if (topic) renderDetail(topic, applyTopic(topic));
        } else if (action === "clear") {
            clearApplied();
            activeGuid = null;
            renderDetail(null);
            renderList();
        }
    });

    return {
        clear: clearApplied,
        destroy() {
            clearApplied();
            topics.forEach((t) => t.snapshotUrl && URL.revokeObjectURL(t.snapshotUrl));
        }
    };
}
