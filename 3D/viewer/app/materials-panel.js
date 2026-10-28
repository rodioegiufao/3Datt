// Módulo "materials-panel" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { focusObjectById, generateMaterialsButton, lastMaterialsResults, materialsIdsPanel, materialsIdsSummary, materialsPanel, materialsPanelToggleButton, materialsResultsList, materialsSearchInput, materialsSummary } from "../viewer-authenticated.js";
import { materialsFeatureAllowed } from "./access.js";
import { downloadMaterialsAsExcel } from "./excel.js";
import { applyMaterialsSearch, findMaterialObjectIds, generateAndRenderMaterialsList, normalizeSearchText } from "./materials.js";

export const closeMaterialsPanelButton = document.getElementById("closeMaterialsPanel");
export const downloadMaterialsExcelButton = document.getElementById("downloadMaterialsExcel");
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

    updateMaterialsDownloadButton();
}

export function updateMaterialsDownloadButton() {
    if (!downloadMaterialsExcelButton) {
        return;
    }

    downloadMaterialsExcelButton.disabled = !lastMaterialsResults.length;
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
