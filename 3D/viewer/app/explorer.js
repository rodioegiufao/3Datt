// Módulo "explorer" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { EXPLORER_TAB_DEFINITIONS, allowedExplorerTabs, clearSelection, currentModels, defaultRenderProfile, explorerTabButtons, focusObjectById, loadedModels, normalizedSceneObjectIdLookup, objectModelIdLookup, toggleTreeViewSelectionButton, treeViewContainer, treeViewContent, treeViewSubtitleElement, treeViewTitleElement, viewer, viewerCompatibility, xktLoader } from "../viewer-authenticated.js";
import { modelReplaceAllowed, wifiCoverageFeaturePromise } from "./access.js";
import { expandHierarchy, focusNetworkGroup, getMetaObjectNetworkInfo, getMetaObjectPartInfo, getObjectIdsByType, getObjectsByStorey, isSceneObjectId, isolateStorey, resolveSceneObjectId } from "./ifc-meta.js";
import { applyModelRenderProfile, performanceModeEnabled, requestRenderFrame } from "./performance.js";
import { getAllObjectIds, getModelObjectIds, getObjectMetaModelId, mergeAABBs } from "./scene-objects.js";
import { registerModelTransform } from "./transform.js";
import { modelIsolateController } from "./treeview-section.js";

export let lastPickedEntity = null;        // NOVO: substituir modelo por arquivo local (só na sessão)
export let modelReplaceFeaturePromise = null;
export const explorerExpandedGroups = {
    objects: new Set(),
    classes: new Set(),
    storeys: new Set(),
    networks: new Set(),
    parts: new Set()
};
export let activeExplorerTab = "models";
export let explorerTabsInitialized = false;
export let explorerTabPanels = new Map();
export let explorerTabSummaries = new Map();
export let explorerTabLists = new Map();
export let explorerRefreshHandle = null;
export let explorerSceneMetaObjectsCache = null;
export let explorerMetaInfoCache = new Map();
export const explorerLoadedTabs = new Set();
/**
 * Reseta a visibilidade de todos os objetos e remove qualquer destaque ou raio-x.
 */
export function resetModelVisibility() {
    if (modelIsolateController) {
        // Volta a exibir todos os objetos
        modelIsolateController.setObjectsVisible(getAllObjectIds(), true);
        // Remove X-ray
        modelIsolateController.setObjectsXRayed(getAllObjectIds(), false);
        // Remove destaque
        modelIsolateController.setObjectsHighlighted(getAllObjectIds(), false);
        // Centraliza a câmera no modelo inteiro
        viewer.cameraFlight.jumpTo(viewer.scene);
    }
    lastPickedEntity = null; // Garante que a referência de seleção também seja limpa.
    clearSelection(false); // Limpa o estado visual do botão "Limpar Seleção"
}
export function updateExplorerHeader() {
    const activeTab = EXPLORER_TAB_DEFINITIONS.find(({ id }) => id === activeExplorerTab)
        || EXPLORER_TAB_DEFINITIONS[0];

    if (treeViewTitleElement) {
        treeViewTitleElement.textContent = "Explorador";
    }

    if (treeViewSubtitleElement) {
        treeViewSubtitleElement.textContent = activeTab.subtitle;
    }

    if (toggleTreeViewSelectionButton) {
        toggleTreeViewSelectionButton.hidden = true;
    }
}

export function createExplorerTabPanel(tabId) {
    const panel = document.createElement("section");
    panel.className = "explorer-tab-panel";
    panel.dataset.explorerPanel = tabId;
    panel.hidden = true;

    const summary = document.createElement("p");
    summary.className = "explorer-tab-summary";
    panel.appendChild(summary);

    const list = document.createElement("div");
    list.className = "explorer-tab-list";
    panel.appendChild(list);

    explorerTabPanels.set(tabId, panel);
    explorerTabSummaries.set(tabId, summary);
    explorerTabLists.set(tabId, list);

    return panel;
}

export function setupExplorerPanel() {
    if (!treeViewContainer || !treeViewContent || explorerTabsInitialized) {
        return;
    }

    const header = treeViewContainer.querySelector(".tree-view-header");
    if (!header) {
        return;
    }

    const tabsBar = document.createElement("div");
    tabsBar.className = "explorer-tabs";
    tabsBar.setAttribute("role", "tablist");
    tabsBar.setAttribute("aria-label", "Explorador do modelo");

    const content = document.createElement("div");
    content.className = "explorer-content";

    EXPLORER_TAB_DEFINITIONS.forEach((tabDefinition) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "explorer-tab-button";
        button.dataset.explorerTab = tabDefinition.id;
        button.setAttribute("role", "tab");
        button.textContent = tabDefinition.label;
        button.hidden = !isExplorerTabAllowed(tabDefinition.id);   // NOVO
        button.addEventListener("click", () => setActiveExplorerTab(tabDefinition.id));
        explorerTabButtons.set(tabDefinition.id, button);
        tabsBar.appendChild(button);

        content.appendChild(createExplorerTabPanel(tabDefinition.id));
    });

    header.insertAdjacentElement("afterend", tabsBar);
    tabsBar.insertAdjacentElement("afterend", content);

    treeViewContainer.classList.add("explorer-enabled");
    explorerTabsInitialized = true;
    updateExplorerHeader();
    setActiveExplorerTab(activeExplorerTab);
}

export function isExplorerTabAllowed(tabId) {
    return allowedExplorerTabs.has(tabId);
}

