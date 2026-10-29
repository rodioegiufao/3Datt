// Módulo "access" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { RESTRICTED_EXPLORER_TABS, getViewerPermissions } from "../core/viewer-permissions.js";
import { collisionPanel, collisionPanelToggleButton, collisionResultsList, collisionSummary, currentModelTransforms, currentModels, helpPanel, jsPDF, loadedModels, materialsPanel, materialsPanelToggleButton, setExplorerTabsAccess, transformPanel, transformPanelToggleButton, viewer, xktLoader } from "../viewer-authenticated.js";
import { scheduleExplorerRefresh } from "./explorer.js";
import { getMetaObjectNetworkInfo, resolveSceneObjectId } from "./ifc-meta.js";
import { extractNumericPropertyValue, getSectionVisibleFraction, normalizeQuantityByIfcType } from "./materials.js";
import { hideCollisionPanel, hidePanelElement, setupDraggablePanel } from "./panels.js";
import { requestRenderFrame } from "./performance.js";
import { getAllObjectIds } from "./scene-objects.js";

export let collisionFeatureAllowed = false;
export let materialsFeatureAllowed = false;
export let transformFeatureAllowed = false;
export let quadroFeatureAllowed = false;      // NOVO
export let wifiCoverageFeaturePromise = null; // NOVO
export let modelReplaceAllowed = false;
export let clashFeaturePromise = null;

export function setupCollisionPanelControls() {
    if (!collisionPanel || !collisionSummary || !collisionResultsList) {
        return;
    }

    // O botão acompanha o painel: fechou por qualquer caminho (✕, Esc, outro painel) → desmarca
    new MutationObserver(() => {
        collisionPanelToggleButton?.classList.toggle("active", !collisionPanel.hidden);
        collisionPanelToggleButton?.setAttribute("aria-pressed", String(!collisionPanel.hidden));
    }).observe(collisionPanel, { attributes: true, attributeFilter: ["hidden"] });

    collisionPanelToggleButton?.addEventListener("click", async () => {
        if (!collisionFeatureAllowed) return;
        // Segundo clique no botão fecha o painel
        if (!collisionPanel.hidden) {
            const closeButton = collisionPanel.querySelector("#closeCollisionPanel");
            if (closeButton) closeButton.click();
            else collisionPanel.hidden = true;
            return;
        }
        collisionPanel.hidden = false;
        collisionPanelToggleButton.classList.add("active");
        if (!clashFeaturePromise) {
            collisionSummary.textContent = "Carregando módulo de compatibilização…";
            clashFeaturePromise = import("../features/clash/clash-feature.js").then(({ createClashFeature }) => createClashFeature({
                viewer,
                panel: collisionPanel,
                models: () => currentModels,
                transforms: () => currentModelTransforms,
                getAllObjectIds,
                requestRenderFrame,
                jsPDF,
                xktLoader
            })).catch((error) => {
                clashFeaturePromise = null;
                console.error("[clash] Falha ao carregar módulo:", error);
                collisionSummary.textContent = "Não foi possível carregar a Compatibilização BIM.";
            });
        }
        await clashFeaturePromise;
    });

}
// Link direto para uma interferência (?interferencia=...): abre a colisão isolada
export function setupClashLinkFromUrl() {
    if (!new URLSearchParams(window.location.search).has("interferencia")) {
        return;
    }
    window.__clashLinkPending = true;
    import("../features/clash/clash-link.js")
        .then(({ openClashFromUrl }) => openClashFromUrl({
            viewer,
            requestRenderFrame,
            getModelLabel: (id) => {
                const model = (currentModels || []).find((item) => item?.id === id);
                return model?.displayName || id;
            },
            onDone: ({ found }) => {
                window.__clashLinkPending = false;
                if (!found && viewer.scene.objectIds.length) {
                    viewer.cameraFlight.jumpTo(viewer.scene);
                }
            }
        }))
        .catch((error) => {
            window.__clashLinkPending = false;
            console.error("[link da interferência] Falha ao abrir:", error);
        });
}

export async function fetchViewerUser() {
    try {
        const response = await fetch("/api/auth", { credentials: "same-origin" });
        if (!response.ok) {
            return null;
        }
        const data = await response.json().catch(() => ({}));
        return data.user || null;
    } catch (_error) {
        return null;
    }
}

export function setMaterialsFeatureAccess(isAllowed) {
    materialsFeatureAllowed = Boolean(isAllowed);

    if (materialsPanelToggleButton) {
        materialsPanelToggleButton.hidden = !materialsFeatureAllowed;
        materialsPanelToggleButton.setAttribute("aria-hidden", String(!materialsFeatureAllowed));
        materialsPanelToggleButton.tabIndex = materialsFeatureAllowed ? 0 : -1;
    }

    if (!materialsFeatureAllowed) {
        hidePanelElement(materialsPanel, materialsPanelToggleButton);
    }
}

