import { AnnotationsPlugin } from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";

//const CLI_ANNOTATION_ID = "CLI-1";
//const CLI_ANNOTATION_POSITION = [13.757, 3.150, -5.724];
//const CLI_MARKER_VISIBILITY_DISTANCE = 10;
//const CLI_ASSOCIATED_OBJECT_ID = "3RlDYoCOXFBftt5FQ7AyKS";

//const E1_ANNOTATION_ID = "E1";
//const E1_ANNOTATION_POSITION = [17.351, -1.025, -20.397];
//const E1_ASSOCIATED_OBJECT_ID = "0dHnBkUG4Hy9840DTjNSMz";

//const PLUVIAL_MARKER_COLOR = "#0d47a1";

//const PLUVIAL_ANNOTATIONS_DATA = [
    //{ id: "P1", position: [20.055, -0.708, 5.4], code: "1WrxvzCOr9Auw$Q_glClng", collision: "colidindo com o P77" },
    //{ id: "P2", position: [-18.397, -0.488, -0.068], code: "2MzABgmtT5VhpuGaXDZPRb", collision: "colidindo com o P55" },
    //{ id: "P3", position: [5.672, 0.112, 3.115], code: "2z1mHKFyTDhejCTKD0w0Uo", collision: "colidindo com o dreno" },
    //{ id: "P4", position: [14.334, -0.488, 22.171], code: "3ZPkGE6cjFghJn3dcnicuE", collision: "colidindo com o P153" },
    //{ id: "P5", position: [19.294, -0.488, 21.169], code: "06nxdC0M52rQ8nuQ3fOC7r", collision: "colidindo com o P147" },
    //{ id: "P6", position: [-18.205, -0.488, -0.265], code: "20Q$qrG1n3Qv$YuVEVAZRt", collision: "colidindo com o P55" },
    //{ id: "P7", position: [19.506, -0.488, 5.466], code: "2oMata$0P6T8u0gF8kRuAv", collision: "colidindo com o P77" },
    //{ id: "P8", position: [-17.769, -0.488, -14.175], code: "1CsWtSpH55Pxs14vmp$sPl", collision: "colidindo com o P20" },
    //{ id: "P9", position: [-8.988, -0.488, 12.269], code: "2kT4zEYE5BIQis3xNf7pm_", collision: "colidindo com o P91" },
    //{ id: "P10", position: [-8.863, -0.488, 22.451], code: "2n3OVZC4v0GwwXdlnWiPnk", collision: "colidindo com o P149" },
    //{ id: "P11", position: [-8.291, -0.558, -19.526], code: "3RpZQMgw5FgQFA72BSwX_$", collision: "colidindo com o P8" },
    //{ id: "P12", position: [-6.987, 0.112, 3.068], code: "1KtFZuYs540BJwijIcDM2_", collision: "colidindo com o dreno" },
    //{ id: "P13", position: [-6.798, 0.112, 3.068], code: "0elImHZk10IvQ$pWxGG1zw", collision: "colidindo com o dreno" },
    //{ id: "P14", position: [13.581, -0.728, 22.723], code: "1bfHQYg9f0zBzR37hDF63l", collision: "colidindo com o P153" },
    //{ id: "P15", position: [-8.240, 5.700, 9.017], code: "385l8DOdz6VuFqIELovCns", collision: "colidindo com a eletrocalha" },
    //{ id: "P16", position: [13.558, 6.499, 5.978], code: "2iBkJbBiD3sAJ5GLjluZDo", collision: "colidindo com a eletrocalha" },
    //{ id: "P17", position: [-6.798 ,  8.931, 3.279], code: "2r$2qQGFXDGAkyLDdDgmFn", collision: "tubo de climatização dentro do tubo" },
    //{ id: "P18", position: [-6.798,  5.231, 3.279], code: "3QHE7gVPbCbRAFC54CvWWJ", collision: "tubo de climatização dentro do tubo" },
    //{ id: "P19", position: [-6.513, 8.213, 3.279], code: "2nS2r5Pfv3ExPM_EUPTdHf", collision: "colidindo com o P63" },
    //{ id: "P20", position: [-6.513, 7.440, 3.279], code: "2_iEYrx6121940s3so8Qfq", collision: "colidindo com o P63" },
    //{ id: "P21", position: [-6.540, 8.213, -16.743], code: "3Cru1qzlPEpevU8Hx8Ia3U", collision: "colidindo com o P10" },
    //{ id: "P22", position: [-6.737,  7.288, -16.742], code: "0EgtHiRSj218P7ZUk5DDmc", collision: "colidindo com o P10" },
    //{ id: "P23", position: [14.007,  5.548, 22.171], code: "0RjajtPtn7lQqtMF_DGbXkc", collision: "colidindo com o VC 112" },
    //{ id: "P24", position: [-8.852,  -1.000, 16.350], code: "0dHn9sUG4Hy9840DTjNSMz", collision: "colidindo com o P121" },
    //{ id: "P25", position: [-20.612,  -0.975, 0.190], code: "0dHnLEUG4Hy9840DTjNSMz", collision: "colidindo com o P54" },