export function setActiveExplorerTab(tabId) {
    if (!explorerTabsInitialized) {
        return;
    }

    activeExplorerTab = explorerTabButtons.has(tabId) && isExplorerTabAllowed(tabId) ? tabId : "models";

    explorerTabButtons.forEach((button, id) => {
        const isActive = id === activeExplorerTab;
        button.classList.toggle("is-active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
        button.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    explorerTabPanels.forEach((panel, id) => {
        panel.hidden = id !== activeExplorerTab;
    });

    updateExplorerHeader();
    updateTreeViewSelectionButtonState();
    if (!explorerLoadedTabs.has(activeExplorerTab)) {
        scheduleExplorerRefresh(0);
    }
}

export function scheduleExplorerRefresh(delay = 160) {
    if (!explorerTabsInitialized) {
        return;
    }
    
    // Algo mudou (visibilidade, data de upload, grupo expandido...):
    // as abas já renderizadas ficam desatualizadas e precisam ser redesenhadas.
    explorerLoadedTabs.clear();

    window.clearTimeout(explorerRefreshHandle);
    explorerRefreshHandle = window.setTimeout(() => {
        // Limpa de novo na hora de redesenhar: se o pedido veio de dentro de um redesenho
        // (ex.: data de upload que ficou pronta na hora), a aba já foi marcada como carregada.
        explorerLoadedTabs.clear();
        refreshExplorerPanels();
    }, delay);
}

export function invalidateExplorerCaches() {
    explorerSceneMetaObjectsCache = null;
    explorerMetaInfoCache.clear();
    explorerLoadedTabs.clear();
}

export function getExplorerSceneMetaObjects() {
    if (explorerSceneMetaObjectsCache) {
        return explorerSceneMetaObjectsCache;
    }
    const metaObjects = viewer.metaScene?.metaObjects || {};
    const entries = [];

    for (const metaObject of Object.values(metaObjects)) {
        const sceneObjectId = resolveSceneObjectId(metaObject?.id);
        if (!metaObject?.id || !sceneObjectId) {
            continue;
        }
        entries.push({
            ...metaObject,
            sceneObjectId
        });
    }

    explorerSceneMetaObjectsCache = entries;
    return explorerSceneMetaObjectsCache;
}

export function getCachedExplorerMetaInfo(metaObject) {
    if (!metaObject?.id) {
        return {
            modelId: "SEM_MODELO",
            modelLabel: getExplorerModelLabel("SEM_MODELO"),
            networkInfo: { network: "Sem rede", subnetwork: "Sem subrede" },
            partInfo: {
                className: "Sem classe",
                typeName: "Sem tipo",
                partName: metaObject?.name || metaObject?.id || "Sem nome",
                hasIdentification: false
            }
        };
    }

    const cached = explorerMetaInfoCache.get(metaObject.id);
    if (cached) {
        return cached;
    }

    const modelId = getObjectMetaModelId(metaObject.id) || "SEM_MODELO";
    const info = {
        modelId,
        modelLabel: getExplorerModelLabel(modelId),
        networkInfo: getMetaObjectNetworkInfo(metaObject),
        partInfo: getMetaObjectPartInfo(metaObject)
    };

    explorerMetaInfoCache.set(metaObject.id, info);
    return info;
}

export function focusModelById(modelId) {
    if (!modelIsolateController) {
        return false;
    }

    const ids = expandHierarchy(getModelObjectIds(modelId).filter((id) => isSceneObjectId(id)));
    return focusObjectCollection(ids);
}

export function focusObjectCollection(ids) {
    if (!modelIsolateController) {
        return false;
    }
    if (!ids.length) {
        return false;
    }

    const allIds = getAllObjectIds();
    modelIsolateController.setObjectsVisible(allIds, false);
    modelIsolateController.setObjectsXRayed(allIds, false);
    modelIsolateController.setObjectsHighlighted(allIds, false);
    modelIsolateController.setObjectsVisible(ids, true);
    viewer.scene.setObjectsHighlighted(ids, true);

    const combinedAABB = mergeAABBs(ids.map((id) => viewer.scene.getAABB(id)));
    if (combinedAABB) {
        viewer.cameraFlight.flyTo({ aabb: combinedAABB, duration: 0.6 });
    }

    clearSelection();
    requestRenderFrame();
    return true;
}

export function focusClassByTypeAndModel(type, modelId) {
    if (!type || !modelId) {
        return false;
    }

    const ids = expandHierarchy(
        getObjectIdsByType(type)
            .filter((id) => isSceneObjectId(id))
            .filter((id) => (getObjectMetaModelId(id) || "SEM_MODELO") === modelId)
    );

    return focusObjectCollection(ids);
}

export function focusClassByType(type) {
    const ids = expandHierarchy(getObjectIdsByType(type).filter((id) => isSceneObjectId(id)));
    return focusObjectCollection(ids);
    return true;
}

export function buildExplorerActionButton({ primaryText, secondaryText, onClick, title, badgeText = null }) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "explorer-list-item-action";
    if (title) {
        button.title = title;
    }

    const textWrapper = document.createElement("span");
    textWrapper.className = "explorer-list-item-text";

    const primary = document.createElement("span");
    primary.className = "explorer-list-item-primary";
    primary.textContent = primaryText;
    textWrapper.appendChild(primary);

    if (secondaryText) {
        const secondary = document.createElement("span");
        secondary.className = "explorer-list-item-secondary";
        secondary.textContent = secondaryText;
        textWrapper.appendChild(secondary);
    }

    button.appendChild(textWrapper);
    if (badgeText) {
        const badge = document.createElement("span");
        badge.className = "explorer-list-item-badge";
        badge.textContent = badgeText;
        button.appendChild(badge);
    }
    button.addEventListener("click", onClick);
    return button;
}

export function buildExplorerVisibilityToggle({ isActive, title, ariaLabel, onClick }) {
    const toggleButton = document.createElement("button");
    toggleButton.type = "button";
    toggleButton.className = `explorer-visibility-toggle${isActive ? " is-active" : ""}`;
    toggleButton.title = title;
    toggleButton.setAttribute("aria-pressed", isActive ? "true" : "false");
    if (ariaLabel) {
        toggleButton.setAttribute("aria-label", ariaLabel);
    }

    const toggleIcon = document.createElement("span");
    toggleIcon.className = "explorer-visibility-icon";
    toggleIcon.textContent = isActive ? "✓" : "";
    toggleButton.appendChild(toggleIcon);

    toggleButton.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick?.(event);
    });

    return toggleButton;
}

export function buildExplorerToggleCard({
    primaryText,
    secondaryText,
    onAction,
    actionTitle,
    badgeText = null,
    isActive = true,
    onToggle,
    toggleTitle,
    toggleAriaLabel,
    className = ""
}) {
    const item = document.createElement("div");
    item.className = `explorer-list-item${className ? ` ${className}` : ""}`;

    const toggleButton = buildExplorerVisibilityToggle({
        isActive,
        title: toggleTitle,
        ariaLabel: toggleAriaLabel,
        onClick: onToggle
    });

    const actionButton = buildExplorerActionButton({
        primaryText,
        secondaryText,
        onClick: onAction,
        title: actionTitle,
        badgeText
    });

    item.appendChild(toggleButton);
    item.appendChild(actionButton);
    return item;
}

export function getTreeViewRootElement() {
    const container = treeViewContent ?? treeViewContainer;
    if (!container) {
        return null;
    }

    return container.classList.contains("xeokit-tree-view")
        ? container
        : container.querySelector(".xeokit-tree-view") ?? container;
}

export function getTreeViewCheckboxes() {
    const treeRoot = getTreeViewRootElement();
    if (!treeRoot) {
        return [];
    }

    return Array.from(treeRoot.querySelectorAll("input[type=\"checkbox\"]"));
}

export function getTreeViewModelCheckbox(modelId) {
    if (!modelId) {
        return null;
    }

    return getTreeViewCheckboxes().find((checkbox) => {
        const item = checkbox.closest(".xeokit-tree-view-item");
        const title = item
            ?.querySelector(".xeokit-tree-view-item-title")
            ?.textContent
            ?.trim();

        return title === modelId;
    }) ?? null;
}

export function isModelVisible(modelId) {
    const checkbox = getTreeViewModelCheckbox(modelId);
    if (checkbox) {
        return checkbox.checked;
    }

    const modelObjectIds = getModelObjectIds(modelId)
        .filter((id) => isSceneObjectId(id));

    if (!modelObjectIds.length) {
        return true;
    }

    const visibleIds = new Set(viewer.scene?.visibleObjectIds || []);
    return modelObjectIds.some((id) => visibleIds.has(id));
}

