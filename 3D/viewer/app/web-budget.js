// Módulo "web-budget" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { materialsSummary, renderWebBudgetRows } from "../viewer-authenticated.js";
import { materialsAllResults, normalizeSearchText } from "./materials.js";
import { ensureWebBudgetAssociationsLoaded, getWebBudgetMinimizedStorageKey, hideWebBudgetPanel, setWebBudgetMinimizedState, setupDraggablePanel } from "./panels.js";
import { adjustBudgetQuantityForAssociation } from "./project-budget.js";

export let webBudgetPanel = null;
export let webBudgetRowsContainer = null;
export let webBudgetSummary = null;
export let webBudgetSourceCacheRef = null;

export function ensureWebBudgetPanel() {
    if (webBudgetPanel) {
        return webBudgetPanel;
    }

    const panel = document.createElement("div");
    panel.id = "webBudgetPanel";
    panel.hidden = true;
    panel.innerHTML = `
        <div class="web-budget-header">
            <div>
                <div class="web-budget-title">Orçamento web (Z)</div>
                <div class="web-budget-subtitle">Visualização em tabela da lista total de materiais</div>
            </div>
            <div class="web-budget-actions">
                <button id="toggleWebBudgetPanelMinimize" type="button" aria-label="Minimizar orçamento web" aria-expanded="true">—</button>
                <button id="closeWebBudgetPanel" type="button" aria-label="Fechar orçamento web">✕</button>
            </div>
        </div>
        <div class="web-budget-content">
            <p id="webBudgetSummary" class="web-budget-summary"></p>
            <div class="web-budget-table-wrapper" aria-label="Tabela de orçamento web">
                <table class="web-budget-table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Base</th>
                            <th>Descrição</th>
                            <th>Unidade</th>
                            <th>Quantidade</th>
                        </tr>
                    </thead>
                    <tbody id="webBudgetRows"></tbody>
                </table>
            </div>
        </div>
    `;

    document.body.appendChild(panel);

    webBudgetPanel = panel;
    webBudgetRowsContainer = panel.querySelector("#webBudgetRows");
    webBudgetSummary = panel.querySelector("#webBudgetSummary");

    panel.querySelector("#closeWebBudgetPanel")?.addEventListener("click", () => {
        hideWebBudgetPanel();
    });
    panel.querySelector("#toggleWebBudgetPanelMinimize")?.addEventListener("click", () => {
        const shouldMinimize = !panel.classList.contains("is-minimized");
        setWebBudgetMinimizedState(shouldMinimize);
    });

    const shouldStartMinimized = window.localStorage?.getItem(getWebBudgetMinimizedStorageKey()) === "1";
    setWebBudgetMinimizedState(shouldStartMinimized);

    setupDraggablePanel({
        panel,
        storageKey: `webBudgetPanelPosition:${window.location.pathname}`,
        handleSelector: ".web-budget-header",
        ignoreSelectors: "input, button, textarea, select, a, .web-budget-table-wrapper, .web-budget-table-wrapper *"
    });
    return panel;
}

export function formatModelLabel(modelId) {
    if (!modelId) {
        return "Modelo não identificado";
    }

    const normalizedModelId = String(modelId).replace(/_/g, "-");

    const modelBudgetLabels = {
        "IFC-ALI": "CIRCUITO ALIMENTADOR",
        "IFC-ELE": "INSTALAÇÕES ELÉTRICAS DE BAIXA TENSÃO",
        "IFC-ILUX": "ILUMINAÇÃO EXTERNA",
        "IFC-LOG": "CABEAMENTO ESTRUTURADO E CFTV",
        "IFC-LOG-TEF": "CABEAMENTO ESTRUTURADO, CFTV E TELEFONIA",
        "IFC-TEF": "TELEFONIA",
        "IFC-SPDA": "SISTEMA DE PROTEÇÃO CONTRA DESCARGAS ATMOSFÉRICAS - SPDA",
        "IFC-SDAI": "SISTEMA DE DETECÇÃO E ALARME DE INCÊNDIO",
        "IFC-SUB": "SUBESTAÇÃO AÉREA",
        "IFC-FOT": "SISTEMA FOTOVOLTAICO",
        "IFC-HID": "INSTALAÇÕES HIDRÁULICAS"
    };

    return modelBudgetLabels[normalizedModelId] || normalizedModelId;
}

