// Módulo "model-loading" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { getProjectConfig, hasProjectConfig } from "../project-config.js";
import { MODEL_LOAD_CONCURRENCY, adjustCameraOnLoad, clearAllLoadedModels, loadDefaultModel, loadModelGroup, projectFromDataset, viewer } from "../viewer-authenticated.js";
import { resetModelVisibility } from "./explorer.js";
import { setMeasurementMode } from "./measurements.js";
import { requestRenderFrame, saveHomeCamera } from "./performance.js";
import { getAllObjectIds } from "./scene-objects.js";

export let activeProjectKey = null;

export function finalizeInitialSetup() {
    setTimeout(() => {
        // Aberto por link de interferência: a câmera é posicionada pelo próprio link
        if (window.__clashLinkPending) {
            setMeasurementMode('none');
            return;
        }
        viewer.cameraFlight.jumpTo(viewer.scene);
        saveHomeCamera();
        setMeasurementMode('none');
    }, 300);
}

export function maybeFinalizeInitialization() {
    // A câmera é liberada pelo primeiro modelo útil; a fila continua em background.
}
export function getProgressiveLoadingIndicator() {
    let indicator = document.getElementById("viewerModelLoadProgress");
    if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "viewerModelLoadProgress";
        indicator.setAttribute("role", "status");
        Object.assign(indicator.style, { position: "fixed", left: "16px", bottom: "16px", zIndex: "9000", padding: "8px 12px", borderRadius: "8px", background: "rgba(20,28,38,.82)", color: "white", fontSize: "13px", pointerEvents: "none" });
        document.body.appendChild(indicator);
    }
    return indicator;
}

export async function loadModelsWithConcurrency(models, concurrency = MODEL_LOAD_CONCURRENCY) {
    const uniqueModels = models.filter((model, index, list) =>
        model?.id && list.findIndex((candidate) => candidate?.id === model.id) === index
    );
    const progress = getProgressiveLoadingIndicator();
    let nextIndex = 0;
    let loaded = 0;
    let failed = 0;
    let firstVisible = false;
    const updateProgress = () => {
        progress.textContent = `${loaded} de ${uniqueModels.length} modelos carregados${failed ? ` • ${failed} ${failed > 1 ? "falharam" : "falhou"}` : ""}`;
    };
    updateProgress();

    const worker = async () => {
        while (nextIndex < uniqueModels.length) {
            const model = uniqueModels[nextIndex++];
            try {
                await loadDefaultModel(model);
                loaded++;
                if (!firstVisible) {
                    firstVisible = true;
                    finalizeInitialSetup();
                }
            } catch (error) {
                failed++;
                adjustCameraOnLoad();
                console.warn(`[viewer] Falha ao carregar ${model.id}`, error);
            }
            updateProgress();
            await new Promise((resolve) => requestAnimationFrame(resolve));
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, uniqueModels.length) }, worker));
    window.setTimeout(() => { if (!failed) progress.remove(); }, 2500);
    return { loaded, failed };
}

export const modelSelectionOverlay = document.getElementById("modelSelection");


export const PROJECT_INITIAL_HIDDEN_IDS = {
    fecomercio: [
        "0IzBrQxdX84wfc29us7pwZ",
        "0qNnWYq2n8zvreBu599Ye4",
        "2AfqiJyGTAUu2DGdVW$eU4",
        "2AfqiJyGTAUu2DGdVW$eU7",
        "AfqiJyGTAUu2DGdVW$ePu",
    ],
};

export function applyProjectHiddenIds() {
    const hiddenIds = PROJECT_INITIAL_HIDDEN_IDS[projectFromDataset] || [];

    if (!hiddenIds.length || !viewer?.scene?.setObjectsVisible) {
        return;
    }

    const availableIds = new Set(getAllObjectIds());
    const hiddenSourceIds = new Set(hiddenIds);
    const idsToHide = Array.from(availableIds).filter((id) =>
        hiddenSourceIds.has(id) ||
        hiddenSourceIds.has(viewer.metaScene?.metaObjects?.[id]?.originalSystemId) ||
        hiddenSourceIds.has(String(id).slice(String(id).lastIndexOf("#") + 1))
    );

    if (!idsToHide.length) {
        return;
    }

    viewer.scene.setObjectsVisible(idsToHide, false);
    console.log(`IDs ocultados na inicialização (${projectFromDataset}): ${idsToHide.join(", ")}`);
}

export const PROJECT_ROUTES = {
    iper: "/3D/iper",
    lacen: "/3D/lacen",
    tce: "/3D/TCE",
    policlinica: "/3D/policlinica",
    farmacia: "/3D/farmacia",
    fecomercio: "/3D/fecomercio",
    esc_canaa: "/3D/esc_canaa",
    sebrae_rr: "/3D/sebrae-rr",
    sesc_centro_ecologico: "/3D/sesc_centro_ecologico",
    esc_modelo: "/3D/esc_modelo",
    psb: "/3D/psb"
};

export function updateProjectUrl(projectKey, { replace = false } = {}) {
    const route = PROJECT_ROUTES[projectKey];
    if (!route || !window?.history?.pushState) {
        return;
    }

    if (window.location.pathname === route) {
        return;
    }

    if (replace) {
        // Mantém ?interferencia=... e outros parâmetros ao trocar o endereço
        window.history.replaceState({}, "", `${route}${window.location.search}${window.location.hash}`);
        return;
    }

    window.history.pushState({}, "", route);
}

export function handleModelSelection(models, transforms, projectKey, { replaceUrl = false } = {}) {
    activeProjectKey = projectKey;

    if (modelSelectionOverlay) {
        modelSelectionOverlay.hidden = true;
    }
    clearAllLoadedModels();
    resetModelVisibility();
    loadModelGroup(models, transforms);
    updateProjectUrl(projectKey, { replace: replaceUrl });
    requestRenderFrame();
}
export function handleProjectSelectChange(event) {
    const projectKey = event.target.value;
    if (!projectKey || !hasProjectConfig(projectKey)) {
        return;
    }

    const { models, transforms } = getProjectConfig(projectKey, "authenticated");
    handleModelSelection(models, transforms, projectKey);
}

export function handleConfiguredProjectSelection(projectKey) {
    const { models, transforms } = getProjectConfig(projectKey, "authenticated");
    handleModelSelection(models, transforms, projectKey);
}