export function setModelVisibility(modelId, shouldBeVisible) {
    if (!modelId) {
        return false;
    }

    const checkbox = getTreeViewModelCheckbox(modelId);
    if (checkbox) {
        if (checkbox.checked !== shouldBeVisible) {
            checkbox.click();
        }
        scheduleExplorerRefresh(0);
        return true;
    }

    if (!modelIsolateController) {
        return false;
    }

    const ids = expandHierarchy(
        getModelObjectIds(modelId).filter((id) => isSceneObjectId(id))
    );

    if (!ids.length) {
        return false;
    }

    modelIsolateController.setObjectsVisible(ids, shouldBeVisible);
    if (!shouldBeVisible) {
        modelIsolateController.setObjectsXRayed(ids, false);
        modelIsolateController.setObjectsHighlighted(ids, false);
    }

    clearSelection(false);
    requestRenderFrame();
    scheduleExplorerRefresh(0);
    return true;
}

export function toggleModelVisibility(modelId) {
    return setModelVisibility(modelId, !isModelVisible(modelId));
}

export function areObjectCollectionVisible(ids) {
    const filteredIds = expandHierarchy((ids || []).filter((id) => isSceneObjectId(id)));
    if (!filteredIds.length) {
        return true;
    }

    const visibleIds = new Set(viewer.scene?.visibleObjectIds || []);
    return filteredIds.some((id) => visibleIds.has(id));
}

export function setObjectCollectionVisibility(ids, shouldBeVisible) {
    if (!modelIsolateController) {
        return false;
    }

    const filteredIds = expandHierarchy((ids || []).filter((id) => isSceneObjectId(id)));
    if (!filteredIds.length) {
        return false;
    }

    modelIsolateController.setObjectsVisible(filteredIds, shouldBeVisible);
    if (!shouldBeVisible) {
        modelIsolateController.setObjectsXRayed(filteredIds, false);
        modelIsolateController.setObjectsHighlighted(filteredIds, false);
    }

    clearSelection(false);
    requestRenderFrame();
    scheduleExplorerRefresh(0);
    return true;
}

export function toggleObjectCollectionVisibility(ids) {
    return setObjectCollectionVisibility(ids, !areObjectCollectionVisible(ids));
}

export function getClassObjectIds(type, modelId) {
    const baseIds = getObjectIdsByType(type)
        .filter((id) => isSceneObjectId(id))
        .filter((id) => !modelId || (getObjectMetaModelId(id) || "SEM_MODELO") === modelId);

    return expandHierarchy(baseIds);
}

export function getStoreyObjectIds(storeyId) {
    return expandHierarchy(getObjectsByStorey(storeyId).filter((id) => isSceneObjectId(id)));
}
export function getAllClassObjectIds() {
    const classIds = getExplorerSceneMetaObjects()
        .filter((metaObject) => Boolean(metaObject?.type))
        .map((metaObject) => metaObject.sceneObjectId || metaObject.id)
        .filter((id) => isSceneObjectId(id));

    return expandHierarchy(Array.from(new Set(classIds)));
}

export function areAllObjectCollectionVisible(ids) {
    const filteredIds = expandHierarchy((ids || []).filter((id) => isSceneObjectId(id)));
    if (!filteredIds.length) {
        return false;
    }

    const visibleIds = new Set(viewer.scene?.visibleObjectIds || []);
    return filteredIds.every((id) => visibleIds.has(id));
}

export function getAllExplorerObjectIdsForActiveTab() {
    switch (activeExplorerTab) {
        case "objects":
            return expandHierarchy(
                getExplorerSceneMetaObjects()
                    .map((metaObject) => metaObject.sceneObjectId || metaObject.id)
                    .filter((id) => isSceneObjectId(id))
            );
        case "classes":
            return getAllClassObjectIds();
        case "storeys": {
            const storeyIds = Object.values(viewer.metaScene?.metaObjects || {})
                .filter((metaObject) => metaObject?.type === "IfcBuildingStorey" && metaObject?.id)
                .map((metaObject) => metaObject.id);

            return expandHierarchy(
                storeyIds.flatMap((storeyId) => getObjectsByStorey(storeyId).filter((id) => isSceneObjectId(id)))
            );
        }
        case "networks":
            return expandHierarchy(
                getExplorerSceneMetaObjects()
                    .filter((metaObject) => getMetaObjectNetworkInfo(metaObject).network !== "Sem rede")
                    .map((metaObject) => metaObject.sceneObjectId || metaObject.id)
                    .filter((id) => isSceneObjectId(id))
            );
        case "parts":
            return expandHierarchy(
                getExplorerSceneMetaObjects()
                    .filter((metaObject) => getMetaObjectPartInfo(metaObject).hasIdentification)
                    .map((metaObject) => metaObject.sceneObjectId || metaObject.id)
                    .filter((id) => isSceneObjectId(id))
            );
        default:
            return [];
    }
}

export function getExplorerSelectionState() {
    if (activeExplorerTab === "models") {
        const modelIds = Array.from(loadedModels.values()).map((model) => model.id);
        return {
            hasItems: modelIds.length > 0,
            allSelected: modelIds.length > 0 && modelIds.every((modelId) => isModelVisible(modelId))
        };
    }

    const objectIds = getAllExplorerObjectIdsForActiveTab();
    return {
        hasItems: objectIds.length > 0,
        allSelected: areAllObjectCollectionVisible(objectIds)
    };
}

export function updateTreeViewSelectionButtonState() {
    if (!toggleTreeViewSelectionButton) {
        return;
    }

    const { hasItems, allSelected } = getExplorerSelectionState();
    toggleTreeViewSelectionButton.hidden = false;
    toggleTreeViewSelectionButton.disabled = !hasItems;
    toggleTreeViewSelectionButton.textContent = allSelected ? "Desmarcar todos" : "Marcar todos";
}

export function toggleAllExplorerActiveTabVisibility() {
    const { hasItems, allSelected } = getExplorerSelectionState();
    if (!hasItems) {
        return;
    }

    const shouldBeVisible = !allSelected;

    if (activeExplorerTab === "models") {
        Array.from(loadedModels.values()).forEach((model) => {
            setModelVisibility(model.id, shouldBeVisible);
        });
        updateTreeViewSelectionButtonState();
        return;
    }

    const objectIds = getAllExplorerObjectIdsForActiveTab();
    if (!objectIds.length) {
        return;
    }

    setObjectCollectionVisibility(objectIds, shouldBeVisible);
}
export const modelUploadDateCache = new Map();
export const MODEL_UPLOAD_DATE_LOADING_TEXT = "Carregando data de upload...";

export function formatModelUploadDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        return null;
    }

    return new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date).replace(",", " -");
}

export function getModelUploadDateCacheKey(model) {
    return model?.uploadDateSrc || model?.src || model?.id || "";
}

export function getModelUploadDateRequestUrl(model, cacheKey) {
    const requestUrl = model?.uploadDateSrc || model?.src || "";

    if (typeof requestUrl === "string" && /^(?:https?:|\/|blob:)/i.test(requestUrl)) {
        return requestUrl;
    }

    if (typeof cacheKey === "string" && /^(?:https?:|\/|blob:)/i.test(cacheKey)) {
        return cacheKey;
    }

    return "";
}

