// Módulo "performance" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { defaultRenderProfile, fastNavPlugin, loadedModels, performanceModeToggleButton, viewer, viewerCompatibility } from "../viewer-authenticated.js";

export const PERFORMANCE_MODE_STORAGE_KEY = "viewer_performance_mode_enabled";
export let performanceModeEnabled = false;
export const navCubeCanvasElement = document.getElementById("myNavCubeCanvas");

export function requestRenderFrame() {
    if (viewer.scene.requestRender) {
        viewer.scene.requestRender();
    } else if (viewer.scene.setDirty) {
        viewer.scene.setDirty();
    }
}

// -----------------------------------------------------------------------------
// Celular: navegação por toque, vista inicial e modo leve automático
// -----------------------------------------------------------------------------

// Um dedo gira em volta do ponto tocado; dois dedos movem e pinçam para zoom
export function setupTouchNavigation() {
    if (!viewerCompatibility.isTouchDevice) {
        return;
    }
    const control = viewer.cameraControl;
    control.followPointer = true;   // zoom vai na direção dos dedos
    control.smartPivot = true;      // gira em torno do que foi tocado, não do centro do prédio
    control.doublePickFlyTo = false; // toque duplo seleciona a peça sem "voar" a câmera
    if ("touchDollyRate" in control) control.touchDollyRate = 0.15;
    if ("touchPanRate" in control) control.touchPanRate = 1.0;
    if ("dragRotationRate" in control) control.dragRotationRate = 300;
    if ("rotationInertia" in control) control.rotationInertia = 0.3;
}

export let homeCamera = null;

export function saveHomeCamera() {
    homeCamera = {
        eye: Array.from(viewer.camera.eye),
        look: Array.from(viewer.camera.look),
        up: Array.from(viewer.camera.up)
    };
}

export function goToHomeView() {
    if (homeCamera) {
        viewer.cameraFlight.flyTo({ ...homeCamera, duration: 0.7 });
    } else if (viewer.scene.objectIds.length) {
        viewer.cameraFlight.flyTo({ aabb: viewer.scene.getAABB(viewer.scene.visibleObjectIds), duration: 0.7 });
    }
    requestRenderFrame();
}

export function setupHomeViewButton() {
    if (document.getElementById("btnHomeView")) {
        return;
    }
    const button = document.createElement("button");
    button.id = "btnHomeView";
    button.type = "button";
    button.className = "home-view-button";
    button.setAttribute("aria-label", "Voltar à vista inicial");
    button.dataset.tip = "Voltar à vista inicial (H)";
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/></svg><span>Vista inicial</span>';
    button.addEventListener("click", goToHomeView);
    document.body.appendChild(button);
}

// Mede a fluidez enquanto a pessoa navega; se ficar travando, liga o modo leve sozinho
export function startAutoPerformanceMonitor() {
    if (performanceModeEnabled || getStoredPerformanceModePreference() !== null) {
        return;
    }
    const SAMPLE_SIZE = 45;          // quadros por medição
    const SLOW_FRAME_MS = 55;        // mediana acima disso = menos de ~18 quadros/s
    const GOOD_ROUNDS_TO_STOP = 4;   // depois de 4 medições boas, para de monitorar
    let samples = [];
    let lastFrame = 0;
    let moving = false;
    let moveTimer = null;
    let goodRounds = 0;
    let stopped = false;

    const cameraSub = viewer.camera.on("matrix", () => {
        moving = true;
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => {
            moving = false;
            lastFrame = 0;
        }, 250);
    });

    const stop = () => {
        stopped = true;
        clearTimeout(moveTimer);
        viewer.camera.off(cameraSub);
    };

    const loop = (time) => {
        if (stopped) return;
        if (performanceModeEnabled || getStoredPerformanceModePreference() !== null) {
            stop();
            return;
        }
        if (moving && !document.hidden) {
            if (lastFrame) samples.push(time - lastFrame);
            lastFrame = time;
            if (samples.length >= SAMPLE_SIZE) {
                const sorted = samples.slice().sort((a, b) => a - b);
                const median = sorted[Math.floor(sorted.length / 2)];
                samples = [];
                if (median > SLOW_FRAME_MS) {
                    stop();
                    applyPerformanceMode(true, { persist: false });
                    showPerformanceToast();
                    return;
                }
                goodRounds++;
                if (goodRounds >= GOOD_ROUNDS_TO_STOP) {
                    stop();
                    return;
                }
            }
        } else {
            lastFrame = 0;
        }
        requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
}