//];

function setAnnotationMarkerShown(annotation, shown) {
    if (typeof annotation.setMarkerShown === "function") {
        annotation.setMarkerShown(shown);
    } else {
        annotation.markerShown = shown;
    }
}

function getAnnotationMarkerShown(annotation) {
    if (typeof annotation.getMarkerShown === "function") {
        return annotation.getMarkerShown();
    }

    return Boolean(annotation.markerShown);
}

function setAnnotationLabelShown(annotation, shown) {
    if (typeof annotation.setLabelShown === "function") {
        annotation.setLabelShown(shown);
    } else {
        annotation.labelShown = shown;
    }
}

function getAnnotationLabelShown(annotation) {
    if (typeof annotation.getLabelShown === "function") {
        return annotation.getLabelShown();
    }

    return Boolean(annotation.labelShown);
}

function setupAnnotationVisibilityControl(annotation, viewer, requestRenderFrame, targetPosition, visibilityDistance = CLI_MARKER_VISIBILITY_DISTANCE) {
    const updateVisibility = () => {
        const eye = viewer.camera?.eye;
        const target = annotation.worldPos || targetPosition;

        if (!eye || !target) {
            return;
        }

        const dx = eye[0] - target[0];
        const dy = eye[1] - target[1];
        const dz = eye[2] - target[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const shouldShowMarker = distance <= visibilityDistance;
        const isMarkerShown = getAnnotationMarkerShown(annotation);
        const isLabelShown = getAnnotationLabelShown(annotation);

        if (isMarkerShown !== shouldShowMarker) {
            setAnnotationMarkerShown(annotation, shouldShowMarker);
            requestRenderFrame();
        }

        if (!shouldShowMarker && isLabelShown) {
            setAnnotationLabelShown(annotation, false);
            requestRenderFrame();
        }
    };

    if (viewer.camera?.on) {
        viewer.camera.on("matrix", updateVisibility);
    }

    updateVisibility();
}

function setupAnnotationLabelToggle(annotation, annotationsPlugin, requestRenderFrame) {
    const showCliLabel = (annotationEvent) => {
        if (annotationEvent?.id === annotation.id || annotationEvent?.annotation?.id === annotation.id) {
            setAnnotationLabelShown(annotation, true);
            requestRenderFrame();
        }
    };

    const hideCliLabel = (annotationEvent) => {
        if (annotationEvent?.id === annotation.id || annotationEvent?.annotation?.id === annotation.id) {
            setAnnotationLabelShown(annotation, false);
            requestRenderFrame();
        }
    };

    if (typeof annotationsPlugin.on === "function") {
        annotationsPlugin.on("markerMouseEnter", showCliLabel);
        annotationsPlugin.on("markerMouseLeave", hideCliLabel);
    }
}

function setupAnnotationClickFocus(annotation, annotationsPlugin, focusObjectById, associatedObjectId) {
    const focusCliObject = (annotationEvent) => {
        if (annotationEvent?.id === annotation.id || annotationEvent?.annotation?.id === annotation.id) {
            setAnnotationLabelShown(annotation, true);
            if (associatedObjectId) {
                focusObjectById(associatedObjectId, { animate: true, xrayOthers: false });
            }
        }
    };

    if (typeof annotationsPlugin.on === "function") {
        annotationsPlugin.on("markerClicked", focusCliObject);
        annotationsPlugin.on("labelClicked", focusCliObject);
    }
}

function setupAnnotationInteractions(annotationsPlugin, annotation, { viewer, requestRenderFrame, targetPosition, visibilityDistance = CLI_MARKER_VISIBILITY_DISTANCE, associatedObjectId, focusObjectById }) {
    setupAnnotationVisibilityControl(annotation, viewer, requestRenderFrame, targetPosition, visibilityDistance);
    setupAnnotationLabelToggle(annotation, annotationsPlugin, requestRenderFrame);
    setupAnnotationClickFocus(annotation, annotationsPlugin, focusObjectById, associatedObjectId);
}

function createFixedAnnotations(annotationsPlugin) {
    const cliAnnotation = annotationsPlugin.createAnnotation({
        id: CLI_ANNOTATION_ID,
        worldPos: CLI_ANNOTATION_POSITION,
        occludable: false,
        markerShown: true,
        labelShown: true,
        values: {
            glyph: "C1",
            title: "C1",
            description: "O tubo está colidindo com o elétrico",
            markerBGColor: "#e53935"
        }
    });

    const e1Annotation = annotationsPlugin.createAnnotation({
        id: E1_ANNOTATION_ID,
        worldPos: E1_ANNOTATION_POSITION,
        occludable: false,
        markerShown: true,
        labelShown: true,
        values: {
            glyph: "E1",
            title: "E1",
            description: "O Bloco do pilar 5 está batendo com o muro de contenção.",
            markerBGColor: "#9e9e9e"
        }
    });

    return { cliAnnotation, e1Annotation };
}

function createPluvialAnnotations(annotationsPlugin) {
    return PLUVIAL_ANNOTATIONS_DATA.map(({ id, position, code, collision }) => annotationsPlugin.createAnnotation({
        id,
        worldPos: position,
        occludable: false,
        markerShown: true,
        labelShown: true,
        values: {
            glyph: id,
            title: id,
            description: `Código: ${code}. Colidindo com ${collision}.`,
            markerBGColor: PLUVIAL_MARKER_COLOR,
        }
    }));
}
export function setupAnnotations(viewer, { requestRenderFrame, focusObjectById }) {
    const annotationsPlugin = new AnnotationsPlugin(viewer, {
        markerHTML: "<div class='annotation-marker' style='background-color: {{markerBGColor}}'>{{glyph}}</div>",
        labelHTML: "<div class='annotation-label'><div class='annotation-title'>{{title}}</div><div class='annotation-desc'>{{description}}</div></div>",
        values: {
            markerBGColor: "#0057ff",
            glyph: "●",
            title: "Anotação",
            description: "Sem descrição",
        }
    });

    const { cliAnnotation, e1Annotation } = createFixedAnnotations(annotationsPlugin);
    const pluvialAnnotations = createPluvialAnnotations(annotationsPlugin);

    setAnnotationMarkerShown(cliAnnotation, false);
    setAnnotationLabelShown(cliAnnotation, false);
    setAnnotationMarkerShown(e1Annotation, false);
    setAnnotationLabelShown(e1Annotation, false);

        pluvialAnnotations.forEach((annotation) => {
        setAnnotationMarkerShown(annotation, false);
        setAnnotationLabelShown(annotation, false);
    });

    setupAnnotationInteractions(annotationsPlugin, cliAnnotation, {
        viewer,
        requestRenderFrame,
        targetPosition: CLI_ANNOTATION_POSITION,
        visibilityDistance: CLI_MARKER_VISIBILITY_DISTANCE,
        associatedObjectId: CLI_ASSOCIATED_OBJECT_ID,
        focusObjectById
    });

    setupAnnotationInteractions(annotationsPlugin, e1Annotation, {
        viewer,
        requestRenderFrame,
        targetPosition: E1_ANNOTATION_POSITION,
        visibilityDistance: CLI_MARKER_VISIBILITY_DISTANCE,
        associatedObjectId: E1_ASSOCIATED_OBJECT_ID,
        focusObjectById
    });

    PLUVIAL_ANNOTATIONS_DATA.forEach(({ position, code }, index) => {
        const annotation = pluvialAnnotations[index];
        setupAnnotationInteractions(annotationsPlugin, annotation, {
            viewer,
            requestRenderFrame,
            targetPosition: position,
            visibilityDistance: CLI_MARKER_VISIBILITY_DISTANCE,
            associatedObjectId: code,
            focusObjectById,
        });
    });

    return { annotationsPlugin, annotations: { cliAnnotation, e1Annotation, pluvialAnnotations } };
}

const OCCUPANCY_LIMIT_ANNOTATION_PREFIX = "OCCUPANCY-LIMIT-";
const OCCUPANCY_LIMIT_MARKER_COLOR = "#e53935";
const OCCUPANCY_LIMIT_LABEL_BG_COLOR = "rgba(183, 28, 28, 0.95)";
const OCCUPANCY_LIMIT_LABEL_BORDER_COLOR = "rgba(255, 205, 210, 0.65)";

function computeObjectCenter(viewer, sceneObjectId) {
    if (!viewer || !sceneObjectId) {
        return null;
    }

    const aabb = viewer.scene?.getAABB?.(sceneObjectId);
    if (!Array.isArray(aabb) || aabb.length < 6) {
        return null;
    }

    const [minX, minY, minZ, maxX, maxY, maxZ] = aabb;
    if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) {
        return null;
    }

    return [
        (minX + maxX) / 2,
        (minY + maxY) / 2,
        (minZ + maxZ) / 2
    ];
}