export async function fetchModelUploadDate(model) {
    const cacheKey = getModelUploadDateCacheKey(model);
    if (!cacheKey || modelUploadDateCache.has(cacheKey)) {
        return modelUploadDateCache.get(cacheKey) || null;
    }

    modelUploadDateCache.set(cacheKey, MODEL_UPLOAD_DATE_LOADING_TEXT);

    try {
        const requestUrl = getModelUploadDateRequestUrl(model, cacheKey);

        if (!requestUrl || requestUrl.startsWith("blob:")) {
            modelUploadDateCache.set(cacheKey, "Data de upload indisponível");
            scheduleExplorerRefresh(0);
            return modelUploadDateCache.get(cacheKey) || null;
        }

        const response = await fetch(requestUrl, { method: "HEAD", cache: "no-store" });
        if (!response.ok) {
            throw new Error(`Resposta HTTP ${response.status} ao consultar ${requestUrl}`);
        }
        const lastModified = response.headers.get("last-modified");
        const formattedDate = lastModified ? formatModelUploadDate(new Date(lastModified)) : null;
        modelUploadDateCache.set(cacheKey, formattedDate || "Data de upload indisponível");
    } catch (error) {
        console.warn(`Não foi possível obter a data de upload do modelo ${model.id}:`, error);
        modelUploadDateCache.set(cacheKey, "Data de upload indisponível");
    }

    scheduleExplorerRefresh(0);
    return modelUploadDateCache.get(cacheKey) || null;
}

export function getModelUploadDateText(model) {
    if (model?.localReplacement) {
        return `📌 Local: ${model.localReplacement.fileName} • só nesta sessão`;
    }
    const cacheKey = getModelUploadDateCacheKey(model);
    if (!cacheKey) {
        return "Data de upload indisponível";
    }

    const cachedDate = modelUploadDateCache.get(cacheKey);
    if (cachedDate) {
        return cachedDate;
    }

    fetchModelUploadDate(model);
    return MODEL_UPLOAD_DATE_LOADING_TEXT;
}
// ---- Rastrear circuito (caminho deduzido pela infraestrutura) — NOVO
export let circuitTraceFeaturePromise = null;
export function getCircuitTraceFeature() {
    circuitTraceFeaturePromise ||= import("../features/circuit-trace/circuit-trace.js")
        .then(({ createCircuitTraceFeature }) => createCircuitTraceFeature({
            viewer,
            xktLoader,
            getModelRecord: (id) => currentModels.find((item) => item.id === id) || null,
            requestRenderFrame,
            onVisibilityChange: () => scheduleExplorerRefresh(0)
        }))
        .catch((error) => {
            circuitTraceFeaturePromise = null;
            console.error("[circuito] Falha ao carregar módulo:", error);
            return null;
        });
    return circuitTraceFeaturePromise;
}

// ---- Substituir modelo por arquivo local (XKT/IFC), só nesta sessão — NOVO
export function getModelReplaceFeature() {
    if (!modelReplaceAllowed) {
        return Promise.resolve(null);
    }
    modelReplaceFeaturePromise ||= import("../features/model-replace.js")
        .then(({ createModelReplaceFeature }) => createModelReplaceFeature({
            viewer,
            xktLoader,
            getModel: (id) => loadedModels.get(id),
            getOriginalSource: (id) => currentModels.find((item) => item.id === id)?.src || null,
            getLoadOptions: () => ({
                edges: performanceModeEnabled ? false : defaultRenderProfile.edgesEnabled,
                saoEnabled: performanceModeEnabled ? false : defaultRenderProfile.saoEnabled,
                dtxEnabled: viewerCompatibility.enableDataTextures
            }),
            registerModel: (model) => {
                applyModelRenderProfile(model);
                registerModelTransform(model);
                requestRenderFrame();
            },
            unregisterModel: (id) => {
                loadedModels.delete(id);
                objectModelIdLookup.clear();
                normalizedSceneObjectIdLookup.clear();
                invalidateExplorerCaches();
                // a cobertura guarda a geometria das paredes por modelo
                wifiCoverageFeaturePromise?.then((feature) => feature?.clearCache?.(id));
                // o rastreio de circuitos guarda a rede de caminhos por modelo
                circuitTraceFeaturePromise?.then((feature) => feature?.forgetModel?.(id));
            },
            onChanged: () => scheduleExplorerRefresh(0)
        }))
        .catch((error) => {
            modelReplaceFeaturePromise = null;
            console.error("[substituir modelo] Falha ao carregar módulo:", error);
            return null;
        });
    return modelReplaceFeaturePromise;
}

export function ensureModelReplaceStyle() {
    if (document.getElementById("explorerModelToolsStyle")) {
        return;
    }
    const style = document.createElement("style");
    style.id = "explorerModelToolsStyle";
    style.textContent = `
#treeViewContainer.explorer-enabled .explorer-list-item.has-model-tools{grid-template-columns:auto minmax(0,1fr) auto}
.explorer-model-tools{display:flex;gap:6px;align-items:center}
.explorer-model-tools button{width:32px;height:32px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:rgba(255,255,255,.06);color:#fff;cursor:pointer;font-size:15px;line-height:1}
.explorer-model-tools button:hover{background:rgba(255,255,255,.16)}
.explorer-model-tools button.is-local{border-color:#f59e0b;color:#fbbf24}
.explorer-model-item.is-local-model{border-color:rgba(245,158,11,.55)!important}`;
    document.head.appendChild(style);
}

export function appendModelReplaceTools(item, model) {
    ensureModelReplaceStyle();
    const isLocal = Boolean(model.localReplacement);
    const tools = document.createElement("div");
    tools.className = "explorer-model-tools";

    const replaceButton = document.createElement("button");
    replaceButton.type = "button";
    replaceButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 0 0-15.5-6.2L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15.5 6.2L21 16"/><path d="M21 21v-5h-5"/></svg>';
    replaceButton.title = `Substituir ${model.id} por um XKT/IFC do seu computador (só nesta sessão, nada é enviado)`;
    replaceButton.setAttribute("aria-label", replaceButton.title);
    if (isLocal) replaceButton.classList.add("is-local");
    replaceButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        const feature = await getModelReplaceFeature();
        feature?.pickAndReplace(model.id);
    });
    tools.appendChild(replaceButton);

    if (isLocal) {
        const restoreButton = document.createElement("button");
        restoreButton.type = "button";
        restoreButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
        restoreButton.title = `Voltar ${model.id} para o arquivo do projeto`;
        restoreButton.setAttribute("aria-label", restoreButton.title);
        restoreButton.addEventListener("click", async (event) => {
            event.stopPropagation();
            const feature = await getModelReplaceFeature();
            feature?.restoreModel(model.id).catch((error) => console.error("[substituir modelo]", error));
        });
        tools.appendChild(restoreButton);
        item.classList.add("is-local-model");
    }

    item.classList.add("has-model-tools");
    item.appendChild(tools);
    return item;
}

export function buildExplorerModelItem(model) {
    const item = buildExplorerModelCard(model);
    return modelReplaceAllowed ? appendModelReplaceTools(item, model) : item;
}

