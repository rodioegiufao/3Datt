// Módulo "project-budget" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { budgetPanel, budgetPanelToggleButton, materialsPanel, materialsPanelToggleButton, materialsSearchInput, viewer } from "../viewer-authenticated.js";
import { materialsFeatureAllowed } from "./access.js";
import { loadAssociationDefinitionsFromExcel } from "./excel.js";
import { applyMaterialsSearch, findMaterialObjectIds, generateAndRenderMaterialsList, materialsAllResults, normalizeMaterialName, normalizeSearchText } from "./materials.js";
import { activeProjectKey } from "./model-loading.js";
import { requestRenderFrame } from "./performance.js";
import { getAllObjectIds, mergeAABBs } from "./scene-objects.js";
import { modelIsolateController } from "./treeview-section.js";

export const budgetStatus = document.getElementById("budgetStatus");
export const budgetTable = document.getElementById("budgetTable");
export const budgetTableBody = document.getElementById("budgetTableBody");
export const budgetTableLoadedProjects = new Set();

export const PROJECT_BUDGET_DATA_URLS = {
    esc_canaa: "/3D/budget_rows.json",
};

export const BUDGET_COLUMN_COUNT = 10;
export const BUDGET_NUMBER_COLUMNS = new Set([5, 6, 7, 8, 9]);
export const HALF_QUANTITY_BUDGET_DESCRIPTIONS = new Set([
    'incendio - mangueiras - 1.1/2 " 15 m'
]);
export const budgetAssociationsByCode = new Map();
export const budgetAssociationsByDescription = new Map();

export function parseBudgetNumber(rawValue) {
    const rawText = String(rawValue || "").trim();
    const normalized = rawText
        .replace(/\s+/g, "")
        .replace(/[^0-9,.-]/g, "");

    if (!normalized) {
        return NaN;
    }

    if (normalized.includes(",") && normalized.includes(".")) {
        return Number.parseFloat(normalized.replace(/\./g, "").replace(",", "."));
    }

    if (normalized.includes(",")) {
        return Number.parseFloat(normalized.replace(",", "."));
    }

    return Number.parseFloat(normalized);
}

