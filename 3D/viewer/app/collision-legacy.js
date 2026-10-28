// Módulo "collision-legacy" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { collisionResultsList, collisionSummary, jsPDF, viewer } from "../viewer-authenticated.js";
import { collisionFeatureAllowed } from "./access.js";
import { buildIfcPropertiesLines, getActiveObjectIdSet } from "./materials.js";
import { requestRenderFrame } from "./performance.js";
import { getAllObjectIds, getModelObjectIds, getObjectMetaModelId, intersectsAABB, mergeAABBs } from "./scene-objects.js";
import { captureSnapshotsForCollisions } from "./snapshots.js";
import { modelIsolateController } from "./treeview-section.js";
 // NOVO: Guarda a entidade selecionada pelo duplo clique
export let lastCollisionResults = [];
export let lastCollisionModelId = null;
export let activeCollisionSelection = null;
export const collisionRadiusInput = document.getElementById("collisionRadius");
export const downloadCollisionPdfButton = document.getElementById("downloadCollisionPdf");

export function parseNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function getCollisionRadiusMeters() {
    const radiusMm = parseNumber(collisionRadiusInput?.value, 0);
    return Math.max(0, radiusMm) / 1000;
}

export function normalizeCollisionRadiusInput() {
    if (!collisionRadiusInput) {
        return 0;
    }

    const radiusMm = Math.max(0, parseNumber(collisionRadiusInput.value, 0));
    collisionRadiusInput.value = `${radiusMm}`;
    return radiusMm;
}

export function buildCollisionSummary(collisionsCount, overlapTolerance) {
    const toleranceMm = Math.round(Math.max(0, overlapTolerance) * 1000);

    if (toleranceMm > 0) {
        return `${collisionsCount} objeto(s) com colisão (raio mínimo ${toleranceMm} mm).`;
    }

    return `${collisionsCount} objeto(s) com colisão.`;
}

export function applyCollisionIsolation(objectAId, collidingIds, { animate = true } = {}) {
    if (!modelIsolateController) {
        return false;
    }

    const idsToFocus = [objectAId, ...collidingIds];
    const allIds = getAllObjectIds();
    const otherIds = allIds.filter((id) => !idsToFocus.includes(id));
    // Limpa estados anteriores e oculta tudo para isolar apenas o grupo em colisão
    modelIsolateController.setObjectsVisible(allIds, false);
    modelIsolateController.setObjectsXRayed(allIds, false);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    // Mostra apenas os elementos em conflito e remove o X-ray deles
    modelIsolateController.setObjectsVisible(idsToFocus, true);
    modelIsolateController.setObjectsXRayed(idsToFocus, false);
    viewer.scene.setObjectsHighlighted(idsToFocus, true);

    if (otherIds.length) {
        modelIsolateController.setObjectsHighlighted(otherIds, false);
    }

    const combinedAABB = mergeAABBs(idsToFocus.map((id) => viewer.scene.getAABB(id)));

    if (combinedAABB) {
        if (animate) {
            viewer.cameraFlight.flyTo({ aabb: combinedAABB, duration: 0.6 });
        } else {
            viewer.cameraFlight.jumpTo({ aabb: combinedAABB });
        }
    }

    requestRenderFrame();

    return Boolean(combinedAABB);
}

export function isolateCollisionGroup(objectAId, collidingIds) {
    applyCollisionIsolation(objectAId, collidingIds, { animate: true });
}

export function updateCollisionDownloadButton() {
    if (!downloadCollisionPdfButton) {
        return;
    }

    const hasCollisions = lastCollisionResults.length > 0;
    downloadCollisionPdfButton.disabled = !hasCollisions;
    downloadCollisionPdfButton.title = hasCollisions
        ? "Baixar relatório em PDF"
        : "Nenhuma colisão encontrada para exportar";
}

export function setCollisionState(collisions, modelId) {
    lastCollisionResults = collisions;
    lastCollisionModelId = collisions.length ? modelId : null;
    updateCollisionDownloadButton();
}

export function updateCollisionActiveItem() {
    if (!collisionResultsList) {
        return;
    }

    Array.from(collisionResultsList.children).forEach((item) => {
        if (!(item instanceof HTMLElement)) {
            return;
        }

        const itemId = item.dataset.collisionId;
        item.classList.toggle(
            "is-active",
            Boolean(activeCollisionSelection && itemId === activeCollisionSelection.objectId)
        );
    });
}