export function buildExplorerModelCard(model) {
    const label = model.displayName || model.src || model.id;
    const isVisible = isModelVisible(model.id);

    return buildExplorerToggleCard({
        primaryText: label,
        secondaryText: getModelUploadDateText(model),
        actionTitle: `Isolar modelo ${label}`,
        onAction: () => {
            focusModelById(model.id);
            setActiveExplorerTab("models");
        },
        isActive: isVisible,
        toggleTitle: isVisible
            ? `Desativar modelo ${model.id}`
            : `Ativar modelo ${model.id}`,
        toggleAriaLabel: isVisible
            ? `Desativar modelo ${model.id}`
            : `Ativar modelo ${model.id}`,
        onToggle: () => toggleModelVisibility(model.id),
        className: "explorer-model-item"
    });
}

export function toggleExplorerGroup(tabId, groupKey) {
    const expandedGroups = explorerExpandedGroups[tabId];
    if (!expandedGroups) {
        return false;
    }

    if (expandedGroups.has(groupKey)) {
        expandedGroups.delete(groupKey);
        return false;
    }

    expandedGroups.add(groupKey);
    return true;
}

export function buildExplorerCollapsibleGroup({
    tabId,
    groupKey,
    titleText,
    metaText,
    countText,
    onHeaderClick,
    renderChildren,
    isActive = true,
    onToggleVisibility,
    toggleTitle,
    toggleAriaLabel,
    badgeText
}) {
    const isExpanded = explorerExpandedGroups[tabId]?.has(groupKey);

    const section = document.createElement("section");
    section.className = `explorer-tree-group${isExpanded ? " is-expanded" : ""}`;

    const header = buildExplorerToggleCard({
        primaryText: titleText,
        secondaryText: [metaText, countText].filter(Boolean).join(" • "),
        actionTitle: titleText,
        badgeText,
        onAction: () => {
            toggleExplorerGroup(tabId, groupKey);
            if (typeof onHeaderClick === "function") {
                onHeaderClick();
            }
            scheduleExplorerRefresh(0);
        },
        isActive,
        toggleTitle,
        toggleAriaLabel,
        onToggle: onToggleVisibility,
        className: "explorer-tree-group-header"
    });

    const actionButton = header.querySelector('.explorer-list-item-action');
    if (actionButton) {
        actionButton.setAttribute("aria-expanded", isExpanded ? "true" : "false");
    }

    section.appendChild(header);

    const children = document.createElement("div");
    children.className = "explorer-tree-group-children";
    children.hidden = !isExpanded;

    if (isExpanded && typeof renderChildren === "function") {
        renderChildren(children);
    }

    section.appendChild(children);
    return section;
}
export function renderExplorerModelsTab() {
    const summary = explorerTabSummaries.get("models");
    const list = explorerTabLists.get("models");
    if (!summary || !list) {
        return;
    }

    const models = Array.from(loadedModels.values());
    list.innerHTML = "";

    if (!models.length) {
        summary.textContent = "Nenhum modelo carregado ainda.";
        return;
    }

    summary.textContent = `${models.length} modelo(s)`;
    summary.dataset.tip = "Clique no modelo para isolar. Use a caixa de seleção para mostrar ou ocultar.";

    models
        .sort((a, b) => String(a.id).localeCompare(String(b.id), "pt-BR"))
        .forEach((model) => {
            list.appendChild(buildExplorerModelItem(model));
        });
}

export function getExplorerModelLabel(modelId) {
    if (!modelId) {
        return "Modelo não identificado";
    }

    const model = loadedModels.get(modelId);
    return model?.displayName || model?.src || model?.id || modelId;
}
export function renderExplorerObjectsTab() {
    const summary = explorerTabSummaries.get("objects");
    const list = explorerTabLists.get("objects");
    if (!summary || !list) {
        return;
    }

    const metaObjects = getExplorerSceneMetaObjects()
        .map((metaObject) => {
            const { modelId, modelLabel } = getCachedExplorerMetaInfo(metaObject);
            return {
                sceneObjectId: metaObject.sceneObjectId || metaObject.id,
                name: metaObject.name || metaObject.id,
                type: metaObject.type || "Sem classe",
                modelId,
                modelLabel
            };
        })
        .sort((a, b) => {
            const modelComparison = a.modelLabel.localeCompare(b.modelLabel, "pt-BR");
            if (modelComparison !== 0) {
                return modelComparison;
            }
            return a.name.localeCompare(b.name, "pt-BR");
        });

    list.innerHTML = "";

    if (!metaObjects.length) {
        summary.textContent = "Nenhum objeto disponível para listagem.";
        return;
    }

    const groupedObjects = new Map();
    metaObjects.forEach((entry) => {
        if (!groupedObjects.has(entry.modelId)) {
            groupedObjects.set(entry.modelId, {
                modelId: entry.modelId,
                modelLabel: entry.modelLabel,
                items: []
            });
        }
        groupedObjects.get(entry.modelId).items.push(entry);
    });


    const groups = Array.from(groupedObjects.values())
        .sort((a, b) => a.modelLabel.localeCompare(b.modelLabel, "pt-BR"));

    groups.forEach((group) => {
        const groupIsVisible = isModelVisible(group.modelId);
        list.appendChild(buildExplorerCollapsibleGroup({
            tabId: "objects",
            groupKey: group.modelId,
            titleText: group.modelLabel,
            metaText: group.modelId,
            countText: `${group.items.length} objeto(s)`,
            isActive: groupIsVisible,
            toggleTitle: groupIsVisible
                ? `Desativar objetos do IFC ${group.modelId}`
                : `Ativar objetos do IFC ${group.modelId}`,
            toggleAriaLabel: groupIsVisible
                ? `Desativar objetos do IFC ${group.modelId}`
                : `Ativar objetos do IFC ${group.modelId}`,
            onToggleVisibility: () => toggleModelVisibility(group.modelId),
            renderChildren: (children) => {
                group.items.forEach((entry) => {
                    const objectId = entry.sceneObjectId;
                    const objectIsVisible = areObjectCollectionVisible([objectId]);

                    const item = buildExplorerToggleCard({
                        primaryText: entry.name,
                        secondaryText: `${entry.type} • ${objectId}`,
                        actionTitle: `Focar objeto ${objectId}`,
                        onAction: () => focusObjectById(objectId),
                        isActive: objectIsVisible,
                        toggleTitle: objectIsVisible
                            ? `Desativar objeto ${entry.name}`
                            : `Ativar objeto ${entry.name}`,
                        toggleAriaLabel: objectIsVisible
                            ? `Desativar objeto ${entry.name}`
                            : `Ativar objeto ${entry.name}`,
                        onToggle: () => toggleObjectCollectionVisibility([objectId]),
                        className: "explorer-tree-leaf"
                    });
                    children.appendChild(item);
                });
            }
        }));
    });

    summary.textContent = `${metaObjects.length} objeto(s) em ${groups.length} IFC(s)`;
    summary.dataset.tip = "Use a caixa de seleção para mostrar ou ocultar, clique no IFC para expandir e no objeto para focar.";
}

