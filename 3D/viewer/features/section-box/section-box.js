// Caixa de corte (como a "Section Box" do Revit): seis planos de corte formando
// uma caixa; só o que está dentro dela aparece. Cada face tem uma alça que pode
// ser arrastada para aumentar ou diminuir a caixa naquela direção.
import {
    LineSet,
    SectionPlane
} from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";

const MIN_SIZE = 0.2;          // m: a caixa nunca fica menor que isto em cada direção
const FIT_MARGIN = 0.15;       // m de folga ao ajustar a caixa a objetos
const EDGE_COLOR = [0.2, 0.55, 1];

// Faces: eixo (0=x, 1=y, 2=z) e lado (0 = mínimo, 1 = máximo).
// O xeokit esconde o lado oposto à direção do plano → a direção aponta para dentro da caixa.
const FACES = [
    { axis: 0, side: 0, label: "Esquerda" },
    { axis: 0, side: 1, label: "Direita" },
    { axis: 1, side: 0, label: "Baixo" },
    { axis: 1, side: 1, label: "Topo" },
    { axis: 2, side: 0, label: "Trás" },
    { axis: 2, side: 1, label: "Frente" }
];

const STYLE = `
.section-box-handles{position:fixed;inset:0;pointer-events:none;z-index:100005}
.section-box-handle{position:absolute;width:22px;height:22px;margin:-11px 0 0 -11px;padding:0;border:2px solid #fff;border-radius:50%;background:#3389ff;box-shadow:0 2px 8px rgba(10,20,40,.35);cursor:grab;pointer-events:auto;touch-action:none;transition:transform .12s ease}
.section-box-handle::after{content:"";position:absolute;inset:5px;border-radius:50%;background:rgba(255,255,255,.85)}
.section-box-handle:hover{transform:scale(1.18)}
.section-box-handle.is-dragging{cursor:grabbing;transform:scale(1.25);background:#1f6fe0}
.section-box-handle[hidden]{display:none}
body[data-mode="mobile"] .section-box-handle{width:30px;height:30px;margin:-15px 0 0 -15px}
`;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function createSectionBox({ viewer, requestRenderFrame = () => {}, onChange = () => {} }) {
    const scene = viewer.scene;
    const camera = viewer.camera;
    const canvas = scene.canvas.canvas;

    if (!document.getElementById("sectionBoxStyle")) {
        const style = document.createElement("style");
        style.id = "sectionBoxStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    let box = null;               // [xmin, ymin, zmin, xmax, ymax, zmax]
    let planes = [];
    let edges = null;
    let handlesLayer = null;
    let handles = [];
    let cameraSub = null;
    let dragging = null;

    const faceCenter = (face) => {
        const c = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
        c[face.axis] = box[face.axis + face.side * 3];
        return c;
    };

    const faceNormalInward = (face) => {
        const n = [0, 0, 0];
        n[face.axis] = face.side === 0 ? 1 : -1;
        return n;
    };

    function updatePlanes() {
        FACES.forEach((face, i) => {
            const plane = planes[i];
            if (!plane) return;
            const pos = [(box[0] + box[3]) / 2, (box[1] + box[4]) / 2, (box[2] + box[5]) / 2];
            pos[face.axis] = box[face.axis + face.side * 3];
            plane.pos = pos;
            plane.dir = faceNormalInward(face);
        });
    }

    function updateEdges() {
        edges?.destroy();
        const [x0, y0, z0, x1, y1, z1] = box;
        const p = [
            [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
            [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]
        ];
        const pairs = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
        const positions = [];
        const indices = [];
        pairs.forEach(([a, b]) => {
            const i = positions.length / 3;
            positions.push(...p[a], ...p[b]);
            indices.push(i, i + 1);
        });
        edges = new LineSet(scene, { positions, indices, color: EDGE_COLOR, opacity: 0.85, clippable: false, collidable: false });
        if (edges._sceneModel && "collidable" in edges._sceneModel) edges._sceneModel.collidable = false;
    }

    function updateHandles() {
        if (!handlesLayer || !box) return;
        const rect = canvas.getBoundingClientRect();   // projectWorldPos devolve pixels CSS do canvas
        const eye = camera.eye;
        const look = sub(camera.look, eye);
        FACES.forEach((face, i) => {
            const handle = handles[i];
            const center = faceCenter(face);
            // Atrás da câmera: esconde a alça
            if (dot(sub(center, eye), look) <= 0) {
                handle.hidden = true;
                return;
            }
            const screen = camera.projectWorldPos(center);
            if (!screen || !Number.isFinite(screen[0])) {
                handle.hidden = true;
                return;
            }
            handle.hidden = false;
            handle.style.left = `${rect.left + screen[0]}px`;
            handle.style.top = `${rect.top + screen[1]}px`;
        });
    }

    function applyChange() {
        updatePlanes();
        updateEdges();
        updateHandles();
        requestRenderFrame();
        onChange(getBox());
    }

    // Arraste de uma alça: o movimento do mouse é projetado no eixo da face
    function startDrag(event, faceIndex) {
        event.preventDefault();
        event.stopPropagation();
        const face = FACES[faceIndex];
        const center = faceCenter(face);
        const axis = [0, 0, 0];
        axis[face.axis] = 1;
        const span = Math.max(1, (box[face.axis + 3] - box[face.axis]) * 0.25);
        const a = camera.projectWorldPos(center);
        const b = camera.projectWorldPos([center[0] + axis[0] * span, center[1] + axis[1] * span, center[2] + axis[2] * span]);
        const screenAxis = [b[0] - a[0], b[1] - a[1]];
        const pixelsPerMeter = Math.hypot(screenAxis[0], screenAxis[1]) / span;
        if (!(pixelsPerMeter > 1e-6)) return;
        dragging = {
            faceIndex,
            startX: event.clientX,
            startY: event.clientY,
            startValue: box[face.axis + face.side * 3],
            dirX: screenAxis[0] / (pixelsPerMeter * span),
            dirY: screenAxis[1] / (pixelsPerMeter * span),
            pixelsPerMeter
        };
        handles[faceIndex].classList.add("is-dragging");
        handles[faceIndex].setPointerCapture?.(event.pointerId);
        viewer.cameraControl.active = false;
    }

    function moveDrag(event) {
        if (!dragging) return;
        const face = FACES[dragging.faceIndex];
        const dx = event.clientX - dragging.startX;
        const dy = event.clientY - dragging.startY;
        const meters = (dx * dragging.dirX + dy * dragging.dirY) / dragging.pixelsPerMeter;
        const index = face.axis + face.side * 3;
        let value = dragging.startValue + meters;
        if (face.side === 0) value = Math.min(value, box[face.axis + 3] - MIN_SIZE);
        else value = Math.max(value, box[face.axis] + MIN_SIZE);
        box[index] = value;
        applyChange();
    }

    function endDrag() {
        if (!dragging) return;
        handles[dragging.faceIndex]?.classList.remove("is-dragging");
        dragging = null;
        viewer.cameraControl.active = true;
    }

    function createHandles() {
        handlesLayer = document.createElement("div");
        handlesLayer.className = "section-box-handles";
        handles = FACES.map((face, i) => {
            const handle = document.createElement("button");
            handle.type = "button";
            handle.className = "section-box-handle";
            handle.setAttribute("aria-label", `Ajustar face ${face.label} da caixa de corte`);
            handle.dataset.tip = `Arraste para ajustar (${face.label})`;
            handle.addEventListener("pointerdown", (event) => startDrag(event, i));
            handlesLayer.appendChild(handle);
            return handle;
        });
        document.body.appendChild(handlesLayer);
        window.addEventListener("pointermove", moveDrag);
        window.addEventListener("pointerup", endDrag);
        window.addEventListener("pointercancel", endDrag);
        window.addEventListener("resize", updateHandles);
        cameraSub = camera.on("matrix", updateHandles);
    }

    function destroyHandles() {
        endDrag();
        handlesLayer?.remove();
        handlesLayer = null;
        handles = [];
        window.removeEventListener("pointermove", moveDrag);
        window.removeEventListener("pointerup", endDrag);
        window.removeEventListener("pointercancel", endDrag);
        window.removeEventListener("resize", updateHandles);
        if (cameraSub !== null) camera.off(cameraSub);
        cameraSub = null;
    }

    /** Caixa envolvente dos objetos (selecionados, ou todos os visíveis), com folga. */
    function objectsAABB(ids) {
        const list = (ids || []).filter((id) => !String(id).startsWith("__") && scene.objects[id]);
        if (!list.length) return null;
        const a = scene.getAABB(list);
        if (!a || !a.every(Number.isFinite)) return null;
        return [a[0] - FIT_MARGIN, a[1] - FIT_MARGIN, a[2] - FIT_MARGIN, a[3] + FIT_MARGIN, a[4] + FIT_MARGIN, a[5] + FIT_MARGIN];
    }

    function selectionOrVisibleAABB() {
        return objectsAABB(scene.selectedObjectIds)
            || objectsAABB(scene.highlightedObjectIds)
            || objectsAABB(scene.visibleObjectIds)
            || objectsAABB(scene.objectIds);
    }

    function enable(initialBox = null) {
        const target = initialBox || selectionOrVisibleAABB();
        if (!target) return false;
        box = target.slice();
        if (!planes.length) {
            planes = FACES.map((face, i) => new SectionPlane(scene, { id: `sectionBoxPlane${i}`, pos: [0, 0, 0], dir: faceNormalInward(face), active: true }));
        }
        planes.forEach((plane) => { plane.active = true; });
        if (!handlesLayer) createHandles();
        applyChange();
        return true;
    }

    function disable() {
        destroyHandles();
        planes.forEach((plane) => plane.destroy());
        planes = [];
        edges?.destroy();
        edges = null;
        box = null;
        requestRenderFrame();
        onChange(null);
    }

    /** Reajusta a caixa aos objetos selecionados (ou ao modelo visível). */
    function fitToSelection() {
        const target = selectionOrVisibleAABB();
        if (!target || !box) return false;
        box = target.slice();
        applyChange();
        return true;
    }

    function getBox() {
        return box ? box.slice() : null;
    }

    return {
        enable,
        disable,
        fitToSelection,
        getBox,
        isActive: () => Boolean(box),
        frame: () => { if (box) viewer.cameraFlight.flyTo({ aabb: box, duration: 0.5 }); }
    };
}
