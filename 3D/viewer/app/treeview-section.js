// Módulo "treeview-section" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { SectionPlanesPlugin, TreeViewPlugin } from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";
import { clearSelection, toggleTreeViewSelectionButton, treeViewContainer, treeViewContent, viewer } from "../viewer-authenticated.js";
import { getTreeViewCheckboxes, invalidateExplorerCaches, resetModelVisibility, scheduleExplorerRefresh, setupExplorerPanel, toggleAllExplorerActiveTabVisibility, updateTreeViewSelectionButtonState } from "./explorer.js";
import { isolateStorey, resolveMetaObject } from "./ifc-meta.js";
import { getAllObjectIds } from "./scene-objects.js";


export let treeView;
export let modelIsolateController;
export let sectionPlanesPlugin;
export let horizontalSectionPlane;
export let sectionPlaneEnabled = false;

// -----------------------------------------------------------------------------
// 6. TreeViewPlugin e Lógica de Isolamento (MANTIDO)
// -----------------------------------------------------------------------------

export function setupModelIsolateController() {

    if (!treeViewContainer || treeView) {
        return;
    }

    treeView = new TreeViewPlugin(viewer, {
        containerElement: treeViewContent ?? treeViewContainer,
        hierarchy: "containment",
        autoExpandDepth: 0
    });

    setupTreeViewFilter();
    setupTreeViewSelectionControls();
    scheduleExplorerRefresh(120);

    modelIsolateController = viewer.scene;

    // Ouve o evento de "seleção" no TreeView
    treeView.on("nodeClicked", (event) => {
        const entityId = event.entityId;
        const metaObject = resolveMetaObject(entityId);

        if (metaObject?.type === "IfcBuildingStorey" && isolateStorey(metaObject.id)) {
            return;
        }
        // Verifica se há alguma entidade associada ao nó
        if (entityId && viewer.scene.getObjectsInSubtree(entityId).length > 0) {

            const subtreeIds = viewer.scene.getObjectsInSubtree(entityId);

            // Mantém o comportamento existente para nós que não são pavimentos.
            modelIsolateController.setObjectsXRayed(getAllObjectIds(), true);
            modelIsolateController.setObjectsXRayed(subtreeIds, false);
            modelIsolateController.isolate(subtreeIds);

            viewer.cameraFlight.flyTo({
                aabb: viewer.scene.getAABB(entityId),
                duration: 0.5
            });

            clearSelection();

        } else {
            // Se o usuário clicar em um nó que não contém objetos (como o nó raiz do projeto ou um item folha)
            // Apenas reseta a visibilidade.
            resetModelVisibility();
        }
    });
}

export function setupTreeViewFilter() {
    const container = treeViewContent ?? treeViewContainer;

    if (!container) {
        return;
    }

    const getRootTitle = (item) => {
        let current = item;
        let parent = current.parentElement?.closest(".xeokit-tree-view-item");

        while (parent) {
            current = parent;
            parent = current.parentElement?.closest(".xeokit-tree-view-item");
        }

        return current
            ?.querySelector(".xeokit-tree-view-item-title")
            ?.textContent?.trim();
    };

    const applyFilter = () => {
        const items = Array.from(container.querySelectorAll(".xeokit-tree-view-item"));
        if (items.length === 0) {
            return;
        }
        const buildingItems = items.filter((item) => {
            const titleEl = item.querySelector(".xeokit-tree-view-item-title");
            return titleEl?.textContent?.trim() === "IfcBuilding";
        });

        if (buildingItems.length === 0) {
            return;
        }

        const allowedItems = new Set();

        const allowWithAncestorsAndDescendants = (item) => {
            let current = item;
            while (current && current.classList?.contains("xeokit-tree-view-item")) {
                allowedItems.add(current);
                current = current.parentElement?.closest(".xeokit-tree-view-item");
            }

            item.querySelectorAll(".xeokit-tree-view-item").forEach((child) => {
                allowedItems.add(child);
            });
        };

        buildingItems.forEach((item) => {
            allowWithAncestorsAndDescendants(item);

            const buildingTitleEl = item.querySelector(".xeokit-tree-view-item-title");
            const rootTitle = getRootTitle(item);

            if (buildingTitleEl && rootTitle) {
                buildingTitleEl.textContent = rootTitle;
            }
        });

        items.forEach((item) => {
            const shouldShow = allowedItems.has(item);
            const titleText = item
                .querySelector(".xeokit-tree-view-item-title")
                ?.textContent?.trim();
            const rootTitle = getRootTitle(item);

            const hideIFCARQStorey =
                rootTitle === "IFC_ARQ" && titleText === "IfcBuildingStorey";

            item.style.display = shouldShow && !hideIFCARQStorey ? "" : "none";
        });
    };
    const observer = new MutationObserver(() => {
        invalidateExplorerCaches();
        applyFilter();
        scheduleExplorerRefresh(120);
    });
    observer.observe(container, { childList: true, subtree: true });

    applyFilter();

    container.dataset.treeFilterAttached = "true";
}