export function setCollisionFeatureAccess(isAllowed) {
    collisionFeatureAllowed = Boolean(isAllowed);

    if (collisionPanelToggleButton) {
        collisionPanelToggleButton.title = "Compatibilização BIM";
        const labelNode = Array.from(collisionPanelToggleButton.childNodes).find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (labelNode) labelNode.textContent = "\n            ⚡ Compatibilização BIM\n        ";
        collisionPanelToggleButton.hidden = !collisionFeatureAllowed;
        collisionPanelToggleButton.setAttribute("aria-hidden", String(!collisionFeatureAllowed));
        collisionPanelToggleButton.tabIndex = collisionFeatureAllowed ? 0 : -1;
    }

    if (!collisionFeatureAllowed) {
        hideCollisionPanel();
    }
}
export function setTransformFeatureAccess(isAllowed) {
    transformFeatureAllowed = Boolean(isAllowed);

    if (transformPanelToggleButton) {
        transformPanelToggleButton.hidden = !transformFeatureAllowed;
        transformPanelToggleButton.setAttribute("aria-hidden", String(!transformFeatureAllowed));
        transformPanelToggleButton.tabIndex = transformFeatureAllowed ? 0 : -1;
    }

    if (!transformFeatureAllowed) {
        hidePanelElement(transformPanel, transformPanelToggleButton);
    }
}
// Cobertura Wi-Fi: módulo carregado só para quem tem permissão.
export function setWifiCoverageFeatureAccess(isAllowed) {
    if (!isAllowed) {
        wifiCoverageFeaturePromise?.then((feature) => feature?.disable());
        return;
    }
    if (wifiCoverageFeaturePromise) {
        wifiCoverageFeaturePromise.then((feature) => feature?.enable());
        return;
    }
    wifiCoverageFeaturePromise = import("../features/wifi/wifi-coverage.js")
        .then(({ createWifiCoverageFeature }) => createWifiCoverageFeature({
            viewer,
            xktLoader,
            getModelIds: () => Array.from(loadedModels.keys()),
            getModelSources: () => currentModels,
            resolveSceneObjectId,
            requestRenderFrame,
            onVisibilityChange: () => scheduleExplorerRefresh(0)
        }))
        .then((feature) => {
            // Painel da Cobertura arrastável, como os demais (posição lembrada por página)
            setupDraggablePanel({
                panel: document.getElementById("wifiCoveragePanel"),
                storageKey: `wifiCoveragePanelPosition:${window.location.pathname}`,
                ignoreSelectors: "input, button, textarea, select, a, label, progress, .wifi-ap-list, .wifi-diag"
            });
            return feature;
        })
        .catch((error) => {
            wifiCoverageFeaturePromise = null;
            console.error("[wifi] Falha ao carregar módulo de cobertura:", error);
        });
}
// Instalações civis (HID, IRRI, GLP, PLU, SAN, INC): carregado sob demanda, mesmo acesso dos materiais
let civilFeaturePromise = null;
export function setCivilFeatureAccess(isAllowed) {
    if (!isAllowed) {
        civilFeaturePromise?.then((feature) => feature?.disable());
        return;
    }
    if (civilFeaturePromise) {
        civilFeaturePromise.then((feature) => feature?.enable());
        return;
    }
    civilFeaturePromise = import("../features/civil/civil-quantities.js")
        .then(({ createCivilQuantitiesFeature }) => createCivilQuantitiesFeature({
            viewer,
            getModels: () => currentModels,
            // Sub-rede = propriedade "Rede" da peça (a mesma da aba "Redes" do Explorador)
            getSubnetwork: (metaObject) => {
                const { network } = getMetaObjectNetworkInfo(metaObject);
                return network && network !== "Sem rede" ? network : "";
            },
            isItemsPropertySet: (pset) => /itens[ _-]?associados|associated items/i.test(String(pset?.name || pset?.id || "")),
            readNumber: extractNumericPropertyValue,
            normalizeQuantity: normalizeQuantityByIfcType,
            getVisibleFraction: (objectId) => getSectionVisibleFraction(objectId),
            requestRenderFrame
        }))
        .then((feature) => {
            setupDraggablePanel({
                panel: feature.panel,
                storageKey: `civilPanelPosition:${window.location.pathname}`,
                ignoreSelectors: "input, button, textarea, select, a, .civil-list"
            });
            return feature;
        })
        .catch((error) => {
            civilFeaturePromise = null;
            console.error("[instalações civis] Falha ao carregar o módulo:", error);
        });
}
export function updateRestrictedFeatureHelp() {
    const materialsShortcuts = new Set(["l", "t", "k", "7"]);
    helpPanel?.querySelectorAll("li").forEach((item) => {
        const shortcut = item.querySelector("kbd")?.textContent?.trim().toLowerCase();
        if (materialsShortcuts.has(shortcut)) {
            item.hidden = !materialsFeatureAllowed;
        }
    });
}

export function applyViewerProfilePermissions(user) {
    const permissions = getViewerPermissions(user);
    setCollisionFeatureAccess(permissions.canUseCollision);
    setMaterialsFeatureAccess(permissions.canUseMaterials);
    setTransformFeatureAccess(permissions.canTransformModels);
    setExplorerTabsAccess(permissions.explorerTabs);   
    quadroFeatureAllowed = Boolean(permissions.canGenerateQuadro);   // NOVO
    setWifiCoverageFeatureAccess(permissions.canUseCoverage);        // NOVO
    setCivilFeatureAccess(permissions.canUseMaterials);
    // NOVO: substituir modelo. Se o viewer-permissions.js ainda for a versão antiga (sem canReplaceModels),
    // vale a mesma regra da cobertura (admin e colaborador).
    const canReplaceModels = Boolean(permissions.canReplaceModels ?? permissions.canUseCoverage);
    if (modelReplaceAllowed !== canReplaceModels) {
        modelReplaceAllowed = canReplaceModels;
        scheduleExplorerRefresh(0);
    }
    updateRestrictedFeatureHelp();
}
export async function setupRestrictedViewerFeaturesAccessGate() {
    setCollisionFeatureAccess(false);
    setMaterialsFeatureAccess(false);
    setTransformFeatureAccess(false);
    setExplorerTabsAccess(RESTRICTED_EXPLORER_TABS); 
    quadroFeatureAllowed = false;                                     // NOVO
    modelReplaceAllowed = false;                                      // NOVO
    const user = window.__VIEWER_AUTH_USER__ || await fetchViewerUser();
    applyViewerProfilePermissions(user);
}
