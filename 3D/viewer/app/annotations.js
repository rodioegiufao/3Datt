// Módulo "annotations" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { viewer } from "../viewer-authenticated.js";
import { angleMeasurementsMouseControl, distanceMeasurementsMouseControl } from "./measurements.js";
import { requestRenderFrame } from "./performance.js";
import { setSearchStatus } from "./search.js";


// -----------------------------------------------------------------------------
// 1.1 Anotações fixas
// -----------------------------------------------------------------------------

export let userAnnotationsController = null;
export let annotationsFeaturePromise = null;
export function ensureAnnotationsFeature() {
    annotationsFeaturePromise ||= import("../features/annotations.js")
        .then(({ createAnnotationsController }) => {
            userAnnotationsController ||= createAnnotationsController({ viewer, requestRenderFrame });
            window.userAnnotationsController = userAnnotationsController;
            return userAnnotationsController;
        })
        .catch((error) => {
            annotationsFeaturePromise = null;
            console.error("[viewer] Falha ao carregar anotações:", error);
            setSearchStatus?.("Não foi possível carregar a ferramenta de anotações.", true);
            throw error;
        });
    return annotationsFeaturePromise;
}
export let annotationClickModeEnabled = false;
export let annotationClickModeButton = null;

export function setAnnotationClickMode(enabled) {
    annotationClickModeEnabled = Boolean(enabled);
    annotationClickModeButton?.classList.toggle("active", annotationClickModeEnabled);
    annotationClickModeButton?.setAttribute("aria-pressed", annotationClickModeEnabled ? "true" : "false");
    viewer.scene.canvas.canvas.classList.toggle("annotation-click-mode", annotationClickModeEnabled);

    if (annotationClickModeEnabled) {
        angleMeasurementsMouseControl?.deactivate?.();
        distanceMeasurementsMouseControl?.deactivate?.();
        document.querySelectorAll('.tool-button').forEach((button) => {
            if (button !== annotationClickModeButton) {
                button.classList.remove('active');
            }
        });
    }
}

export function setupAnnotationClickTool() {
    const toolbar = document.getElementById("toolbar");
    if (!toolbar || document.getElementById("btnAnnotationClick")) {
        annotationClickModeButton = document.getElementById("btnAnnotationClick");
        return;
    }

    annotationClickModeButton = document.createElement("button");
    annotationClickModeButton.id = "btnAnnotationClick";
    annotationClickModeButton.className = "tool-button";
    annotationClickModeButton.type = "button";
    annotationClickModeButton.title = "Adicionar anotação clicando no modelo";
    annotationClickModeButton.setAttribute("aria-pressed", "false");
    annotationClickModeButton.innerHTML = '<span style="font-size: 1.2em;">📝</span> Anotação';
    annotationClickModeButton.addEventListener("click", () => {
        setAnnotationClickMode(!annotationClickModeEnabled);
    });

    const helpButton = document.getElementById("btnHelp");
    toolbar.insertBefore(annotationClickModeButton, helpButton || null);
}

export function setupAnnotationClickCreation() {
    viewer.scene.input.on("mouseclicked", async (coords) => {
        if (!annotationClickModeEnabled) {
            return;
        }

        const pickResult = viewer.scene.pick({
            canvasPos: coords,
            pickSurface: true
        });

        if (!pickResult) {
            window.alert("Clique em uma superfície do modelo para criar a anotação.");
            return;
        }

        const text = window.prompt("Digite o texto da anotação:");
        if (!text || !text.trim()) {
            return;
        }

        const controller = await ensureAnnotationsFeature();
        const record = controller.addAnnotationFromPickResult(pickResult, text);
        if (record) {
            setAnnotationClickMode(false);
        }
    });
}