function buildSceneObjectIdCandidates(rawId) {
    const normalizedRawId = String(rawId || "").trim();
    if (!normalizedRawId) {
        return [];
    }

    const candidates = new Set([normalizedRawId]);

    ["#", "/", ":"].forEach((separator) => {
        if (!normalizedRawId.includes(separator)) {
            return;
        }

        const parts = normalizedRawId.split(separator).map((part) => part.trim()).filter(Boolean);
        if (!parts.length) {
            return;
        }

        candidates.add(parts[parts.length - 1]);
    });

    return Array.from(candidates);
}

function resolveSceneObjectIdForRow(viewer, row) {
    const rawCandidates = new Set([
        row?.sceneObjectId,
        row?.metaObjectId,
        row?.ifcCode
    ]);

    const metaObject = viewer?.metaScene?.metaObjects?.[row?.metaObjectId];
    if (metaObject?.sceneObjectId) {
        rawCandidates.add(metaObject.sceneObjectId);
    }
    if (metaObject?.id) {
        rawCandidates.add(metaObject.id);
    }

    const sceneObjects = viewer?.scene?.objects || {};
    const sceneObjectIds = Object.keys(sceneObjects);
    const lowerMap = new Map(sceneObjectIds.map((id) => [String(id).toLowerCase(), id]));

    for (const rawId of rawCandidates) {
        const candidateVariants = buildSceneObjectIdCandidates(rawId);
        for (const variant of candidateVariants) {
            if (sceneObjects[variant]) {
                return variant;
            }

            const lowerVariant = String(variant).toLowerCase();
            if (lowerMap.has(lowerVariant)) {
                return lowerMap.get(lowerVariant);
            }
        }
    }

    return "";
}