export function renderExplorerClassesTab() {
    const summary = explorerTabSummaries.get("classes");
    const list = explorerTabLists.get("classes");
    if (!summary || !list) {
        return;
    }

    const metaObjects = getExplorerSceneMetaObjects();
    const metaObjectsWithType = metaObjects.filter((metaObject) => Boolean(metaObject?.type));

    const groupedClasses = new Map();

    metaObjectsWithType.forEach((metaObject) => {
        const { modelId } = getCachedExplorerMetaInfo(metaObject);
        if (!groupedClasses.has(modelId)) {
            groupedClasses.set(modelId, {
                modelId,
                modelLabel: getExplorerModelLabel(modelId),
                classes: new Map()
            });
        }
        const type = metaObject.type || "Sem classe";
        const modelEntry = groupedClasses.get(modelId);
        const classEntry = modelEntry.classes.get(type) || { count: 0 };
        classEntry.count += 1;
        modelEntry.classes.set(type, classEntry);
    });

    const entries = Array.from(groupedClasses.values())
        .map((group) => ({
            ...group,
            classEntries: Array.from(group.classes.entries())
                .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0], "pt-BR"))
        }))
        .sort((a, b) => a.modelLabel.localeCompare(b.modelLabel, "pt-BR"));

    list.innerHTML = "";

    if (!entries.length) {
        summary.textContent = "Nenhuma classe IFC encontrada.";
        updateTreeViewSelectionButtonState();
        return;
    }

    const totalClasses = entries.reduce((sum, group) => sum + group.classEntries.length, 0);
    summary.textContent = `${totalClasses} classe(s) em ${entries.length} IFC(s)`;
    summary.dataset.tip = "Use a caixa de seleção para mostrar ou ocultar, clique no IFC para expandir e na classe para isolar.";

    entries.forEach((group) => {
        const totalObjects = group.classEntries.reduce((sum, [, entry]) => sum + entry.count, 0);
        const groupIsVisible = isModelVisible(group.modelId);
        list.appendChild(buildExplorerCollapsibleGroup({
            tabId: "classes",
            groupKey: group.modelId,
            titleText: group.modelLabel,
            metaText: group.modelId,
            countText: `${group.classEntries.length} classe(s) • ${totalObjects} objeto(s)`,
            isActive: groupIsVisible,
            toggleTitle: groupIsVisible
                ? `Desativar classes do IFC ${group.modelId}`
                : `Ativar classes do IFC ${group.modelId}`,
            toggleAriaLabel: groupIsVisible
                ? `Desativar classes do IFC ${group.modelId}`
                : `Ativar classes do IFC ${group.modelId}`,
            onToggleVisibility: () => toggleModelVisibility(group.modelId),
            badgeText: null,
            renderChildren: (children) => {
                group.classEntries.forEach(([type, entry]) => {
                    const classObjectIds = getClassObjectIds(type, group.modelId);
                    const classIsVisible = areObjectCollectionVisible(classObjectIds);

                    const item = buildExplorerToggleCard({
                        primaryText: type,
                        secondaryText: `${entry.count} objeto(s)`,
                        actionTitle: `Isolar classe ${type} no IFC ${group.modelId}`,
                        onAction: () => {
                            focusClassByTypeAndModel(type, group.modelId) || focusClassByType(type);
                            setActiveExplorerTab("classes");
                        },
                        badgeText: null,
                        isActive: classIsVisible,
                        toggleTitle: classIsVisible
                            ? `Desativar classe ${type}`
                            : `Ativar classe ${type}`,
                        toggleAriaLabel: classIsVisible
                            ? `Desativar classe ${type}`
                            : `Ativar classe ${type}`,
                        onToggle: () => toggleObjectCollectionVisibility(classObjectIds),
                        className: "explorer-tree-leaf"
                    });
                    children.appendChild(item);
                });
            }
        }));
    });
    updateTreeViewSelectionButtonState();
}

export function renderExplorerStoreysTab() {
    const summary = explorerTabSummaries.get("storeys");
    const list = explorerTabLists.get("storeys");
    if (!summary || !list) {
        return;
    }

    const groupedStoreys = new Map();

    Object.values(viewer.metaScene?.metaObjects || {}).forEach((metaObject) => {
        if (metaObject?.type !== "IfcBuildingStorey" || !metaObject?.id) {
            return;
        }

        const { modelId } = getCachedExplorerMetaInfo(metaObject);
        if (!groupedStoreys.has(modelId)) {
            groupedStoreys.set(modelId, {
                modelId,
                modelLabel: getExplorerModelLabel(modelId),
                storeys: []
            });
        }

        groupedStoreys.get(modelId).storeys.push({
            id: metaObject.id,
            name: metaObject.name || metaObject.id
        });
    });

    const groups = Array.from(groupedStoreys.values())
        .map((group) => ({
            ...group,
            storeys: group.storeys.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
        }))
        .sort((a, b) => a.modelLabel.localeCompare(b.modelLabel, "pt-BR"));

    list.innerHTML = "";

    if (!groups.length) {
        summary.textContent = "Carregue um modelo com pavimentos IFC para usar esta aba.";
        return;
    }

    const totalStoreys = groups.reduce((sum, group) => sum + group.storeys.length, 0);
    summary.textContent = `${totalStoreys} pavimento(s) em ${groups.length} IFC(s)`;
    summary.dataset.tip = "Use a caixa de seleção para mostrar ou ocultar, clique no IFC para expandir e no pavimento para isolar.";

    groups.forEach((group) => {
        const groupIsVisible = isModelVisible(group.modelId);
        list.appendChild(buildExplorerCollapsibleGroup({
            tabId: "storeys",
            groupKey: group.modelId,
            titleText: group.modelLabel,
            metaText: group.modelId,
            countText: `${group.storeys.length} pavimento(s)`,
            isActive: groupIsVisible,
            toggleTitle: groupIsVisible
                ? `Desativar pavimentos do IFC ${group.modelId}`
                : `Ativar pavimentos do IFC ${group.modelId}`,
            toggleAriaLabel: groupIsVisible
                ? `Desativar pavimentos do IFC ${group.modelId}`
                : `Ativar pavimentos do IFC ${group.modelId}`,
            onToggleVisibility: () => toggleModelVisibility(group.modelId),
            renderChildren: (children) => {
                group.storeys.forEach((storey) => {
                    const storeyObjectIds = getStoreyObjectIds(storey.id);
                    const storeyIsVisible = areObjectCollectionVisible(storeyObjectIds);

                    const item = buildExplorerToggleCard({
                        primaryText: storey.name,
                        secondaryText: storey.id,
                        actionTitle: `Isolar pavimento ${storey.name}`,
                        onAction: () => {
                            isolateStorey(storey.id);
                            setActiveExplorerTab("storeys");
                        },
                        isActive: storeyIsVisible,
                        toggleTitle: storeyIsVisible
                            ? `Desativar pavimento ${storey.name}`
                            : `Ativar pavimento ${storey.name}`,
                        toggleAriaLabel: storeyIsVisible
                            ? `Desativar pavimento ${storey.name}`
                            : `Ativar pavimento ${storey.name}`,
                        onToggle: () => toggleObjectCollectionVisibility(storeyObjectIds),
                        className: "explorer-tree-leaf"
                    });
                    children.appendChild(item);
                });
            }
        }));
    });
}

