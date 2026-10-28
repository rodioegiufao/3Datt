// Módulo "measurements" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { PointerLens } from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";
import { clearSelection, contextMenu, viewer } from "../viewer-authenticated.js";
import { setSearchStatus } from "./search.js";


// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// 3. Plugins de Medição e Função de Troca (MANTIDO)
// -----------------------------------------------------------------------------

export let angleMeasurementsPlugin = null;
export let angleMeasurementsMouseControl = null;
export let distanceMeasurementsPlugin = null;
export let distanceMeasurementsMouseControl = null;
export let measurementsFeaturePromise = null;

export function ensureMeasurementsInitialized() {
    measurementsFeaturePromise ||= import("../features/measurements.js")
        .then(({ createMeasurementTools }) => {
            const tools = createMeasurementTools({ viewer, PointerLens });
            angleMeasurementsPlugin = tools.angleMeasurementsPlugin;
            angleMeasurementsMouseControl = tools.angleMeasurementsMouseControl;
            distanceMeasurementsPlugin = tools.distanceMeasurementsPlugin;
            distanceMeasurementsMouseControl = tools.distanceMeasurementsMouseControl;
            setupMeasurementEvents(angleMeasurementsPlugin);
            setupMeasurementEvents(distanceMeasurementsPlugin);
            return tools;
        })
        .catch((error) => {
            measurementsFeaturePromise = null;
            console.error("[viewer] Falha ao carregar medições:", error);
            setSearchStatus?.("Não foi possível carregar a ferramenta de medição.", true);
            throw error;
        });
    return measurementsFeaturePromise;
}
export async function setMeasurementMode(mode, clickedButton) {
    if (mode !== "none") {
        await ensureMeasurementsInitialized();
    }
    angleMeasurementsMouseControl?.deactivate();
    distanceMeasurementsMouseControl?.deactivate();
    document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));

    if (mode === 'angle') {
        angleMeasurementsMouseControl?.activate();
    } else if (mode === 'distance') {
        distanceMeasurementsMouseControl?.activate();
    }

    if (clickedButton) {
        clickedButton.classList.add('active');
    }

    angleMeasurementsMouseControl?.reset();
    distanceMeasurementsMouseControl?.reset();

    // Garante que o modo de seleção seja desativado ao iniciar uma medição
    clearSelection(false);
}

export function setupMeasurementEvents(plugin) {
    plugin.on("contextMenu", (e) => {
        const measurement = e.angleMeasurement || e.distanceMeasurement;
        contextMenu.context = { measurement: measurement };
        contextMenu.show(e.event.clientX, e.event.clientY);
        e.event.preventDefault();
    });

    plugin.on("mouseOver", (e) => {
        (e.angleMeasurement || e.distanceMeasurement).setHighlighted(true);
    });

    plugin.on("mouseLeave", (e) => {
        const measurement = e.angleMeasurement || e.distanceMeasurement;
        if (!contextMenu.shown || contextMenu.context.measurement.id !== measurement.id) {
            measurement.setHighlighted(false);
        }
    });
}