function destroyAnnotation(annotationsPlugin, annotation) {
    if (!annotation) {
        return;
    }

    if (typeof annotationsPlugin?.destroyAnnotation === "function") {
        annotationsPlugin.destroyAnnotation(annotation.id);
        return;
    }

    if (typeof annotation.destroy === "function") {
        annotation.destroy();
    }
}

export function createOccupancyLimitAnnotationsController({ viewer, requestRenderFrame, focusObjectById } = {}) {
    if (!viewer) {
        return {
            syncAnnotations() {}
        };
    }

    const annotationsPlugin = new AnnotationsPlugin(viewer, {
        markerHTML: "<div class='annotation-marker' style='background-color: {{markerBGColor}}'>{{glyph}}</div>",
        labelHTML: "<div class='annotation-label' style='background: {{labelBGColor}}; border: 1px solid {{labelBorderColor}};'><div class='annotation-title'>{{title}}</div><div class='annotation-desc'>{{description}}</div></div>",
        values: {
            markerBGColor: OCCUPANCY_LIMIT_MARKER_COLOR,
            labelBGColor: OCCUPANCY_LIMIT_LABEL_BG_COLOR,
            labelBorderColor: OCCUPANCY_LIMIT_LABEL_BORDER_COLOR,
            glyph: "!",
            title: "Taxa de ocupação acima do limite",
            description: "Ultrapassou o limite máximo de ocupação de 40%."
        }
    });

    const annotationsById = new Map();

    function syncAnnotations(overLimitRows = []) {
        const activeIds = new Set();

        overLimitRows.forEach((row, index) => {
            const sceneObjectId = resolveSceneObjectIdForRow(viewer, row);
            const worldPos = computeObjectCenter(viewer, sceneObjectId);
            if (!worldPos) {
                return;
            }

            const annotationId = `${OCCUPANCY_LIMIT_ANNOTATION_PREFIX}${String(sceneObjectId || index)}`;
            activeIds.add(annotationId);

            if (annotationsById.has(annotationId)) {
                const existingAnnotation = annotationsById.get(annotationId);
                if (existingAnnotation) {
                    existingAnnotation.worldPos = worldPos;
                    setAnnotationMarkerShown(existingAnnotation, true);
                    setAnnotationLabelShown(existingAnnotation, true);
                }
                return;
            }

            const occupancyPercent = Number.isFinite(row?.occupancyRate)
                ? (row.occupancyRate * 100).toFixed(2)
                : "0.00";

            const annotation = annotationsPlugin.createAnnotation({
                id: annotationId,
                worldPos,
                occludable: false,
                markerShown: true,
                labelShown: true,
                values: {
                    glyph: "!",
                    title: "Taxa de ocupação acima do limite",
                    description: `Ultrapassou o limite máximo de ocupação de 40% (atual: ${occupancyPercent}%).`,
                    markerBGColor: OCCUPANCY_LIMIT_MARKER_COLOR,
                    labelBGColor: OCCUPANCY_LIMIT_LABEL_BG_COLOR,
                    labelBorderColor: OCCUPANCY_LIMIT_LABEL_BORDER_COLOR
                }
            });

            setupAnnotationLabelToggle(annotation, annotationsPlugin, requestRenderFrame || (() => {}));
            setupAnnotationClickFocus(annotation, annotationsPlugin, focusObjectById || (() => {}), sceneObjectId);
            annotationsById.set(annotationId, annotation);
        });

        Array.from(annotationsById.entries()).forEach(([annotationId, annotation]) => {
            if (activeIds.has(annotationId)) {
                return;
            }

            destroyAnnotation(annotationsPlugin, annotation);
            annotationsById.delete(annotationId);
        });

        if (typeof requestRenderFrame === "function") {
            requestRenderFrame();
        }
    }

    return {
        syncAnnotations
    };
}