export function formatBudgetNumber(value) {
    if (!Number.isFinite(value)) {
        return "";
    }

    return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

export function computeBudgetTotalIfNeeded(rowValues) {
    if (rowValues[8]) {
        return rowValues;
    }

    const quantity = parseBudgetNumber(rowValues[5]);
    const unitWithBdi = parseBudgetNumber(rowValues[7]);
    const unitValue = parseBudgetNumber(rowValues[6]);
    const unitToUse = Number.isFinite(unitWithBdi) ? unitWithBdi : unitValue;

    if (!Number.isFinite(quantity) || !Number.isFinite(unitToUse)) {
        return rowValues;
    }

    const updatedRow = [...rowValues];
    updatedRow[8] = formatBudgetNumber(quantity * unitToUse);
    return updatedRow;
}

export function adjustBudgetQuantityForAssociation(modelQuantity, association) {
    if (!Number.isFinite(modelQuantity)) {
        return 0;
    }

    const normalizedDescription = normalizeSearchText(association?.descricao || "").replace(/\s+/g, " ");
    if (HALF_QUANTITY_BUDGET_DESCRIPTIONS.has(normalizedDescription)) {
        return modelQuantity / 2;
    }

    return modelQuantity;
}

export function normalizeCompositionCode(rawCode) {
    const cleaned = String(rawCode || "").trim().toLowerCase();
    if (!cleaned) {
        return "";
    }

    const directDigits = cleaned.replace(/[^0-9]/g, "");
    if (directDigits) {
        return directDigits;
    }

    return cleaned.replace(/\s+/g, " ");
}

export async function ensureBudgetAssociationsLoaded() {
    if (budgetAssociationsByCode.size > 0 || budgetAssociationsByDescription.size > 0) {
        return;
    }

    const associations = await loadAssociationDefinitionsFromExcel({ excelPath: "./base_de_dados.xlsx" });

    associations.forEach((association) => {
        const normalizedCode = normalizeCompositionCode(association.codigo);
        const normalizedDescription = normalizeSearchText(association.descricao).replace(/\s+/g, " ");
        const normalizedItemDescription = normalizeMaterialName(association.itemDescricao);

        if (!normalizedItemDescription) {
            return;
        }

        if (normalizedCode) {
            if (!budgetAssociationsByCode.has(normalizedCode)) {
                budgetAssociationsByCode.set(normalizedCode, new Set());
            }

            budgetAssociationsByCode.get(normalizedCode).add(normalizedItemDescription);
        }

        if (normalizedDescription) {
            if (!budgetAssociationsByDescription.has(normalizedDescription)) {
                budgetAssociationsByDescription.set(normalizedDescription, new Set());
            }

            budgetAssociationsByDescription.get(normalizedDescription).add(normalizedItemDescription);
        }
    });
}

export function getAssociatedMaterialsByBudgetReference({ code = "", description = "" } = {}) {
    const associatedItems = new Set();

    const normalizedCode = normalizeCompositionCode(code);
    if (normalizedCode && budgetAssociationsByCode.has(normalizedCode)) {
        budgetAssociationsByCode.get(normalizedCode).forEach((item) => associatedItems.add(item));
    }

    const normalizedDescription = normalizeSearchText(description).replace(/\s+/g, " ");
    if (normalizedDescription) {
        if (budgetAssociationsByDescription.has(normalizedDescription)) {
            budgetAssociationsByDescription.get(normalizedDescription).forEach((item) => associatedItems.add(item));
        } else {
            budgetAssociationsByDescription.forEach((items, descriptionKey) => {
                if (descriptionKey.includes(normalizedDescription) || normalizedDescription.includes(descriptionKey)) {
                    items.forEach((item) => associatedItems.add(item));
                }
            });
        }
    }

    return Array.from(associatedItems);
}

export function isolateBudgetComposition({ code = "", description = "" } = {}) {
    if (!materialsFeatureAllowed) {
        return false;
    }
    const associatedItems = getAssociatedMaterialsByBudgetReference({ code, description });
    if (!associatedItems.length) {
        return false;
    }

    const objectIds = new Set();

    associatedItems.forEach((itemName) => {
        const ids = findMaterialObjectIds(itemName);
        ids.forEach((id) => objectIds.add(id));
    });

    if (!objectIds.size || !modelIsolateController) {
        return false;
    }

    const idsToFocus = Array.from(objectIds);
    const allIds = getAllObjectIds();

    modelIsolateController.setObjectsVisible(allIds, false);
    modelIsolateController.setObjectsXRayed(allIds, false);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    modelIsolateController.setObjectsVisible(idsToFocus, true);
    modelIsolateController.setObjectsHighlighted(idsToFocus, true);

    const combinedAABB = mergeAABBs(idsToFocus.map((id) => viewer.scene.getAABB(id)));
    if (combinedAABB) {
        viewer.cameraFlight.flyTo({ aabb: combinedAABB, duration: 0.6 });
    }

    requestRenderFrame();
    return true;
}

export async function openMaterialsPanelAndFilterByBudgetReference({ code = "", description = "" } = {}) {
    if (!materialsFeatureAllowed) {
        return [];
    }
    if (!materialsPanel) {
        return [];
    }

    if (!materialsAllResults.length) {
        await generateAndRenderMaterialsList();
    }

    const associatedMaterials = getAssociatedMaterialsByBudgetReference({ code, description });
    if (!associatedMaterials.length) {
        return [];
    }

    materialsPanel.hidden = false;
    materialsPanelToggleButton?.classList.add("active");
    if (materialsSearchInput) {
        materialsSearchInput.value = description || code;
    }
    applyMaterialsSearch({ skipAssociationsLoad: true });
    return associatedMaterials;
}


export function setBudgetStatus(message, isError = false) {
    if (!budgetStatus) {
        return;
    }

    budgetStatus.hidden = !message;
    budgetStatus.textContent = message || "";
    budgetStatus.style.color = isError ? "#ffb4b4" : "#cfd8dc";
}

export function clearBudgetTable() {
    if (budgetTableBody) {
        budgetTableBody.innerHTML = "";
    }

    if (budgetTable) {
        budgetTable.hidden = true;
    }
}

export function getBudgetRowClass(itemValue, hasDescription, hasCode) {
    const isSection = itemValue && /^\d+(\.\d+)?$/.test(itemValue) && hasDescription && !hasCode;
    return isSection ? "section-row" : "data-row";
}

export async function renderProjectBudgetTable(projectKey) {
    const budgetDataUrl = PROJECT_BUDGET_DATA_URLS[projectKey];
    if (!budgetDataUrl || !budgetTableBody || !budgetTable) {
        return false;
    }

    try {
        setBudgetStatus("Carregando orçamento...");
        clearBudgetTable();
        await ensureBudgetAssociationsLoaded();

        const response = await fetch(budgetDataUrl, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Não foi possível carregar os dados do orçamento (status ${response.status}).`);
        }
        const budgetRows = await response.json();
        if (!Array.isArray(budgetRows)) {
            throw new Error("Formato inválido dos dados de orçamento.");
        }

        const fragment = document.createDocumentFragment();
        for (const row of budgetRows) {
            const normalized = computeBudgetTotalIfNeeded(
                Array.from({ length: BUDGET_COLUMN_COUNT }, (_, colIndex) => String(row?.[colIndex] || "").trim())
            );

            const hasAnyValue = normalized.some((value) => value);
            if (!hasAnyValue) {
                continue;
            }

            const [item, codigo, , descricao] = normalized;
            const codeKey = normalizeCompositionCode(codigo);
            const descriptionKey = normalizeSearchText(descricao).replace(/\s+/g, " ");
            const hasAssociations =
                (codeKey && budgetAssociationsByCode.has(codeKey)) ||
                (descriptionKey && budgetAssociationsByDescription.has(descriptionKey));
            const tr = document.createElement("tr");
            tr.className = getBudgetRowClass(item, Boolean(descricao), Boolean(codigo));

             normalized.forEach((value, index) => {
                const td = document.createElement("td");
                td.textContent = value;

                if (materialsFeatureAllowed && hasAssociations && (index === 1 || index === 3)) {
                    td.classList.add("budget-code-clickable");
                    td.setAttribute("role", "button");
                    td.setAttribute("tabindex", "0");
                    td.title = "Clique para pesquisar os itens desta composição na base e localizar no modelo";

                    const handleCompositionClick = async () => {
                        await ensureBudgetAssociationsLoaded();

                        const associatedMaterials = await openMaterialsPanelAndFilterByBudgetReference({
                            code: codigo,
                            description: descricao
                        });
                        if (!associatedMaterials.length) {
                            setBudgetStatus(`Composição ${codigo || descricao} sem itens associados na base para pesquisa.`, true);
                            return;
                        }

                        const isolated = isolateBudgetComposition({ code: codigo, description: descricao });
                        if (!isolated) {
                            setBudgetStatus(
                                `Composição ${codigo || descricao}: associações carregadas. Clique no item associado na lista de materiais para localizar no modelo.`,
                                true
                            );
                         return;
                        }
                        setBudgetStatus(
                            `Composição ${codigo || descricao}: itens associados localizados. Você pode clicar em qualquer item associado na lista de materiais.`
                        );
                    };

                    td.addEventListener("click", handleCompositionClick);
                    td.addEventListener("keydown", (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleCompositionClick();
                        }
                    });
                }

                if (BUDGET_NUMBER_COLUMNS.has(index)) {
                    td.classList.add("numeric");
                }
                tr.appendChild(td);
            });

            fragment.appendChild(tr);
        }

        budgetTableBody.appendChild(fragment);
        budgetTable.hidden = false;
        setBudgetStatus("");
        return true;
    } catch (error) {
        console.error("Erro ao carregar orçamento:", error);
        clearBudgetTable();
        setBudgetStatus(`Erro ao carregar orçamento: ${error.message}`, true);
        return false;
    }
}

export function openProjectBudget(projectKey = activeProjectKey) {
    const budgetDataUrl = PROJECT_BUDGET_DATA_URLS[projectKey];

    if (!budgetPanel || !budgetDataUrl) {
        return false;
    }

    if (!budgetTableLoadedProjects.has(projectKey)) {
        renderProjectBudgetTable(projectKey).then((loaded) => {
            if (loaded) {
                budgetTableLoadedProjects.add(projectKey);
            }
        });
    } else {
        setBudgetStatus("");
        if (budgetTable) {
            budgetTable.hidden = false;
        }
    }

    budgetPanel.hidden = false;
    budgetPanelToggleButton?.classList.add("active");
    budgetPanelToggleButton?.setAttribute("aria-pressed", "true");
    return true;
}
