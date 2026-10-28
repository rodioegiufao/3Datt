// Módulo "snapshots" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { viewer } from "../viewer-authenticated.js";
import { applyCollisionIsolation } from "./collision-legacy.js";
import { activeProjectKey } from "./model-loading.js";
import { requestRenderFrame } from "./performance.js";
import { getCameraPose, restoreCameraPose } from "./scene-objects.js";


export function waitForRender(ms = 180) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toArraySafe(list) {
    if (!list) {
        return [];
    }

    if (Array.isArray(list)) {
        return [...list];
    }

    if (typeof list[Symbol.iterator] === "function") {
        return [...list];
    }

    return [];
}

export function captureSceneRenderState() {
    const scene = viewer?.scene;

    if (!scene) {
        return null;
    }

    return {
        visible: toArraySafe(scene.visibleObjectIds),
        xrayed: toArraySafe(scene.xrayedObjectIds),
        highlighted: toArraySafe(scene.highlightedObjectIds)
    };
}

export function restoreSceneRenderState(state) {
    const scene = viewer?.scene;

    if (!scene || !state) {
        return;
    }

    const applyState = (current, target, setter) => {
        if (!setter) {
            return;
        }

        const currentIds = toArraySafe(current);
        const targetIds = toArraySafe(target);
        const unionIds = [...new Set([...currentIds, ...targetIds])];

        if (unionIds.length) {
            setter(unionIds, false);
        }

        if (targetIds.length) {
            setter(targetIds, true);
        }
    };

    applyState(scene.visibleObjectIds, state.visible, scene.setObjectsVisible?.bind(scene));
    applyState(scene.xrayedObjectIds, state.xrayed, scene.setObjectsXRayed?.bind(scene));
    applyState(scene.highlightedObjectIds, state.highlighted, scene.setObjectsHighlighted?.bind(scene));
}
export function buildScreenshotFilename() {
    const projectSlug = (activeProjectKey || document.title || "modelo-3d")
        .toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "modelo-3d";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    return `print-${projectSlug}-${timestamp}.png`;
}

export function downloadCanvasImage(dataUrl, filename) {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

export function downloadCurrentViewScreenshot() {
    const canvas = document.getElementById("meuCanvas");

    if (!canvas || !canvas.width || !canvas.height) {
        console.warn("Não foi possível gerar o print: canvas 3D indisponível.");
        return false;
    }

    requestRenderFrame();

    try {
        // Mantém a geração síncrona no mesmo gesto do teclado. Em alguns
        // navegadores, downloads iniciados apenas dentro de callbacks assíncronos
        // (requestAnimationFrame/toBlob) podem ser bloqueados e o atalho 9 parece
        // não fazer nada.
        downloadCanvasImage(canvas.toDataURL("image/png"), buildScreenshotFilename());
        return true;
    } catch (error) {
        console.error("Não foi possível gerar o print da visualização atual.", error);
        return false;
    }
}
/**
 * Snapshot LEVE:
 * - Faz downscale para reduzir pixels
 * - Exporta como JPEG com qualidade ajustável
 * - Mantém a imagem grande no PDF (em mm), mas leve (em px)
 */
export function getCanvasSnapshot({
    maxWidthPx = 900,          // ↓ quanto menor, mais leve (700~1200 bom)
    mimeType = "image/jpeg",   // JPEG é muito mais leve que PNG
    quality = 0.55             // 0.35~0.70 (quanto menor, mais leve)
} = {}) {
    const canvas = document.getElementById("meuCanvas");
    if (!canvas) return null;

    const srcCanvas = canvas;
    const srcW = srcCanvas.width;
    const srcH = srcCanvas.height;

    if (!srcW || !srcH) return null;

    // Escala para reduzir resolução
    const scale = Math.min(1, maxWidthPx / srcW);
    const dstW = Math.max(1, Math.round(srcW * scale));
    const dstH = Math.max(1, Math.round(srcH * scale));

    // Canvas temporário reduzido
    const tmp = document.createElement("canvas");
    tmp.width = dstW;
    tmp.height = dstH;

    const ctx = tmp.getContext("2d", { alpha: false });

    // Melhora a aparência ao reduzir
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    ctx.drawImage(srcCanvas, 0, 0, dstW, dstH);

    // Exporta como JPEG comprimido
    return tmp.toDataURL(mimeType, quality);
}

export async function captureSnapshotsForCollisions(collisions) {
    const originalPose = getCameraPose();
    const originalRenderState = captureSceneRenderState();
    const canvas = document.getElementById("meuCanvas");
    const canvasAspect =
        canvas?.width && canvas?.height ? canvas.width / canvas.height : 1.6;

    const snapshots = [];

    for (const { objectId, collidingWith } of collisions) {
        const isolationApplied = applyCollisionIsolation(objectId, collidingWith, { animate: false });

        if (!isolationApplied) {
            snapshots.push({ dataUrl: null, aspect: canvasAspect });
            continue;
        }

        requestRenderFrame();
        await waitForRender(220); // um pouco maior pra garantir render antes do print

        snapshots.push({
            dataUrl: getCanvasSnapshot({
                maxWidthPx: 900,          // ajuste aqui (700 = mais leve, 1200 = mais qualidade)
                mimeType: "image/jpeg",
                quality: 0.55             // ajuste aqui (0.45 = mais leve, 0.65 = melhor)
            }),
            aspect: canvasAspect
        });
    }

    if (originalRenderState) {
        restoreSceneRenderState(originalRenderState);
        requestRenderFrame();
    }

    if (originalPose) {
        restoreCameraPose(originalPose);
        requestRenderFrame();
    }

    return snapshots;
}