export function setActiveCollisionSelection(objectId, collidingWith) {
    activeCollisionSelection = { objectId, collidingWith };
    updateCollisionActiveItem();
}

export function clearCollisionSelection() {
    activeCollisionSelection = null;
    updateCollisionActiveItem();
}

export function getCollisionPosition(objectId) {
    const aabb = viewer.scene.getAABB(objectId);

    if (!aabb) {
        return null;
    }

    const center = [
        (aabb[0] + aabb[3]) / 2,
        (aabb[1] + aabb[4]) / 2,
        (aabb[2] + aabb[5]) / 2
    ];

    return center.map((value) => Number.isFinite(value) ? Number(value.toFixed(3)) : 0);
}

export async function downloadCollisionsAsPdf() {
    if (!collisionFeatureAllowed || !lastCollisionResults.length) {
        return;
    }

    // ✅ compressão do PDF
    const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });

    const snapshots = await captureSnapshotsForCollisions(lastCollisionResults);

    doc.setFontSize(16);
    doc.text("Relatório de colisões", 14, 20);

    doc.setFontSize(12);
    doc.text(`Modelo analisado: ${lastCollisionModelId ?? "-"}`, 14, 30);
    doc.text(`Total de colisões: ${lastCollisionResults.length}`, 14, 38);

    let cursorY = 50;

    const leftMargin = 14;
    const topMargin = 20;
    const maxWidth = 180;
    const lineHeight = 5;
    const spacingAfterItem = 6;

    // Altura útil aproximada no A4 (em mm)
    const pageHeightLimit = 280;

    // ✅ imagem MAIOR no PDF (mm) sem aumentar o peso (px)
    const defaultImageWidth = 140; // 120~160 fica ótimo

    lastCollisionResults.forEach(({ objectId, collidingWith }, index) => {
        const titleText = `${index + 1}. Objeto ${objectId}`;
        const description = `Colide com: ${collidingWith.join(", ")}`;
        const snapshot = snapshots[index];

        const imageAspect = snapshot?.aspect || 1.6;
        const imageHeight = snapshot?.dataUrl ? defaultImageWidth / imageAspect : 0;

        const descriptionLines = doc.splitTextToSize(description, maxWidth);
        const propertyLines = buildIfcPropertiesLines(doc, objectId, maxWidth);

        const itemHeight =
            lineHeight +
            descriptionLines.length * lineHeight +
            propertyLines.length * lineHeight +
            (snapshot?.dataUrl && propertyLines.length ? spacingAfterItem : 0) +
            (snapshot?.dataUrl ? imageHeight : 0) +
            spacingAfterItem;

        // Quebra de página
        if (cursorY + itemHeight > pageHeightLimit) {
            doc.addPage();
            cursorY = topMargin;

            // opcional: repetir cabeçalho (se quiser, descomente)
            // doc.setFontSize(10);
            // doc.text(`Relatório de colisões - Modelo: ${lastCollisionModelId ?? "-"}`, leftMargin, 12);
        }
        doc.setFontSize(12);
        doc.text(titleText, leftMargin, cursorY);
        cursorY += lineHeight;

        doc.setFontSize(10);
        doc.text(descriptionLines, leftMargin, cursorY, { maxWidth });
        cursorY += descriptionLines.length * lineHeight;

        if (propertyLines.length) {
            doc.text(propertyLines, leftMargin, cursorY, { maxWidth });
            cursorY += propertyLines.length * lineHeight;

            if (snapshot?.dataUrl) {
                cursorY += spacingAfterItem;
            }
        }

        if (snapshot?.dataUrl) {
            // ✅ JPEG + FAST (mais leve e rápido)
            doc.addImage(
                snapshot.dataUrl,
                "JPEG",
                leftMargin,
                cursorY,
                defaultImageWidth,
                imageHeight,
                undefined,
                "FAST"
            );
            cursorY += imageHeight;
        }

        cursorY += spacingAfterItem;
    });

    // Bloco final com resumo estruturado das colisões
    const structuredSummary = lastCollisionResults.map(({ objectId, collidingWith }, index) => {
        const position = getCollisionPosition(objectId);
        const positionText = position ? `[${position.join(", ")}]` : "[]";
        const collisionsText = collidingWith.join(", ");

        return `{ id: "P${index + 1}", position: ${positionText}, code: "${objectId}", collision: "${collisionsText}" },`;
    });

    doc.addPage();
    doc.setFontSize(12);
    doc.text("Resumo de colisões (formato estruturado)", leftMargin, topMargin);
    doc.setFontSize(10);
    doc.text(structuredSummary, leftMargin, topMargin + lineHeight, { maxWidth });

    doc.save("colisoes.pdf");
}

