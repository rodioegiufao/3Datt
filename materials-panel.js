// Módulo "materials-panel" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { currentModels, focusObjectById, generateMaterialsButton, lastMaterialsResults, loadedModels, materialsIdsPanel, materialsIdsSummary, materialsPanel, materialsPanelToggleButton, materialsResultsList, materialsSearchInput, materialsSummary, viewer } from "../viewer-authenticated.js";
import { materialsFeatureAllowed } from "./access.js";
import { abrirGeradorMemorial, downloadMaterialsAsExcel } from "./excel.js";
import { applyMaterialsSearch, findMaterialObjectIds, generateAndRenderMaterialsList, materialsAllResults, normalizeSearchText } from "./materials.js";
import { activeProjectKey } from "./model-loading.js";
import { PROJECT_CONFIGS } from "../project-config.js";

export const closeMaterialsPanelButton = document.getElementById("closeMaterialsPanel");
export const downloadMaterialsExcelButton = document.getElementById("downloadMaterialsExcel");
export const generateMemorialButton = document.getElementById("generateMemorialWord");
export const materialsSearchButton = document.getElementById("materialsSearchButton");
export const materialsIdsList = document.getElementById("materialsIdsList");
export function setupMaterialsPanelControls() {
    if (!materialsPanel || !materialsSummary || !materialsResultsList) {
        return;
    }

    const togglePanel = (forceState) => {
        const shouldOpen = typeof forceState === "boolean" ? forceState : materialsPanel.hidden;
        materialsPanel.hidden = !shouldOpen;
        materialsPanelToggleButton?.classList.toggle("active", shouldOpen);
        if (!shouldOpen) {
            resetMaterialsIdsPanel();
        }
    };

    materialsPanelToggleButton?.addEventListener("click", () => {
        if (!materialsFeatureAllowed) return;
        togglePanel();
    });
    closeMaterialsPanelButton?.addEventListener("click", () => togglePanel(false));

    generateMaterialsButton?.addEventListener("click", async () => {
        if (!materialsFeatureAllowed) return;
        await generateAndRenderMaterialsList();
        resetMaterialsIdsPanel();
    });
    materialsSearchButton?.addEventListener("click", () => {
        applyMaterialsSearch();
    });
    materialsSearchInput?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            applyMaterialsSearch();
        }
    });
    downloadMaterialsExcelButton?.addEventListener("click", () => {
        if (!materialsFeatureAllowed) return;
        downloadMaterialsAsExcel(lastMaterialsResults, normalizeSearchText);
    });
    generateMemorialButton?.addEventListener("click", () => {
        if (!materialsFeatureAllowed) return;
        // Um memorial por IFC: lista completa (ignora o filtro de busca) + modelos carregados
        const modelos = [...loadedModels.keys()].map((id) => {
            const configurado = currentModels.find((m) => m.id === id);
            const carregado = loadedModels.get(id);
            return {
                id,
                src: configurado?.src || carregado?.uploadDateSrc || "",
                displayName: configurado?.displayName || configurado?.label || carregado?.displayName || id
            };
        });
        abrirGeradorMemorial({
            itens: materialsAllResults,
            modelos,
            viewer,
            normalizarBusca: normalizeSearchText,
            obraPadrao: PROJECT_CONFIGS[activeProjectKey]?.name || ""
        });
    });

    updateMaterialsDownloadButton();
}

export function updateMaterialsDownloadButton() {
    if (!downloadMaterialsExcelButton) {
        return;
    }

    downloadMaterialsExcelButton.disabled = !lastMaterialsResults.length;
    if (generateMemorialButton) {
        generateMemorialButton.disabled = !materialsAllResults.length;
    }
}

export function resetMaterialsIdsPanel() {
    if (!materialsIdsPanel || !materialsIdsSummary || !materialsIdsList) {
        return;
    }

    materialsIdsPanel.hidden = true;
    materialsIdsSummary.textContent = "";
    materialsIdsList.innerHTML = "";
}

export function renderMaterialsIdsList(materialName) {
    if (!materialsIdsPanel || !materialsIdsSummary || !materialsIdsList) {
        return;
    }

    materialsIdsPanel.hidden = false;
    materialsIdsList.innerHTML = "";

    if (!materialName) {
        materialsIdsSummary.textContent = "Selecione um material na lista para visualizar os IDs associados.";
        return;
    }

    const ids = findMaterialObjectIds(materialName);
    if (!ids.length) {
        materialsIdsSummary.textContent = `Nenhum ID encontrado para "${materialName}".`;
        return;
    }

    materialsIdsSummary.textContent = `${ids.length} ID(s) encontrados para "${materialName}". Clique em um ID para focar no modelo.`;

    ids.forEach((id) => {
        const li = document.createElement("li");
        li.className = "materials-id-item";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "materials-id-button";
        button.textContent = id;
        button.addEventListener("click", () => {
            focusObjectById(id);
        });
        li.appendChild(button);
        materialsIdsList.appendChild(li);
    });
}
