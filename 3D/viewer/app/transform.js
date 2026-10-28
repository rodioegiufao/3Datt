// Módulo "transform" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { collisionModelASelect, loadedModels, objectModelIdLookup, originalTransforms, transformModelSelect, transformPanel, transformPanelToggleButton, viewer } from "../viewer-authenticated.js";
import { collisionFeatureAllowed, transformFeatureAllowed } from "./access.js";
import { parseNumber } from "./collision-legacy.js";
import { invalidateExplorerCaches, scheduleExplorerRefresh } from "./explorer.js";
import { requestRenderFrame } from "./performance.js";

export function setupTransformPanelControls() {
    if (!transformPanel || !transformPanelToggleButton || !closeTransformPanelButton) {
        return;
    }

    const togglePanel = (forceState) => {
        if (!transformFeatureAllowed) {
            return;
        }
        const shouldOpen = typeof forceState === "boolean" ? forceState : transformPanel.hidden;
        transformPanel.hidden = !shouldOpen;
        transformPanelToggleButton.classList.toggle("active", shouldOpen);
        transformPanelToggleButton.setAttribute("aria-pressed", shouldOpen ? "true" : "false");

        if (shouldOpen && transformModelSelect) {
            refreshTransformOptionLabels();
            const currentModelId = transformModelSelect.value || transformModelSelect.options[0]?.value;
            if (currentModelId) {
                syncTransformInputs(currentModelId);
            }
        }
    };

    transformPanelToggleButton.addEventListener("click", () => togglePanel());
    closeTransformPanelButton.addEventListener("click", () => togglePanel(false));

    togglePanel(false);
}
export const closeTransformPanelButton = document.getElementById("closeTransformPanel");
export const offsetXInput = document.getElementById("offsetX");
export const offsetYInput = document.getElementById("offsetY");
export const offsetZInput = document.getElementById("offsetZ");
export const rotationYInput = document.getElementById("rotationY");

// Nome para mostrar ao usuário: o mesmo do Explorer (nome do arquivo nos uploads), não o id interno
export function getModelDisplayLabel(modelOrId) {
    const id = typeof modelOrId === "string" ? modelOrId : modelOrId?.id;
    const model = typeof modelOrId === "string" ? (loadedModels.get(id) || viewer.scene.models?.[id]) : modelOrId;
    return String(model?.displayName || id || "").trim() || String(id || "");
}

export function ensureModelOption(modelId) {
    if (!transformModelSelect) {
        return;
    }

    const existing = Array.from(transformModelSelect.options).find((option) => option.value === modelId);
    if (existing) {
        existing.textContent = getModelDisplayLabel(modelId);
        return;
    }
    const option = document.createElement("option");
    option.value = modelId;
    option.textContent = getModelDisplayLabel(modelId);
    transformModelSelect.appendChild(option);
}

/** Atualiza os nomes da lista do "Origem & Rotação" (modelos podem ganhar nome depois de carregar). */
export function refreshTransformOptionLabels() {
    if (!transformModelSelect) {
        return;
    }
    Array.from(transformModelSelect.options).forEach((option) => {
        option.textContent = getModelDisplayLabel(option.value);
    });
}

export function removeModelOption(selectElement, modelId) {
    if (!selectElement || !modelId) {
        return;
    }

    const optionToRemove = Array.from(selectElement.options).find((option) => option.value === modelId);
    if (optionToRemove) {
        optionToRemove.remove();
    }
}

export function syncTransformInputs(modelId) {
    if (!transformModelSelect) {
        return;
    }

    const model = loadedModels.get(modelId);
    if (!model) {
        return;
    }

    const position = model.position || [0, 0, 0];
    const rotation = model.rotation || [0, 0, 0];

    if (offsetXInput) offsetXInput.value = position[0];
    if (offsetYInput) offsetYInput.value = position[1];
    if (offsetZInput) offsetZInput.value = position[2];
    if (rotationYInput) rotationYInput.value = rotation[1];
}

export function registerModelTransform(model) {
    loadedModels.set(model.id, model);
    objectModelIdLookup.clear();
    invalidateExplorerCaches();

    if (!originalTransforms.has(model.id)) {
        originalTransforms.set(model.id, {
            position: model.position ? [...model.position] : [0, 0, 0],
            rotation: model.rotation ? [...model.rotation] : [0, 0, 0]
        });
    }

    if (transformFeatureAllowed) {
        ensureModelOption(model.id);
    }
    if (collisionFeatureAllowed) {
        ensureCollisionOptions(model.id);
    }

    if (transformModelSelect && !transformModelSelect.value) {
        transformModelSelect.value = model.id;
    }

    if (collisionFeatureAllowed) {
        setDefaultCollisionSelection();
    }

    if (transformModelSelect) {
        syncTransformInputs(transformModelSelect.value);
    }
    scheduleExplorerRefresh();
}
export function applyTransformFromUI() {
    if (!transformFeatureAllowed || !transformModelSelect) {
        return;
    }

    const modelId = transformModelSelect.value;
    const model = loadedModels.get(modelId);

    if (!model) {
        alert("Nenhum modelo carregado para ajustar.");
        return;
    }

    const newPosition = [
        parseNumber(offsetXInput?.value),
        parseNumber(offsetYInput?.value),
        parseNumber(offsetZInput?.value)
    ];

    const newRotation = model.rotation ? [...model.rotation] : [0, 0, 0];
    newRotation[1] = parseNumber(rotationYInput?.value);

    model.position = newPosition;
    model.rotation = newRotation;

    requestRenderFrame();
}

export function resetTransformFromUI() {
    if (!transformFeatureAllowed || !transformModelSelect) {
        return;
    }

    const modelId = transformModelSelect.value;
    const model = loadedModels.get(modelId);
    const original = originalTransforms.get(modelId);

    if (!model || !original) {
        return;
    }

    model.position = [...original.position];
    model.rotation = [...original.rotation];

    syncTransformInputs(modelId);
    requestRenderFrame();
}

export function ensureCollisionOptions(modelId) {
    if (!collisionModelASelect) {
        return;
    }

    const exists = Array.from(collisionModelASelect.options).some((option) => option.value === modelId);
    if (!exists) {
        const option = document.createElement("option");
        option.value = modelId;
        option.textContent = getModelDisplayLabel(modelId);
        collisionModelASelect.appendChild(option);
    }
}

export function setDefaultCollisionSelection() {
    if (!collisionModelASelect) {
        return;
    }

    if (!collisionModelASelect.value && collisionModelASelect.options.length > 0) {
        collisionModelASelect.value = collisionModelASelect.options[0].value;
    }
}