export function buildWebBudgetMaterials(materials, associationDefinitions) {
    if (!Array.isArray(materials) || !materials.length || !Array.isArray(associationDefinitions) || !associationDefinitions.length) {
        return [];
    }

    const itemsByDescription = materials.reduce((acc, item) => {
        const normalizedName = normalizeSearchText(item.name || "").replace(/\s+/g, " ");
        if (!normalizedName) {
            return acc;
        }

        const current = acc.get(normalizedName) || {
            quantity: 0,
            unitLabel: "",
            sourceMaterialNames: [],
            quantityByModel: new Map()
        };

        if (!(current.quantityByModel instanceof Map)) {
            current.quantityByModel = new Map(Object.entries(current.quantityByModel || {}));
        }

        current.quantity += Number(item.quantity) || 0;
        if (!current.unitLabel && item.unitLabel) {
            current.unitLabel = item.unitLabel;
        }
        if (item.name && !current.sourceMaterialNames.includes(item.name)) {
            current.sourceMaterialNames.push(item.name);
        }

        const itemModelEntries = item.quantityByModel instanceof Map
            ? item.quantityByModel.entries()
            : Object.entries(item.quantityByModel || {});
        for (const [modelId, modelQuantityRaw] of itemModelEntries) {
            const modelQuantity = Number(modelQuantityRaw) || 0;
            if (!modelId || modelQuantity <= 0) {
                continue;
            }

            const previous = current.quantityByModel.get(modelId) || 0;
            current.quantityByModel.set(modelId, previous + modelQuantity);
        }

        acc.set(normalizedName, current);
        return acc;
    }, new Map());

    const aggregated = new Map();

    associationDefinitions.forEach((association) => {
        const normalizedDescription = normalizeSearchText(association?.itemDescricao || "").replace(/\s+/g, " ");
        if (!normalizedDescription) {
            return;
        }

        const matchData = itemsByDescription.get(normalizedDescription);
        const quantity = matchData?.quantity || 0;
        if (quantity <= 0) {
            return;
        }

        const modelEntries = matchData?.quantityByModel?.entries?.() || [];
        for (const [modelId, modelQuantityRaw] of modelEntries) {
            const modelQuantity = Number(modelQuantityRaw) || 0;
            if (!modelId || modelQuantity <= 0) {
                continue;
            }
            const baseKey = association?.codigo
                ? `codigo:${association.codigo}`
                : `descricao:${association?.descricao || ""}|${association?.base || ""}|${association?.unidade || ""}`;
            const key = `${modelId}|${baseKey}`;

            const current = aggregated.get(key) || {
                modelId,
                codigo: association?.codigo || "",
                base: association?.base || "",
                descricao: association?.descricao || association?.itemDescricao || "",
                unidade: association?.unidade || matchData?.unitLabel || "",
                quantidade: 0,
                sourceMaterialNames: []
            };

            current.quantidade += adjustBudgetQuantityForAssociation(modelQuantity, association);
            matchData?.sourceMaterialNames?.forEach((materialName) => {
                if (!current.sourceMaterialNames.includes(materialName)) {
                    current.sourceMaterialNames.push(materialName);
                }
            });

            aggregated.set(key, current);
        }
    });

    return Array.from(aggregated.values()).sort(
        (a, b) => a.modelId.localeCompare(b.modelId, "pt-BR")
            || b.quantidade - a.quantidade
            || a.descricao.localeCompare(b.descricao, "pt-BR")
    );
}
export async function openWebBudgetPanel() {
    ensureWebBudgetPanel();

    if (!materialsAllResults.length) {
        materialsSummary.textContent = 'Para abrir o orçamento web com Z, clique em "Gerar lista" primeiro.';
        return false;
    }

    if (webBudgetSourceCacheRef !== materialsAllResults) {
        let webBudgetMaterials = [];

        try {
            const associations = await ensureWebBudgetAssociationsLoaded();
            webBudgetMaterials = buildWebBudgetMaterials(materialsAllResults, associations);
        } catch (error) {
            console.warn("Não foi possível carregar as associações para montar o orçamento web.", error);
        }

        renderWebBudgetRows(webBudgetMaterials);
        webBudgetSourceCacheRef = materialsAllResults;
    }

    webBudgetPanel.hidden = false;
    return true;
}
