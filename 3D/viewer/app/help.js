// Módulo "help" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { helpPanel, helpPanelToggleButton } from "../viewer-authenticated.js";


// A criação manual fica no menu de contexto do objeto, não na barra superior.
// setupAnnotationClickTool();
// setupAnnotationClickCreation();

/**
 * Configura o painel de ajuda e atalhos de teclado.
 */
export function setupHelpPanel() {
    if (!helpPanel || !helpPanelToggleButton || !closeHelpPanelButton) {
        return;
    }

    const togglePanel = (forceState) => {
        const shouldOpen = typeof forceState === "boolean" ? forceState : helpPanel.hidden;
        helpPanel.hidden = !shouldOpen;
        helpPanelToggleButton.classList.toggle("active", shouldOpen);
        helpPanelToggleButton.setAttribute("aria-pressed", shouldOpen ? "true" : "false");
    };

    helpPanelToggleButton.addEventListener("click", () => togglePanel());
    closeHelpPanelButton.addEventListener("click", () => togglePanel(false));
    injectMeasurementShortcutHelp();
}

export function injectMeasurementShortcutHelp() {
    if (!helpPanel) {
        return;
    }

    const generalHelpList = helpPanel.querySelector(".help-section .help-list");
    if (!generalHelpList || generalHelpList.querySelector("[data-measurement-history-shortcuts='true']")) {
        return;
    }

    const undoShortcutItem = document.createElement("li");
    undoShortcutItem.dataset.measurementHistoryShortcuts = "true";
    undoShortcutItem.innerHTML = "<kbd>Ctrl</kbd> + <kbd>Z</kbd> — Desfazer última medição";

    const redoShortcutItem = document.createElement("li");
    redoShortcutItem.dataset.measurementHistoryShortcuts = "true";
    redoShortcutItem.innerHTML = "<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> / <kbd>Ctrl</kbd> + <kbd>Y</kbd> — Refazer medição";
    
    const eletrodutoShortcutItem = document.createElement("li");
    eletrodutoShortcutItem.dataset.measurementHistoryShortcuts = "true";
    eletrodutoShortcutItem.innerHTML = "<kbd>8</kbd> — Exportar relatório de eletrodutos";

    const screenshotShortcutItem = document.createElement("li");
    screenshotShortcutItem.dataset.measurementHistoryShortcuts = "true";
    screenshotShortcutItem.innerHTML = "<kbd>9</kbd> — Baixar print da visualização atual";

    generalHelpList.appendChild(undoShortcutItem);
    generalHelpList.appendChild(redoShortcutItem);
    generalHelpList.appendChild(screenshotShortcutItem);
    generalHelpList.appendChild(eletrodutoShortcutItem);
}
export const closeHelpPanelButton = document.getElementById("closeHelpPanel");