const USER_ANNOTATION_PREFIX = "USER-ANNOTATION-";
const USER_ANNOTATION_MARKER_COLOR = "#7c3aed";

function sanitizeAnnotationText(value) {
    return String(value || "").trim().slice(0, 500);
}

function normalizeAnnotationPosition(position) {
    if (!Array.isArray(position) || position.length < 3) {
        return null;
    }

    const normalized = position.slice(0, 3).map((value) => Number(value));
    return normalized.every(Number.isFinite) ? normalized : null;
}

function buildUserAnnotationId() {
    if (globalThis.crypto?.randomUUID) {
        return `${USER_ANNOTATION_PREFIX}${globalThis.crypto.randomUUID()}`;
    }

    return `${USER_ANNOTATION_PREFIX}${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createUserAnnotationsController({ viewer, requestRenderFrame } = {}) {
    if (!viewer) {
        return {
            addAnnotation() { return null; },
            addAnnotationFromPickResult() { return null; },
            importAnnotations() {},
            exportAnnotations() { return []; }
        };
    }

    const annotationsPlugin = new AnnotationsPlugin(viewer, {
        markerHTML: "<div class='annotation-marker user-annotation-marker' style='background-color: {{markerBGColor}};'>{{glyph}}</div>",
        labelHTML: "<div class='annotation-label user-annotation-label'><div class='annotation-title'>{{title}}</div><div class='annotation-desc'>{{description}}</div></div>",
        values: {
            markerBGColor: USER_ANNOTATION_MARKER_COLOR,
            glyph: "📝",
            title: "Anotação",
            description: "Sem descrição"
        },
        surfaceOffset: 0.1
    });
    const records = new Map();
    const render = typeof requestRenderFrame === "function" ? requestRenderFrame : () => {};

    function createAnnotationRecord({ id = buildUserAnnotationId(), worldPos, pickResult, text, title = "Anotação" } = {}) {
        const normalizedPosition = normalizeAnnotationPosition(worldPos || pickResult?.worldPos);
        const description = sanitizeAnnotationText(text);

        if (!normalizedPosition || !description) {
            return null;
        }

        let safeId = String(id || buildUserAnnotationId());
        if (records.has(safeId)) {
            safeId = buildUserAnnotationId();
        }

        const annotationConfig = {
            id: safeId,
            worldPos: normalizedPosition,
            occludable: false,
            markerShown: true,
            labelShown: true,
            values: {
                glyph: "📝",
                title: sanitizeAnnotationText(title) || "Anotação",
                description,
                markerBGColor: USER_ANNOTATION_MARKER_COLOR
            }
        };

        if (pickResult) {
            annotationConfig.pickResult = pickResult;
            delete annotationConfig.worldPos;
        }

        const annotation = annotationsPlugin.createAnnotation(annotationConfig);
        const storedPosition = normalizeAnnotationPosition(annotation?.worldPos) || normalizedPosition;

        setupAnnotationLabelToggle(annotation, annotationsPlugin, render);
        records.set(safeId, { id: safeId, worldPos: storedPosition, text: description, title: sanitizeAnnotationText(title) || "Anotação", annotation });
        render();
        return records.get(safeId);
    }

    function addAnnotation(worldPos, text) {
        return createAnnotationRecord({ worldPos, text });
    }

    function addAnnotationFromPickResult(pickResult, text) {
        return createAnnotationRecord({ pickResult, text });
    }

    function importAnnotations(annotations = []) {
        if (!Array.isArray(annotations)) {
            return;
        }

        annotations.forEach((annotation) => {
            createAnnotationRecord({
                id: annotation?.id,
                worldPos: annotation?.worldPos || annotation?.position,
                text: annotation?.text || annotation?.description,
                title: annotation?.title || "Anotação"
            });
        });
    }

    function exportAnnotations() {
        return Array.from(records.values()).map(({ id, worldPos, text, title }) => ({
            id,
            worldPos: [...worldPos],
            text,
            title
        }));
    }

    const controller = { addAnnotation, addAnnotationFromPickResult, importAnnotations, exportAnnotations };
    window.userAnnotationsController = controller;
    return controller;
}