export function setupTreeViewSelectionControls() {
    if (!toggleTreeViewSelectionButton) {
        return;
    }

    const container = treeViewContent ?? treeViewContainer;

    if (!container) {
        return;
    }

    let architectureDefaultApplied = false;

    const uncheckArchitectureByDefault = () => {
        if (architectureDefaultApplied) {
            return;
        }

        const architectureCheckbox = getTreeViewCheckboxes().find((checkbox) => {
            const item = checkbox.closest(".xeokit-tree-view-item");
            const title = item
                ?.querySelector(".xeokit-tree-view-item-title")
                ?.textContent
                ?.trim();

            return title === "IFC_ARQ";
        });

        if (!architectureCheckbox) {
            return;
        }

        if (architectureCheckbox.checked) {
            architectureCheckbox.click();
        }

        architectureDefaultApplied = true;
    };

    const updateButtonLabel = () => {
        updateTreeViewSelectionButtonState();
    };

    const toggleAllSelections = () => {
         toggleAllExplorerActiveTabVisibility();
    };

    toggleTreeViewSelectionButton.addEventListener("click", toggleAllSelections);

    container.addEventListener("change", (event) => {
        if (event.target?.matches("input[type=\"checkbox\"]")) {
            updateButtonLabel();
        }
    });

    uncheckArchitectureByDefault();
    updateButtonLabel();

    const selectionObserver = new MutationObserver(() => {
        uncheckArchitectureByDefault();
        updateButtonLabel();
    });
    selectionObserver.observe(container, { childList: true, subtree: true });
}

export function getTreeViewDisplayMode() {
    return treeViewContainer?.classList.contains("explorer-enabled") ? "flex" : "block";
}

export function isTreeViewVisible() {
    if (!treeViewContainer) {
        return false;
    }

    return window.getComputedStyle(treeViewContainer).display !== "none";
}

/**
 * Alterna a visibilidade do contêiner do TreeView sem alterar o estado atual de visibilidade.
 */
export function toggleTreeView(button) {
    if (!treeViewContainer) {
        return;
    }

    if (isTreeViewVisible()) {
        treeViewContainer.style.display = 'none';
        button?.classList.remove('active');
    } else {
        setupExplorerPanel();
        setupModelIsolateController();
        treeViewContainer.style.display = getTreeViewDisplayMode();
        button?.classList.add('active');
    }
}

// -----------------------------------------------------------------------------
// 7. Plano de Corte (Section Plane) - VERSÃO ESTÁVEL (MANTIDO)
// -----------------------------------------------------------------------------
// ... setupSectionPlane (função que não é mais usada, mas mantida por segurança) ...

export function toggleSectionPlane(button) {
    const scene = viewer.scene;

    if (!sectionPlanesPlugin) {
        sectionPlanesPlugin = new SectionPlanesPlugin(viewer);
    }

    // --- DESATIVAR ---
    if (sectionPlaneEnabled) {
        sectionPlaneEnabled = false;

        if (horizontalSectionPlane) {
            horizontalSectionPlane.active = false;

            if (horizontalSectionPlane.control) {
                try {
                    viewer.input.removeCanvasElement(horizontalSectionPlane.control.canvas);
                } catch (e) {}

                horizontalSectionPlane.control.destroy();
                horizontalSectionPlane.control = null;
            }

            // Remove o plano para que o gizmo e a geometria desapareçam
            horizontalSectionPlane.destroy();
            horizontalSectionPlane = null;
        }

        scene.sectionPlanes.active = false;

        // alguns builds deixam o gizmo em viewer.input._activeCanvasElements
        if (viewer.input && viewer.input._activeCanvasElements) {
            viewer.input._activeCanvasElements.clear?.();
        }

        viewer.scene.render(); // força re-render
        button.classList.remove("active");
        viewer.cameraFlight.flyTo(scene);
        return;
    }

    // --- ATIVAR ---
    const aabb = scene.getAABB();
    const modelCenterY = (aabb[1] + aabb[4]) / 2;

    if (!horizontalSectionPlane) {
        horizontalSectionPlane = sectionPlanesPlugin.createSectionPlane({
            id: "horizontalPlane",
            pos: [0, modelCenterY, 0],
            dir: [0, -1, 0],
            active: true
        });
    } else {
        horizontalSectionPlane.pos = [0, modelCenterY, 0];
        horizontalSectionPlane.dir = [0, -1, 0];
        horizontalSectionPlane.active = true;
    }

    scene.sectionPlanes.active = true;
    sectionPlaneEnabled = true;

    if (horizontalSectionPlane.control) {
        try {
            viewer.input.removeCanvasElement(horizontalSectionPlane.control.canvas);
        } catch (e) {}

        horizontalSectionPlane.control.destroy();
        horizontalSectionPlane.control = null;
    }

    horizontalSectionPlane.control = sectionPlanesPlugin.showControl(horizontalSectionPlane.id);

    button.classList.add("active");

    viewer.cameraFlight.flyTo({
        aabb: scene.aabb,
        duration: 0.5
    });
}
