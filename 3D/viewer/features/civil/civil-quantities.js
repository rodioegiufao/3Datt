// Instalações civis (Hidráulico, Irrigação, Gás GLP, Águas Pluviais, Sanitário, Incêndio).
// Lê as peças dos modelos civis, identifica rede (sigla do arquivo) e sub-rede
// (propriedade "Rede" da peça) e associa cada material à composição da
// base_de_dados_sic.xlsx. Carregado sob demanda, só para quem tem acesso a materiais.
import {
    CIVIL_DISCIPLINES,
    aggregateCivilPieces,
    buildCivilBudgetRows,
    buildCivilDatabase,
    describeCivilPending,
    detectCivilDiscipline
} from "./civil-core.js";

const DATABASE_URL = "/3D/base_de_dados_sic.xlsx";
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";

const STYLE = `
#civilPanel{position:fixed;top:76px;right:16px;width:380px;max-width:calc(100vw - 32px);max-height:calc(100vh - 140px);box-sizing:border-box;display:flex;flex-direction:column;padding:16px;z-index:300001;color:var(--ui-text,#eceef1);background:var(--ui-surface,rgba(26,28,32,.92));border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:var(--ui-radius-lg,14px);box-shadow:var(--ui-shadow,0 10px 30px rgba(10,12,16,.28));backdrop-filter:blur(14px) saturate(140%);-webkit-backdrop-filter:blur(14px) saturate(140%);font:400 13px/1.45 var(--ui-font,system-ui,sans-serif)}
#civilPanel[hidden]{display:none}
#civilPanel [hidden]{display:none!important}
#civilPanel .civil-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}
#civilPanel .civil-title{font-weight:600;font-size:15px;line-height:1.25}
#civilPanel .civil-sub{font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58));margin-top:2px}
#civilPanel .civil-close{flex:0 0 auto;width:30px;height:30px;margin:-4px -6px 0 0;border:none;border-radius:7px;background:transparent;color:var(--ui-text-muted,rgba(236,238,241,.58));font-size:14px;cursor:pointer}
#civilPanel .civil-close:hover{background:var(--ui-hover,rgba(255,255,255,.09));color:var(--ui-text,#eceef1)}
#civilPanel .civil-models{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
#civilPanel .civil-chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 4px;border-radius:999px;background:var(--ui-raised,rgba(255,255,255,.06));font-size:12px}
#civilPanel .civil-chip b{padding:1px 6px;border-radius:999px;background:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c);font-size:10.5px;font-weight:700;letter-spacing:.02em}
#civilPanel .civil-empty{font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58));margin-bottom:12px}
#civilPanel .civil-actions{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px;margin-bottom:12px}
#civilPanel .civil-actions button{height:36px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:7px;background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1);font:600 13px var(--ui-font,system-ui,sans-serif);cursor:pointer}
#civilPanel .civil-actions button:hover:not(:disabled){background:rgba(255,255,255,.12)}
#civilPanel .civil-actions button.is-primary{background:var(--ui-active-bg,#eceef1);border-color:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c)}
#civilPanel .civil-actions button.is-primary:hover:not(:disabled){background:#fff}
#civilPanel button:disabled{opacity:.4;cursor:default}
#civilPanel button:focus-visible{outline:2px solid var(--ui-focus,#8fc1ff);outline-offset:2px}
#civilPanel .civil-status{font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58));margin:0 0 12px}
#civilPanel .civil-status:empty{display:none}
#civilPanel .civil-tabs{display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:3px;margin-bottom:10px;border-radius:10px;background:rgba(0,0,0,.22)}
#civilPanel .civil-tabs button{height:28px;border:none;border-radius:7px;background:transparent;color:var(--ui-text-muted,rgba(236,238,241,.58));font:500 12px var(--ui-font,system-ui,sans-serif);cursor:pointer}
#civilPanel .civil-tabs button:hover{background:var(--ui-hover,rgba(255,255,255,.09));color:var(--ui-text,#eceef1)}
#civilPanel .civil-tabs button.is-active{background:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c);font-weight:600}
#civilPanel .civil-list{flex:1;min-height:0;overflow-y:auto;margin:0 -4px;padding:0 4px;scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}
#civilPanel .civil-group{margin:10px 0 4px;font-size:12px;font-weight:600;display:flex;align-items:center;gap:6px}
#civilPanel .civil-group:first-child{margin-top:0}
#civilPanel .civil-group b{padding:1px 6px;border-radius:999px;background:var(--ui-raised,rgba(255,255,255,.06));font-size:10.5px}
#civilPanel .civil-subgroup{margin:6px 0 2px 2px;font-size:11px;font-weight:500;color:var(--ui-text-muted,rgba(236,238,241,.58))}
#civilPanel .civil-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:start;width:100%;padding:7px 8px;border:none;border-radius:7px;background:transparent;color:inherit;text-align:left;font:inherit;cursor:pointer}
#civilPanel .civil-row:hover{background:var(--ui-hover,rgba(255,255,255,.09))}
#civilPanel .civil-row.is-active{background:rgba(255,255,255,.14)}
#civilPanel .civil-row-main{min-width:0}
#civilPanel .civil-row-title{font-size:12.5px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
#civilPanel .civil-row-meta{margin-top:2px;font-size:11px;color:var(--ui-text-muted,rgba(236,238,241,.58));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#civilPanel .civil-row-qty{font-size:12.5px;font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
#civilPanel .civil-row-qty small{font-weight:400;color:var(--ui-text-muted,rgba(236,238,241,.58))}
#civilPanel .civil-code{font-variant-numeric:tabular-nums}
#civilPanel .civil-warn{color:#f2b94b}
body[data-mode="mobile"] #civilPanel{top:12px;left:12px;right:72px;width:auto;max-width:none;max-height:calc(100dvh - 80px)}
`;

const ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.7c3 3.6 6 6.9 6 10.3a6 6 0 0 1-12 0c0-3.4 3-6.7 6-10.3Z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/></svg>';

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const formatQty = (value, unit) => {
    const isLength = /^m$|metro/i.test(String(unit || ""));
    return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: isLength ? 2 : 0, maximumFractionDigits: isLength ? 2 : 2 });
};

let xlsxPromise = null;
function ensureXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    xlsxPromise ||= new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = XLSX_URL;
        script.onload = () => resolve(window.XLSX);
        script.onerror = () => { xlsxPromise = null; reject(new Error("Não foi possível carregar a biblioteca de Excel.")); };
        document.head.appendChild(script);
    });
    return xlsxPromise;
}

let databasePromise = null;
async function loadDatabase() {
    databasePromise ||= (async () => {
        const XLSX = await ensureXLSX();
        const response = await fetch(DATABASE_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`Base de dados não encontrada em ${DATABASE_URL} (status ${response.status}).`);
        const workbook = XLSX.read(await response.arrayBuffer(), { type: "array" });
        const sheet = (names, fallbackIndex) => {
            const found = workbook.SheetNames.find((name) => names.some((n) => n.toLowerCase() === name.toLowerCase()));
            return workbook.Sheets[found || workbook.SheetNames[fallbackIndex]];
        };
        const associa = XLSX.utils.sheet_to_json(sheet(["Associa"], 0), { defval: "" });
        const descricao = XLSX.utils.sheet_to_json(sheet(["Descricao", "Descrição"], 1), { defval: "" });
        return buildCivilDatabase(associa, descricao);
    })();
    databasePromise.catch(() => { databasePromise = null; });
    return databasePromise;
}

/**
 * @param {object} deps
 * @param {Viewer} deps.viewer
 * @param {() => Array} deps.getModels             modelos do projeto ({ id, src, displayName })
 * @param {(metaObject) => string} deps.getSubnetwork  sub-rede da peça (aba "Redes" do Explorador)
 * @param {(pset) => boolean} deps.isItemsPropertySet  conjunto "Itens associados" do AltoQi
 * @param {(value) => number|null} deps.readNumber
 * @param {(prop, number) => {quantity, unitLabel}} deps.normalizeQuantity
 * @param {() => void} deps.requestRenderFrame
 */