export function showPerformanceToast() {
    document.getElementById("performanceToast")?.remove();
    const toast = document.createElement("div");
    toast.id = "performanceToast";
    toast.className = "performance-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = '<span>Modo leve ativado para a navegação ficar mais fluida.</span><button type="button">Desfazer</button>';
    toast.querySelector("button").addEventListener("click", () => {
        applyPerformanceMode(false); // vira escolha do usuário: não liga de novo nesta aba
        toast.remove();
    });
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 7000);
}

// true/false = escolha explícita do usuário nesta aba; null = ainda não escolheu (modo automático)
export function getStoredPerformanceModePreference() {
    const value = sessionStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY);
    return value === "true" ? true : value === "false" ? false : null;
}

export function syncNavCubeVisibility() {
    if (!navCubeCanvasElement) {
        return;
    }

    navCubeCanvasElement.style.display = viewerCompatibility.enableNavCube && !performanceModeEnabled ? "" : "none";
}

export function updatePerformanceModeButton() {
    if (!performanceModeToggleButton) {
        return;
    }

    performanceModeToggleButton.classList.toggle("active", performanceModeEnabled);
    performanceModeToggleButton.setAttribute("aria-pressed", performanceModeEnabled ? "true" : "false");
    performanceModeToggleButton.title = performanceModeEnabled
        ? "Desativar modo leve e restaurar a renderização completa"
        : "Ativar modo leve para reduzir a renderização 3D";

    const label = performanceModeToggleButton.querySelector(".tool-label");
    if (label) {
        label.textContent = performanceModeEnabled ? "Modo leve · ON" : "Modo leve";
    }
}

export function applyModelRenderProfile(model) {
    if (!model) {
        return;
    }

    const edgesEnabled = performanceModeEnabled ? false : defaultRenderProfile.edgesEnabled;
    const saoEnabled = performanceModeEnabled ? false : defaultRenderProfile.saoEnabled;

    const setBooleanFlag = (target, key, value) => {
        if (!target || !(key in target)) {
            return;
        }

        let current = target;

        while (current) {
            const descriptor = Object.getOwnPropertyDescriptor(current, key);

            if (descriptor) {
                if (typeof descriptor.set === "function") {
                    descriptor.set.call(target, value);
                    return;
                }

                if (descriptor.writable) {
                    target[key] = value;
                }

                return;
            }

            current = Object.getPrototypeOf(current);
        }

        target[key] = value;
    };

    setBooleanFlag(model, "edges", edgesEnabled);
    setBooleanFlag(model, "edgesEnabled", edgesEnabled);
    setBooleanFlag(model, "saoEnabled", saoEnabled);
    setBooleanFlag(model, "sao", saoEnabled);
}

export function applyPerformanceMode(enabled, { persist = true } = {}) {
    performanceModeEnabled = Boolean(enabled);

    if (persist) {
        sessionStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, performanceModeEnabled ? "true" : "false");
    }

    if (viewer.scene?.sao && "enabled" in viewer.scene.sao) {
        viewer.scene.sao.enabled = performanceModeEnabled ? false : defaultRenderProfile.saoEnabled;
    }

    fastNavPlugin.scaleCanvasResolution = true;
    fastNavPlugin.defaultScaleCanvasResolutionFactor = performanceModeEnabled ? 0.8 : 1;
    fastNavPlugin.scaleCanvasResolutionFactor = performanceModeEnabled ? 0.55 : 0.6;
    fastNavPlugin.hideEdges = performanceModeEnabled;
    fastNavPlugin.hideSAO = performanceModeEnabled;
    fastNavPlugin.hideColorTexture = performanceModeEnabled;
    fastNavPlugin.hidePBR = performanceModeEnabled;

    loadedModels.forEach((model) => {
        applyModelRenderProfile(model);
    });

    syncNavCubeVisibility();
    updatePerformanceModeButton();
    requestRenderFrame();
}

export function togglePerformanceMode(forceState) {
    const nextState = typeof forceState === "boolean" ? forceState : !performanceModeEnabled;
    applyPerformanceMode(nextState);
}