export function renderExplorerNetworksTab() {
    const summary = explorerTabSummaries.get("networks");
    const list = explorerTabLists.get("networks");
    if (!summary || !list) {
        return;
    }

    const groupedModels = new Map();

    getExplorerSceneMetaObjects().forEach((metaObject) => {
        const { networkInfo, modelId, modelLabel } = getCachedExplorerMetaInfo(metaObject);
        const { network } = networkInfo;
        if (network === "Sem rede") {
            return;
        }

        const objectId = metaObject.sceneObjectId || metaObject.id;

        if (!groupedModels.has(modelId)) {
            groupedModels.set(modelId, {
                modelId,
                modelLabel,
                networks: new Map(),
                objectIds: new Set()
            });
        }

        const modelEntry = groupedModels.get(modelId);
        modelEntry.objectIds.add(objectId);

        if (!modelEntry.networks.has(network)) {
            modelEntry.networks.set(network, {
                name: network,
                objectIds: new Set(),
                itemCount: 0
            });
        }

        const networkEntry = modelEntry.networks.get(network);
        networkEntry.objectIds.add(objectId);
        networkEntry.itemCount += 1;
    });

    const models = Array.from(groupedModels.values())
        .map((modelEntry) => ({
            ...modelEntry,
            networks: Array.from(modelEntry.networks.values())
                .map((networkEntry) => ({
                    ...networkEntry,
                    objectIds: expandHierarchy(Array.from(networkEntry.objectIds))
                }))
                .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
            objectIds: expandHierarchy(Array.from(modelEntry.objectIds))
        }))
        .sort((a, b) => a.modelLabel.localeCompare(b.modelLabel, "pt-BR"));

    list.innerHTML = "";

    if (!models.length) {
        summary.textContent = "Nenhuma propriedade IFC de rede foi encontrada. Para usar esta aba, o modelo precisa ter campos como Rede.";
        updateTreeViewSelectionButtonState();
        return;
    }

    const totalNetworks = models.reduce((sum, modelEntry) => sum + modelEntry.networks.length, 0);

    summary.textContent = `${totalNetworks} rede(s) em ${models.length} IFC(s)`;
    summary.dataset.tip = "Use a caixa de seleção para mostrar ou ocultar, clique no IFC para expandir e na rede para isolar.";

    models.forEach((modelEntry) => {
        const modelIsVisible = isModelVisible(modelEntry.modelId);
        const modelGroupKey = `model:${modelEntry.modelId}`;

        list.appendChild(buildExplorerCollapsibleGroup({
            tabId: "networks",
            groupKey: modelGroupKey,
            titleText: modelEntry.modelLabel,
            metaText: modelEntry.modelId,
            countText: `${modelEntry.networks.length} rede(s) • ${modelEntry.objectIds.length} objeto(s)`,
            isActive: modelIsVisible,
            toggleTitle: modelIsVisible
                ? `Desativar redes do IFC ${modelEntry.modelId}`
                : `Ativar redes do IFC ${modelEntry.modelId}`,
            toggleAriaLabel: modelIsVisible
                ? `Desativar redes do IFC ${modelEntry.modelId}`
                : `Ativar redes do IFC ${modelEntry.modelId}`,
            onToggleVisibility: () => toggleModelVisibility(modelEntry.modelId),
            renderChildren: (modelChildren) => {
                modelEntry.networks.forEach((networkEntry) => {
                    const networkIsVisible = areObjectCollectionVisible(networkEntry.objectIds);
                    const item = buildExplorerToggleCard({
                        primaryText: networkEntry.name,
                        secondaryText: `${modelEntry.modelId} • ${networkEntry.itemCount} objeto(s)`,
                        actionTitle: `Isolar rede ${networkEntry.name} dentro de ${modelEntry.modelLabel}`,
                        onAction: () => {
                            focusNetworkGroup(networkEntry.name, modelEntry.modelId);
                            setActiveExplorerTab("networks");
                        },
                        isActive: networkIsVisible,
                        toggleTitle: networkIsVisible
                            ? `Desativar rede ${networkEntry.name} do agrupamento ${modelEntry.modelLabel}`
                            : `Ativar rede ${networkEntry.name} do agrupamento ${modelEntry.modelLabel}`,
                        toggleAriaLabel: networkIsVisible
                            ? `Desativar rede ${networkEntry.name} do agrupamento ${modelEntry.modelLabel}`
                            : `Ativar rede ${networkEntry.name} do agrupamento ${modelEntry.modelLabel}`,
                        onToggle: () => toggleObjectCollectionVisibility(networkEntry.objectIds),
                        className: "explorer-tree-leaf"
                    });

                    modelChildren.appendChild(item);
                });
            }
        }));
    });

    updateTreeViewSelectionButtonState();
}