export function createCivilQuantitiesFeature(deps) {
    const { viewer, getModels, getSubnetwork, isItemsPropertySet, readNumber, normalizeQuantity, requestRenderFrame = () => {} } = deps;
    const scene = viewer.scene;

    if (!document.getElementById("civilQuantitiesStyle")) {
        const style = document.createElement("style");
        style.id = "civilQuantitiesStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    // Botão na barra (entra no grupo de ferramentas, antes da Ajuda)
    const toolbarButton = document.createElement("button");
    toolbarButton.id = "btnCivilPanel";
    toolbarButton.type = "button";
    toolbarButton.className = "tool-button";
    toolbarButton.innerHTML = `${ICON}<span class="tool-label">Instalações civis</span>`;
    toolbarButton.dataset.uiV2 = "1";                 // já vem no estilo da barra
    toolbarButton.dataset.tip = "Instalações civis (rede e sub-rede)";
    toolbarButton.setAttribute("aria-label", "Instalações civis: quantitativo por rede e sub-rede");
    const helpButton = document.getElementById("btnHelp");
    helpButton?.parentElement?.insertBefore(toolbarButton, helpButton);

    const panel = document.createElement("section");
    panel.id = "civilPanel";
    panel.hidden = true;
    panel.setAttribute("aria-label", "Instalações civis");
    panel.innerHTML = `
        <div class="civil-head">
            <div>
                <div class="civil-title">Instalações civis</div>
                <div class="civil-sub">Composições por rede e sub-rede (base SIC)</div>
            </div>
            <button type="button" class="civil-close" aria-label="Fechar painel">✕</button>
        </div>
        <div class="civil-models"></div>
        <div class="civil-actions">
            <button type="button" class="is-primary" data-action="run">Gerar quantitativo</button>
            <button type="button" data-action="excel" disabled>Baixar Excel</button>
        </div>
        <p class="civil-status" role="status"></p>
        <div class="civil-tabs" role="tablist" hidden>
            <button type="button" data-tab="matched" class="is-active">Associados</button>
            <button type="button" data-tab="pending">Pendentes</button>
        </div>
        <div class="civil-list"></div>`;
    document.body.appendChild(panel);

    const $ = (selector) => panel.querySelector(selector);
    const status = $(".civil-status");
    let result = null;
    let activeTab = "matched";
    let activeRowKey = null;
    let xraySnapshot = null;

    // Modelos civis carregados, com a sigla encontrada no nome
    function civilModels() {
        const loaded = new Set(Object.keys(scene.models || {}));
        return (getModels() || [])
            .filter((model) => model?.id && loaded.has(model.id))
            .map((model) => ({ model, discipline: detectCivilDiscipline(model.id, model.displayName, model.src) }))
            .filter((item) => item.discipline)
            .sort((a, b) => CIVIL_DISCIPLINES.indexOf(a.discipline) - CIVIL_DISCIPLINES.indexOf(b.discipline));
    }

    function renderModels() {
        const models = civilModels();
        const box = $(".civil-models");
        if (!models.length) {
            box.innerHTML = `<p class="civil-empty">Nenhum modelo civil carregado. A rede é reconhecida pela sigla no nome do arquivo: ${CIVIL_DISCIPLINES.map((d) => d.code).join(", ")}.</p>`;
            $('[data-action="run"]').disabled = true;
            return;
        }
        $('[data-action="run"]').disabled = false;
        box.innerHTML = models.map(({ model, discipline }) =>
            `<span class="civil-chip" title="${escapeHtml(model.displayName || model.id)}"><b>${discipline.code}</b>${escapeHtml(discipline.label)}</span>`
        ).join("");
    }

    // Lê as peças visíveis dos modelos civis
    function collectPieces() {
        const byModel = new Map(civilModels().map(({ model, discipline }) => [model.id, discipline]));
        const pieces = [];
        for (const metaObject of Object.values(viewer.metaScene?.metaObjects || {})) {
            const discipline = byModel.get(metaObject?.metaModel?.id);
            if (!discipline) continue;
            const entity = scene.objects[metaObject.id];
            if (entity && entity.visible === false) continue;
            const sets = metaObject.propertySets;
            if (!Array.isArray(sets)) continue;
            let subnetwork = null;
            for (const pset of sets) {
                if (!isItemsPropertySet(pset) || !Array.isArray(pset.properties)) continue;
                for (const prop of pset.properties) {
                    const material = String(prop?.name || prop?.id || "").trim();
                    if (!material) continue;
                    const normalized = normalizeQuantity(prop, readNumber(prop?.value));
                    if (normalized.quantity === null || normalized.quantity <= 0) continue;

                    subnetwork ??= getSubnetwork(metaObject) || "Sem sub-rede";
                    pieces.push({
                        objectId: metaObject.id,
                        modelId: metaObject.metaModel.id,
                        discipline,
                        subnetwork,
                        material,
                        quantity: normalized.quantity,
                        unitLabel: normalized.unitLabel,
                        // Tubos/calhas são "segmentos": o comprimento deles vem em centímetros
                        isSegment: /segment/i.test(String(metaObject.type || ""))
                    });
                }
            }
        }
        return pieces;
    }

    function rowKey(item, index) {
        return `${activeTab}:${index}`;
    }

    function renderList() {
        const list = $(".civil-list");
        const tabs = $(".civil-tabs");
        if (!result) {
            list.innerHTML = "";
            tabs.hidden = true;
            return;
        }
        tabs.hidden = false;
        tabs.querySelector('[data-tab="matched"]').textContent = `Associados (${result.matched.length})`;
        tabs.querySelector('[data-tab="pending"]').textContent = `Pendentes (${result.pending.length})`;
        tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("is-active", b.dataset.tab === activeTab));

        const items = activeTab === "matched" ? result.matched : result.pending;
        if (!items.length) {
            list.innerHTML = `<p class="civil-empty">${activeTab === "matched" ? "Nenhuma peça associada à base." : "Nenhuma pendência: todas as peças foram associadas."}</p>`;
            return;
        }

        let html = "";
        let lastDiscipline = null;
        let lastSub = null;
        items.forEach((item, index) => {
            if (item.discipline !== lastDiscipline) {
                html += `<div class="civil-group"><b>${item.discipline.code}</b>${escapeHtml(item.discipline.label)}</div>`;
                lastDiscipline = item.discipline;
                lastSub = null;
            }
            if (item.subnetwork && item.subnetwork !== lastSub) {
                html += `<div class="civil-subgroup">${escapeHtml(item.subnetwork)}</div>`;
                lastSub = item.subnetwork;
            }
            const key = rowKey(item, index);
            const active = key === activeRowKey ? " is-active" : "";
            if (activeTab === "matched") {
                html += `<button type="button" class="civil-row${active}" data-index="${index}" title="${escapeHtml([...item.materials].join("\n"))}">
                    <span class="civil-row-main">
                        <span class="civil-row-title">${escapeHtml(item.description)}</span>
                        <span class="civil-row-meta"><span class="civil-code">${escapeHtml([item.base, item.code].filter(Boolean).join(" "))}</span> | ${item.objectIds.size} peça(s)</span>
                    </span>
                    <span class="civil-row-qty">${formatQty(item.quantity, item.unit)} <small>${escapeHtml(item.unit)}</small></span>
                </button>`;
            } else {
                html += `<button type="button" class="civil-row${active}" data-index="${index}">
                    <span class="civil-row-main">
                        <span class="civil-row-title">${escapeHtml(item.material)}</span>
                        <span class="civil-row-meta civil-warn">${escapeHtml(describeCivilPending(item))}</span>
                    </span>
                    <span class="civil-row-qty">${formatQty(item.quantity, item.unitLabel)} <small>${item.unitLabel === "metro(s)" ? "m" : "un"}</small></span>
                </button>`;
            }
        });
        list.innerHTML = html;
    }

    // Destaca as peças de uma linha: o resto do modelo fica em raio-X
    function isolate(ids) {
        const all = scene.objectIds.filter((id) => !String(id).startsWith("__"));
        if (!xraySnapshot) xraySnapshot = new Set(scene.xrayedObjectIds);
        scene.setObjectsXRayed(all, true);
        scene.setObjectsXRayed(ids, false);
        scene.setObjectsVisible(ids, true);
        const aabb = scene.getAABB(ids);
        if (aabb && aabb.every(Number.isFinite)) viewer.cameraFlight.flyTo({ aabb, duration: 0.6 });
        requestRenderFrame();
    }

    function clearIsolation() {
        if (!xraySnapshot) return;
        const all = scene.objectIds.filter((id) => !String(id).startsWith("__"));
        scene.setObjectsXRayed(all, false);
        scene.setObjectsXRayed([...xraySnapshot], true);
        xraySnapshot = null;
        activeRowKey = null;
        requestRenderFrame();
    }

    async function run() {
        const button = $('[data-action="run"]');
        button.disabled = true;
        status.textContent = "Carregando a base de dados…";
        clearIsolation();
        try {
            const database = await loadDatabase();
            status.textContent = "Lendo as peças dos modelos…";
            await new Promise((r) => requestAnimationFrame(r));
            const pieces = collectPieces();
            result = aggregateCivilPieces(database, pieces);
            const total = result.matched.length + result.pending.length;
            status.textContent = total
                ? `${pieces.length} item(ns) de peças visíveis: ${result.matched.length} composição(ões) associada(s) e ${result.pending.length} pendência(s).`
                : "Nenhuma peça com itens associados nos modelos civis visíveis.";
            activeTab = result.matched.length || !result.pending.length ? "matched" : "pending";
            activeRowKey = null;
            $('[data-action="excel"]').disabled = !total;
            renderList();
        } catch (error) {
            console.error("[instalações civis]", error);
            status.textContent = `Não foi possível gerar: ${error.message}`;
        } finally {
            button.disabled = !civilModels().length;
        }
    }

    async function exportExcel() {
        if (!result) return;
        try {
            const XLSX = await ensureXLSX();
            const matchedRows = result.matched.map((item) => ({
                "Rede": item.discipline.label,
                "Sigla": item.discipline.code,
                "Sub-rede": item.subnetwork || "Toda a rede",
                "Base": item.base,
                "Código": item.code,
                "Descrição": item.description,
                "Unidade": item.unit,
                "Quantidade": Number(item.quantity.toFixed(2)),
                "Peças": item.objectIds.size,
                "Material no modelo": [...item.materials].join(" | ")
            }));
            const pendingRows = result.pending.map((item) => ({
                "Rede": item.discipline.label,
                "Sigla": item.discipline.code,
                "Sub-rede": item.subnetwork,
                "Material no modelo": item.material,
                "Unidade": item.unitLabel === "metro(s)" ? "M" : "UN",
                "Quantidade": Number(item.quantity.toFixed(2)),
                "Peças": item.objectIds.size,
                "Motivo": describeCivilPending(item)
            }));
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(matchedRows), "Associados");

            // Orçamento: Item | Base | Código | Descrição | Unidade | Quantidade, já numerado por rede e sub-rede
            const budgetRows = buildCivilBudgetRows(result.matched);
            const budgetSheet = XLSX.utils.aoa_to_sheet(budgetRows.map((row) => row.cells));
            budgetRows.forEach((row, index) => {
                const itemCell = budgetSheet[XLSX.utils.encode_cell({ r: index, c: 0 })];
                if (itemCell) { itemCell.t = "s"; itemCell.v = String(row.cells[0]); } // "1.1" como texto, não número
                const qtyCell = budgetSheet[XLSX.utils.encode_cell({ r: index, c: 5 })];
                if (qtyCell && row.kind === "item") qtyCell.z = "#,##0.00";
            });
            budgetSheet["!cols"] = [{ wch: 9 }, { wch: 10 }, { wch: 12 }, { wch: 110 }, { wch: 8 }, { wch: 12 }];
            XLSX.utils.book_append_sheet(workbook, budgetSheet, "Orçamento");

            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(pendingRows.length ? pendingRows : [{ "Motivo": "Sem pendências" }]), "Pendentes");
            const project = (document.body?.dataset?.project || "projeto").replace(/[^a-z0-9_-]+/gi, "-");
            XLSX.writeFile(workbook, `instalacoes-civis-${project}.xlsx`);
        } catch (error) {
            console.error("[instalações civis] Excel", error);
            status.textContent = `Não foi possível gerar o Excel: ${error.message}`;
        }
    }

    function openPanel() {
        panel.hidden = false;
        toolbarButton.classList.add("active");
        renderModels();
    }

    function closePanel() {
        panel.hidden = true;
        toolbarButton.classList.remove("active");
        clearIsolation();
        renderList();
    }

    toolbarButton.addEventListener("click", () => (panel.hidden ? openPanel() : closePanel()));
    $(".civil-close").addEventListener("click", closePanel);
    $('[data-action="run"]').addEventListener("click", run);
    $('[data-action="excel"]').addEventListener("click", exportExcel);
    $(".civil-tabs").addEventListener("click", (event) => {
        const tab = event.target.closest("[data-tab]")?.dataset.tab;
        if (!tab || tab === activeTab) return;
        activeTab = tab;
        clearIsolation();
        renderList();
    });
    $(".civil-list").addEventListener("click", (event) => {
        const row = event.target.closest(".civil-row");
        if (!row || !result) return;
        const items = activeTab === "matched" ? result.matched : result.pending;
        const index = Number(row.dataset.index);
        const key = rowKey(items[index], index);
        if (key === activeRowKey) {
            clearIsolation();
        } else {
            activeRowKey = key;
            isolate([...items[index].objectIds]);
        }
        renderList();
    });
    scene.on("modelLoaded", () => { if (!panel.hidden) renderModels(); });

    return {
        panel,
        enable() { toolbarButton.hidden = false; },
        disable() { closePanel(); toolbarButton.hidden = true; },
        run
    };
}
