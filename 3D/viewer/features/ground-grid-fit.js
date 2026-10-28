// Grade do piso ajustada ao tamanho do prédio (projetos grandes, como o TCE).
// Os outros projetos continuam com a grade padrão de 100 m criada pelo visualizador.
// Ativada pela opção groundGrid: "fit" do projeto em api/_viewer-projects.js.
import { LineSet, buildGridGeometry } from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";

const GRID_MARGIN = 0.15;      // folga em cada lado, em relação ao tamanho do prédio
const GRID_MAX_DIVISIONS = 400; // acima disso as linhas ficam mais espaçadas (grade leve)

function waitForViewer() {
    return new Promise((resolve) => {
        const check = () => {
            const viewer = window.ifcUploadBridge?.viewer;
            if (viewer) resolve(viewer); else setTimeout(check, 200);
        };
        check();
    });
}

/** Caixa que envolve todos os modelos carregados (sem a própria grade e sem cópias temporárias). */
function modelsAABB(viewer) {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const model of Object.values(viewer.scene.models || {})) {
        if (!model?.aabb || String(model.id).startsWith("__")) continue;
        const a = model.aabb;
        if (!a.every(Number.isFinite)) continue;
        for (let k = 0; k < 3; k++) {
            box[k] = Math.min(box[k], a[k]);
            box[k + 3] = Math.max(box[k + 3], a[k + 3]);
        }
    }
    return Number.isFinite(box[0]) ? box : null;
}

function fitGroundGrid(viewer) {
    const a = modelsAABB(viewer);
    if (!a) return;
    const centerX = (a[0] + a[3]) / 2;
    const centerZ = (a[2] + a[5]) / 2;
    let size = Math.max(a[3] - a[0], a[5] - a[2]) * (1 + 2 * GRID_MARGIN);
    size = Math.max(100, Math.ceil(size / 10) * 10);
    const cell = Math.max(1, Math.ceil(size / GRID_MAX_DIVISIONS));
    size = Math.ceil(size / cell) * cell;

    const grid = buildGridGeometry({ size, divisions: size / cell });
    const positions = Array.from(grid.positions);
    for (let i = 0; i < positions.length; i += 3) {
        positions[i] += centerX;
        positions[i + 2] += centerZ;
    }

    viewer.scene.components?.groundGrid?.destroy?.();
    new LineSet(viewer.scene, {
        id: "groundGrid",
        positions,
        indices: grid.indices,
        color: [0.6, 0.6, 0.6],
        opacity: 0.35,
        clippable: false,
        collidable: false
    });
}

const viewer = await waitForViewer();
let refitTimer = null;
const scheduleRefit = () => {
    clearTimeout(refitTimer);
    refitTimer = setTimeout(() => fitGroundGrid(viewer), 500);
};
viewer.scene.on("modelLoaded", scheduleRefit);
scheduleRefit();