export function renderExplorerPartsTab() {
    const summary = explorerTabSummaries.get("parts");
    const list = explorerTabLists.get("parts");
    if (!summary || !list) {
        return;
    }

    const groupedModels = new Map();

    getExplorerSceneMetaObjects().forEach((metaObject) => {
        const { partInfo, modelId, modelLabel } = getCachedExplorerMetaInfo(metaObject);
        if (!partInfo.hasIdentification) {
            return;
        }

        const objectId = metaObject.sceneObjectId || metaObject.id;

        if (!groupedModels.has(modelId)) {
            groupedModels.set(modelId, {
                modelId,
                modelLabel,
                classes: new Map(),
                objectIds: new Set()
            });
        }

        const modelEntry = groupedModels.get(modelId);
        modelEntry.objectIds.add(objectId);

        if (!modelEntry.classes.has(partInfo.className)) {
            modelEntry.classes.set(partInfo.className, {
                name: partInfo.className,
                types: new Map(),
                objectIds: new Set(),
                itemCount: 0
            });
        }

        const classEntry = modelEntry.classes.get(partInfo.className);
        classEntry.objectIds.add(objectId);
        classEntry.itemCount += 1;

        if (!classEntry.types.has(partInfo.typeName)) {
            classEntry.types.set(partInfo.typeName, {
                name: partInfo.typeName,
                parts: new Map(),
                objectIds: new Set(),
                itemCount: 0
            });
        }

        const typeEntry = classEntry.types.get(partInfo.typeName);
        typeEntry.objectIds.add(objectId);
        typeEntry.itemCount += 1;

        if (!typeEntry.parts.has(partInfo.partName)) {
            typeEntry.parts.set(partInfo.partName, {
                name: partInfo.partName,
                objectIds: new Set(),
                itemCount: 0
            });
        }

        const partEntry = typeEntry.parts.get(partInfo.partName);
        partEntry.objectIds.add(objectId);
        partEntry.itemCount += 1;
    });

    const models = Array.from(groupedModels.values())
        .map((modelEntry) => ({
            ...modelEntry,
            classes: Array.from(modelEntry.classes.values())
                .map((classEntry) => ({
                    ...classEntry,
                    types: Array.from(classEntry.types.values())
                        .map((typeEntry) => ({
                            ...typeEntry,
                            parts: Array.from(typeEntry.parts.values())
                                .map((partEntry) => ({
                                    ...partEntry,
                                    objectIds: expandHierarchy(Array.from(partEntry.objectIds))
                                }))
                                .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name, "pt-BR")),
                            objectIds: expandHierarchy(Array.from(typeEntry.objectIds))
                        }))
                        .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name, "pt-BR")),
                    objectIds: expandHierarchy(Array.from(classEntry.objectIds))
                }))
                .sort((a, b) => b.itemCount - a.itemCount || a.name.localeCompare(b.name, "pt-BR")),
            objectIds: expandHierarchy(Array.from(modelEntry.objectIds))
        }))
        .sort((a, b) => a.modelLabel.localeCompare(b.modelLabel, "pt-BR"));

    list.innerHTML = "";

    if (!models.length) {
        summary.textContent = "Nenhuma peça com propriedades em Identificação_Elemento foi encontrada. Para usar esta aba, o modelo precisa ter Classe, Tipo ou Nome nesse conjunto.";
        updateTreeViewSelectionButtonState();
        return;
    }

    const totalClasses = models.reduce((sum, modelEntry) => sum + modelEntry.classes.length, 0);
    const totalTypes = models.reduce((sum, modelEntry) => sum + modelEntry.classes.reduce((classSum, classEntry) => classSum + classEntry.types.length, 0), 0);
    const totalParts = models.reduce((sum, modelEntry) => sum + modelEntry.classes.reduce((classSum, classEntry) => classSum + classEntry.types.reduce((typeSum, typeEntry) => typeSum + typeEntry.parts.length, 0), 0), 0);

    summary.textContent = `${totalParts} peça(s), ${totalTypes} tipo(s), ${totalClasses} classe(s)`;
    summary.dataset.tip = "Use a caixa de seleção para mostrar ou ocultar, clique no IFC para expandir e na peça para isolar.";

    models.forEach((modelEntry) => {
        const modelIsVisible = isModelVisible(modelEntry.modelId);
        const modelGroupKey = `model:${modelEntry.modelId}`;

        list.appendChild(buildExplorerCollapsibleGroup({
            tabId: "parts",
            groupKey: modelGroupKey,
            titleText: modelEntry.modelLabel,
            metaText: modelEntry.modelId,
            countText: `${modelEntry.classes.length} classe(s) • ${modelEntry.objectIds.length} objeto(s)`,
            isActive: modelIsVisible,
            toggleTitle: modelIsVisible
                ? `Desativar peças do IFC ${modelEntry.modelId}`
                : `Ativar peças do IFC ${modelEntry.modelId}`,
            toggleAriaLabel: modelIsVisible
                ? `Desativar peças do IFC ${modelEntry.modelId}`
                : `Ativar peças do IFC ${modelEntry.modelId}`,
            onToggleVisibility: () => toggleModelVisibility(modelEntry.modelId),
            renderChildren: (modelChildren) => {
                modelEntry.classes.forEach((classEntry) => {
                    const classGroupKey = `${modelGroupKey}:class:${classEntry.name}`;
                    const classIsVisible = areObjectCollectionVisible(classEntry.objectIds);

                    modelChildren.appendChild(buildExplorerCollapsibleGroup({
                        tabId: "parts",
                        groupKey: classGroupKey,
                        titleText: classEntry.name,
                        metaText: `${modelEntry.modelId} • ${classEntry.types.length} tipo(s)`,
                        countText: `${classEntry.itemCount} objeto(s)`,
                        isActive: classIsVisible,
                        toggleTitle: classIsVisible
                            ? `Desativar classe ${classEntry.name}`
                            : `Ativar classe ${classEntry.name}`,
                        toggleAriaLabel: classIsVisible
                            ? `Desativar classe ${classEntry.name}`
                            : `Ativar classe ${classEntry.name}`,
                        onToggleVisibility: () => toggleObjectCollectionVisibility(classEntry.objectIds),
                        renderChildren: (classChildren) => {
                            classEntry.types.forEach((typeEntry) => {
                                const typeGroupKey = `${classGroupKey}:type:${typeEntry.name}`;
                                const typeIsVisible = areObjectCollectionVisible(typeEntry.objectIds);

                                classChildren.appendChild(buildExplorerCollapsibleGroup({
                                    tabId: "parts",
                                    groupKey: typeGroupKey,
                                    titleText: typeEntry.name,
                                    metaText: `${modelEntry.modelId} • ${typeEntry.parts.length} peça(s)`,
                                    countText: `${typeEntry.itemCount} objeto(s)`,
                                    isActive: typeIsVisible,
                                    toggleTitle: typeIsVisible
                                        ? `Desativar tipo ${typeEntry.name}`
                                        : `Ativar tipo ${typeEntry.name}`,
                                    toggleAriaLabel: typeIsVisible
                                        ? `Desativar tipo ${typeEntry.name}`
                                        : `Ativar tipo ${typeEntry.name}`,
                                    onToggleVisibility: () => toggleObjectCollectionVisibility(typeEntry.objectIds),
                                    renderChildren: (typeChildren) => {
                                        typeEntry.parts.forEach((partEntry) => {
                                            const partIsVisible = areObjectCollectionVisible(partEntry.objectIds);

                                            typeChildren.appendChild(buildExplorerToggleCard({
                                                primaryText: partEntry.name,
                                                secondaryText: `${modelEntry.modelId} • ${partEntry.itemCount} objeto(s)`,
                                                actionTitle: `Isolar peça ${partEntry.name} no IFC ${modelEntry.modelId}`,
                                                onAction: () => {
                                                    focusObjectCollection(partEntry.objectIds);
                                                    setActiveExplorerTab("parts");
                                                },
                                                isActive: partIsVisible,
                                                toggleTitle: partIsVisible
                                                    ? `Desativar peça ${partEntry.name}`
                                                    : `Ativar peça ${partEntry.name}`,
                                                toggleAriaLabel: partIsVisible
                                                    ? `Desativar peça ${partEntry.name}`
                                                    : `Ativar peça ${partEntry.name}`,
                                                onToggle: () => toggleObjectCollectionVisibility(partEntry.objectIds),
                                                className: "explorer-tree-leaf"
                                            }));
                                        });
                                    }
                                }));
                            });
                        }
                    }));
                });
            }
        }));
    });

    updateTreeViewSelectionButtonState();
}

export function refreshExplorerPanels() {
    if (!explorerTabsInitialized || !isExplorerTabAllowed(activeExplorerTab)) {
        return;
    }
    if (explorerLoadedTabs.has(activeExplorerTab)) {
        return;
    }
    switch (activeExplorerTab) {
        case "objects":
            renderExplorerObjectsTab();
            break;
        case "classes":
            renderExplorerClassesTab();
            break;
        case "storeys":
            renderExplorerStoreysTab();
            break;
        case "networks":
            renderExplorerNetworksTab();
            break;
        case "parts":
            renderExplorerPartsTab();
            break;
        case "models":
        default:
            renderExplorerModelsTab();
            break;
    }
    explorerLoadedTabs.add(activeExplorerTab);
}
