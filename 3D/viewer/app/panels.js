// Módulo "panels" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { budgetPanel, budgetPanelToggleButton, collisionPanel, collisionPanelToggleButton, helpPanel, helpPanelToggleButton, materialsPanel, materialsPanelToggleButton, searchBar, transformPanel, transformPanelToggleButton, treeViewContainer } from "../viewer-authenticated.js";
import { clearCollisionSelection } from "./collision-legacy.js";
import { loadAssociationDefinitionsFromExcel } from "./excel.js";
import { resetMaterialsIdsPanel } from "./materials-panel.js";
import { closeSearchBar } from "./search.js";
import { isTreeViewVisible } from "./treeview-section.js";
import { webBudgetPanel } from "./web-budget.js";

export let webBudgetAssociationsPromise = null;
export const shareUploadPanel = document.getElementById("shareUploadPanel");

export function hidePanelElement(panelElement, toggleButton) {
    if (!panelElement) {
        return;
    }

    if (typeof panelElement.hidden === "boolean") {
        panelElement.hidden = true;
    }

    toggleButton?.classList.remove("active");
    toggleButton?.setAttribute("aria-pressed", "false");
}

export function hideHelpPanel() {
    hidePanelElement(helpPanel, helpPanelToggleButton);
}

export function hideTransformPanel() {
    hidePanelElement(transformPanel, transformPanelToggleButton);
}

export function hideCollisionPanel() {
    hidePanelElement(collisionPanel, collisionPanelToggleButton);
    clearCollisionSelection();
}

export function hideMaterialsPanel() {
    hidePanelElement(materialsPanel, materialsPanelToggleButton);
    resetMaterialsIdsPanel();
}

export function hideWebBudgetPanel() {
    if (!webBudgetPanel) {
        return;
    }

    webBudgetPanel.hidden = true;
}

export function getWebBudgetMinimizedStorageKey() {
    return `webBudgetPanelMinimized:${window.location.pathname}`;
}

export function setWebBudgetMinimizedState(minimized) {
    if (!webBudgetPanel) {
        return;
    }

    webBudgetPanel.classList.toggle("is-minimized", minimized);
    const minimizeButton = webBudgetPanel.querySelector("#toggleWebBudgetPanelMinimize");
    minimizeButton?.setAttribute("aria-expanded", minimized ? "false" : "true");
    minimizeButton?.setAttribute("aria-label", minimized ? "Expandir orçamento web" : "Minimizar orçamento web");
    if (minimizeButton) {
        minimizeButton.textContent = minimized ? "▢" : "—";
    }
    window.localStorage?.setItem(getWebBudgetMinimizedStorageKey(), minimized ? "1" : "0");
}

export async function ensureWebBudgetAssociationsLoaded() {
    if (!webBudgetAssociationsPromise) {
        webBudgetAssociationsPromise = loadAssociationDefinitionsFromExcel({ excelPath: "./base_de_dados.xlsx" })
            .catch((error) => {
                webBudgetAssociationsPromise = null;
                throw error;
            });
    }

    return webBudgetAssociationsPromise;
}
export function hideBudgetPanel() {
    hidePanelElement(budgetPanel, budgetPanelToggleButton);
}

export function hideTreeViewPanel() {
    if (!isTreeViewVisible()) {
        return;
    }

    treeViewContainer.style.display = "none";
}

export function closePanelsOnEscape() {
    hideHelpPanel();
    hideTransformPanel();
    hideCollisionPanel();
    hideMaterialsPanel();
    hideWebBudgetPanel();
    hideBudgetPanel();
    hideTreeViewPanel();
    closeSearchBar();
}

export function setupDraggablePanel({
    panel,
    storageKey,
    ignoreSelectors = "",
    handleSelector = ""
}) {
    if (!panel) {
        return;
    }

    panel.classList.add("draggable-panel");

    const storedPosition = window.localStorage?.getItem(storageKey);
    if (storedPosition) {
        try {
            const { left, top } = JSON.parse(storedPosition);
            if (Number.isFinite(left) && Number.isFinite(top)) {
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
                panel.style.right = "auto";
                panel.style.bottom = "auto";
            }
        } catch (error) {
            console.warn(`Não foi possível restaurar a posição de ${panel.id}.`, error);
        }
    }

    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;
    let dragging = false;

    const handlePointerMove = (event) => {
        if (!dragging) {
            return;
        }

        const deltaX = event.clientX - startX;
        const deltaY = event.clientY - startY;
        const rect = panel.getBoundingClientRect();
        const maxLeft = window.innerWidth - rect.width - 8;
        const maxTop = window.innerHeight - rect.height - 8;

        const nextLeft = clamp(startLeft + deltaX, 8, Math.max(8, maxLeft));
        const nextTop = clamp(startTop + deltaY, 8, Math.max(8, maxTop));

        panel.style.left = `${nextLeft}px`;
        panel.style.top = `${nextTop}px`;
        panel.style.right = "auto";
        panel.style.bottom = "auto";
    };

    const stopDrag = () => {
        if (!dragging) {
            return;
        }

        dragging = false;
        panel.classList.remove("is-dragging");
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopDrag);
        window.removeEventListener("pointercancel", stopDrag);

        const rect = panel.getBoundingClientRect();
        window.localStorage?.setItem(
            storageKey,
            JSON.stringify({ left: rect.left, top: rect.top })
        );
    };

    panel.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) {
            return;
        }

        if (handleSelector && !event.target.closest(handleSelector)) {
            return;
        }

        if (ignoreSelectors && event.target.closest(ignoreSelectors)) {
            return;
        }

        event.preventDefault();
        const rect = panel.getBoundingClientRect();
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        startLeft = rect.left;
        startTop = rect.top;

        panel.classList.add("is-dragging");
        panel.setPointerCapture?.(event.pointerId);
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", stopDrag);
        window.addEventListener("pointercancel", stopDrag);
    });
}

export function setupDraggablePanels() {
    const pathname = window.location.pathname;

    setupDraggablePanel({
        panel: searchBar,
        storageKey: `searchBarPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select"
    });

    setupDraggablePanel({
        panel: treeViewContainer,
        storageKey: `treeViewPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select, a, .xeokit-tree-view-item, .xeokit-tree-view-item-toggle, .xeokit-tree-view-item-title",
        handleSelector: ".tree-view-header"
    });

    setupDraggablePanel({
        panel: helpPanel,
        storageKey: `helpPanelPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select, a"
    });

    setupDraggablePanel({
        panel: transformPanel,
        storageKey: `transformPanelPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select, a"
    });

    setupDraggablePanel({
        panel: collisionPanel,
        storageKey: `collisionPanelPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select, a"
    });

    setupDraggablePanel({
        panel: materialsPanel,
        storageKey: `materialsPanelPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select, a, .materials-results, .materials-results *, .materials-ids-panel, .materials-ids-panel *"
    });
    setupDraggablePanel({
        panel: budgetPanel,
        storageKey: `budgetPanelPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select, a, iframe"
    });

    setupDraggablePanel({
        panel: shareUploadPanel,
        storageKey: `shareUploadPanelPosition:${pathname}`,
        ignoreSelectors: "input, button, textarea, select, a",
        handleSelector: ".share-upload-panel-header"
    });
}