export function renderCollisionResults(collisions) {
    collisionResultsList.innerHTML = "";
    clearCollisionSelection();

    if (!collisions.length) {
        const emptyItem = document.createElement("li");
        emptyItem.textContent = "Nenhuma colisão encontrada.";
        emptyItem.classList.add("collision-summary");
        collisionResultsList.appendChild(emptyItem);
        return;
    }

    collisions.forEach(({ objectId, collidingWith }, index) => {
        const item = document.createElement("li");
        item.classList.add("collision-result-item");
        item.dataset.collisionId = objectId;
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("title", "Clique para selecionar a colisão");

        const title = document.createElement("div");
        title.classList.add("collision-result-title");
        title.textContent = `#${index + 1}: Objeto ${objectId}`;

        const list = document.createElement("div");
        list.classList.add("collision-result-list");
        list.textContent = "Colisão detectada com outro modelo.";

        const actions = document.createElement("div");
        actions.classList.add("collision-result-actions");

        const focusBtn = document.createElement("button");
        focusBtn.type = "button";
        focusBtn.textContent = "Isolar colisão";
        focusBtn.classList.add("collision-focus-btn");
        focusBtn.addEventListener("click", () => {
            setActiveCollisionSelection(objectId, collidingWith);
            isolateCollisionGroup(objectId, collidingWith);
        });

        const handleCollisionSelect = () => {
            setActiveCollisionSelection(objectId, collidingWith);
        };

        item.addEventListener("click", handleCollisionSelect);
        item.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleCollisionSelect();
            }
        });

        actions.appendChild(focusBtn);
        item.append(title, list, actions);
        collisionResultsList.appendChild(item);
    });
}

export function findAndRenderCollisions(modelId) {
    if (!collisionFeatureAllowed) {
        return;
    }
    
    normalizeCollisionRadiusInput();

    if (!modelId) {
        collisionSummary.textContent = "Selecione um modelo para iniciar a análise.";
        collisionResultsList.innerHTML = "";
        setCollisionState([], null);
        return;
    }

    const activeIds = getActiveObjectIdSet();
    const objects = getModelObjectIds(modelId).filter((id) => activeIds.has(id));
    const targetIds = new Set(objects);
    const externalObjects = getAllObjectIds().filter((id) =>
        activeIds.has(id) && !targetIds.has(id) && getObjectMetaModelId(id) !== modelId);

    if (!objects.length) {
        collisionSummary.textContent = "Nenhum objeto ativo encontrado no modelo selecionado.";
        collisionResultsList.innerHTML = "";
        setCollisionState([], null);
        return;
    }

    if (!externalObjects.length) {
        collisionSummary.textContent = "Nenhum outro objeto ativo em modelos diferentes para comparar colisões.";
        collisionResultsList.innerHTML = "";
        setCollisionState([], null);
        return;
    }

    const collisionsMap = new Map();

    const addCollision = (base, target) => {
        if (!collisionsMap.has(base)) {
            collisionsMap.set(base, new Set());
        }
        collisionsMap.get(base).add(target);
    };

    const overlapTolerance = getCollisionRadiusMeters();

    for (let i = 0; i < objects.length; i++) {
        const objectA = objects[i];
        const aabbA = viewer.scene.getAABB(objectA);

        if (!aabbA) {
            continue;
        }

        for (let j = 0; j < externalObjects.length; j++) {
            const objectB = externalObjects[j];
            const aabbB = viewer.scene.getAABB(objectB);

            if (aabbB && intersectsAABB(aabbA, aabbB, overlapTolerance)) {
                addCollision(objectA, objectB);
            }
        }
    }

    const collisions = Array.from(collisionsMap.entries()).map(([objectId, set]) => ({
        objectId,
        collidingWith: Array.from(set)
    }));

    collisionSummary.textContent = buildCollisionSummary(collisions.length, overlapTolerance);
    setCollisionState(collisions, modelId);
    renderCollisionResults(collisions);
}
