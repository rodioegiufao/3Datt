// Aparência da cena 3D: fundo em degradê, grade do piso (linhas finas de 1 m, como
// a original) que vai sumindo nas bordas, sombra de contato sob o prédio,
// oclusão de ambiente (SAO) e arestas suaves.
// Tudo que define a "cara" da cena fica aqui, num lugar só.
import {
    LineSet,
    Mesh,
    ReadableGeometry,
    PhongMaterial,
    Texture
} from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";

// ---------------------------------------------------------------------------
// Paleta da cena (mude aqui para ajustar o visual inteiro)
// ---------------------------------------------------------------------------
export const SCENE_STYLE = Object.freeze({
    // Fundo: mais escuro em cima, mais claro no horizonte
    skyTop: "#a9b7c5",
    skyBottom: "#e3e8ed",

    // Grade do piso: mesma cor e opacidade da grade original, em faixas que
    // vão ficando mais claras para a borda não aparecer como um corte seco
    gridColor: [0.6, 0.6, 0.6],
    gridBands: [
        { reach: 1.0, opacity: 0.35 },   // perto do prédio (igual à original)
        { reach: 1.15, opacity: 0.28 },
        { reach: 1.3, opacity: 0.21 },
        { reach: 1.48, opacity: 0.14 },
        { reach: 1.7, opacity: 0.07 }
    ],
    contactShadow: "rgba(24, 32, 42, 0.32)",

    // Arestas das peças (cinza translúcido no lugar do preto puro)
    edgeColor: [0.16, 0.18, 0.21],
    edgeAlpha: 0.32,

    // Oclusão de ambiente: sombreado suave nos cantos e encontros de peças
    sao: {
        intensity: 0.22,
        bias: 0.5,
        scale: 600,
        kernelRadius: 70,
        minResolution: 0,
        blur: true
    }
});

const SHADOW_ID = "sceneStyleContactShadow";
const SHADOW_TEXTURE_SIZE = 512;   // a sombra é desfocada: textura pequena basta
const MIN_GRID_HALF = 50;          // m (a grade original tinha 100 m de lado)
const GRID_REACH = 1.0;            // meia-largura da faixa principal = maior lado do prédio
const MAX_LINES_PER_SIDE = 400;    // acima disso as células ficam maiores (grade leve)

/** Pinta o fundo da cena num canvas 2D (usado nas capturas de tela e no PDF). */
export function paintViewerBackground(ctx, width, height) {
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, SCENE_STYLE.skyTop);
    gradient.addColorStop(1, SCENE_STYLE.skyBottom);
    ctx.save();
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

/** Copia o canvas 3D já com o fundo pintado (o canvas 3D é transparente). */
export function canvasWithBackground(sourceCanvas, width = sourceCanvas.width, height = sourceCanvas.height) {
    const out = document.createElement("canvas");
    out.width = width;
    out.height = height;
    const ctx = out.getContext("2d", { alpha: false });
    paintViewerBackground(ctx, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(sourceCanvas, 0, 0, width, height);
    return out;
}

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

/**
 * Linhas da grade num quadrado de meia-largura `outer`, sem o miolo de meia-largura
 * `inner` (que já foi desenhado pela faixa anterior). Coordenadas relativas ao centro.
 */
function gridBandLines(outer, inner, cell, y) {
    const positions = [];
    const indices = [];
    const n = Math.round(outer / cell);
    const push = (x1, z1, x2, z2) => {
        const i = positions.length / 3;
        positions.push(x1, y, z1, x2, y, z2);
        indices.push(i, i + 1);
    };
    for (let k = -n; k <= n; k++) {
        const t = k * cell;
        const insideHole = inner > 0 && Math.abs(t) < inner - 1e-6;
        if (!insideHole) {
            push(t, -outer, t, outer);   // linha paralela a Z
            push(-outer, t, outer, t);   // linha paralela a X
        } else {
            push(t, -outer, t, -inner); push(t, inner, t, outer);
            push(-outer, t, -inner, t); push(inner, t, outer, t);
        }
    }
    return { positions, indices };
}

/** Sombra de contato: elipse desfocada numa textura pequena (transparente fora dela). */
function drawShadowTexture() {
    const px = SHADOW_TEXTURE_SIZE;
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    const gradient = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    const strong = SCENE_STYLE.contactShadow;
    const medium = strong.replace(/[\d.]+\)$/, (a) => `${(parseFloat(a) * 0.55).toFixed(3)})`);
    gradient.addColorStop(0, strong);
    gradient.addColorStop(0.55, medium);
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, px, px);
    return canvas.toDataURL("image/png");
}

/**
 * Aplica o visual da cena e mantém a grade e a sombra ajustadas ao tamanho dos modelos.
 * Chamado uma vez na inicialização do visualizador.
 */
export function setupSceneStyle({ viewer, requestRenderFrame = () => {}, enableSAO = true }) {
    const scene = viewer.scene;

    // Fundo: o canvas 3D é transparente e o degradê fica no próprio elemento
    const canvasElement = scene.canvas.canvas;
    canvasElement.style.background = `linear-gradient(180deg, ${SCENE_STYLE.skyTop} 0%, ${SCENE_STYLE.skyBottom} 100%)`;

    // Arestas suaves
    if (scene.edgeMaterial) {
        scene.edgeMaterial.edgeColor = SCENE_STYLE.edgeColor;
        scene.edgeMaterial.edgeAlpha = SCENE_STYLE.edgeAlpha;
        scene.edgeMaterial.edgeWidth = 1;
    }

    // Oclusão de ambiente (só ajusta a intensidade; quem liga/desliga é o modo leve)
    if (enableSAO && scene.sao) {
        Object.assign(scene.sao, SCENE_STYLE.sao);
    }

    let gridSets = [];
    let shadow = null;
    let lastKey = "";

    const destroyAll = () => {
        gridSets.forEach((set) => set.destroy());
        gridSets = [];
        if (shadow) {
            shadow.mesh.destroy();
            shadow.material.destroy();
            shadow.geometry.destroy();
            shadow.texture.destroy();
            shadow = null;
        }
    };

    const build = () => {
        const a = modelsAABB(viewer);
        const box = a || [-50, 0, -50, 50, 0, 50];
        const dx = box[3] - box[0];
        const dz = box[5] - box[2];
        const half = Math.max(MIN_GRID_HALF, Math.max(dx, dz) * GRID_REACH);
        const outerMost = half * SCENE_STYLE.gridBands[SCENE_STYLE.gridBands.length - 1].reach;
        let cell = 1;
        while ((outerMost * 2) / cell > MAX_LINES_PER_SIDE) cell *= 2;
        // Centro alinhado à grade, para as linhas caírem em coordenadas "redondas"
        const centerX = Math.round(((box[0] + box[3]) / 2) / cell) * cell;
        const centerZ = Math.round(((box[2] + box[5]) / 2) / cell) * cell;
        // Nível do piso: o zero do projeto quando ele está dentro do prédio, senão a base do modelo
        const groundY = a && (box[1] > 0 || box[4] < 0) ? box[1] : 0;

        const key = [Math.round(half), cell, centerX, centerZ, groundY.toFixed(2), Math.round(dx), Math.round(dz)].join("|");
        if (key === lastKey) return;
        lastKey = key;
        destroyAll();

        // Grade em faixas: cheia perto do prédio, mais clara nas bordas
        let inner = 0;
        SCENE_STYLE.gridBands.forEach((band, index) => {
            const outer = Math.round((half * band.reach) / cell) * cell;
            if (outer <= inner) return;
            const { positions, indices } = gridBandLines(outer, inner, cell, groundY);
            for (let i = 0; i < positions.length; i += 3) {
                positions[i] += centerX;
                positions[i + 2] += centerZ;
            }
            const set = new LineSet(scene, {
                id: `sceneStyleGrid${index}`,
                positions,
                indices,
                color: SCENE_STYLE.gridColor,
                opacity: band.opacity,
                clippable: false,
                collidable: false
            });
            // Fora da conta do enquadramento: "Vista inicial" enquadra o prédio, não a grade
            if (set._sceneModel && "collidable" in set._sceneModel) set._sceneModel.collidable = false;
            gridSets.push(set);
            inner = outer;
        });

        // Sombra de contato sob o prédio
        if (a) {
            const sx = (dx / 2) * 1.55;
            const sz = (dz / 2) * 1.55;
            const cx = (box[0] + box[3]) / 2;
            const cz = (box[2] + box[5]) / 2;
            const y = groundY - 0.01;
            const texture = new Texture(scene, { src: drawShadowTexture(), flipY: false });
            const geometry = new ReadableGeometry(scene, {
                primitive: "triangles",
                positions: [cx - sx, y, cz - sz, cx + sx, y, cz - sz, cx + sx, y, cz + sz, cx - sx, y, cz + sz],
                normals: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
                uv: [0, 0, 1, 0, 1, 1, 0, 1],
                indices: [0, 2, 1, 0, 3, 2]
            });
            const material = new PhongMaterial(scene, {
                diffuse: [0, 0, 0],
                ambient: [0, 0, 0],
                specular: [0, 0, 0],
                emissive: [1, 1, 1],
                emissiveMap: texture,
                diffuseMap: texture,      // fornece só o alfa (difusa = 0)
                alphaMode: "blend",
                alpha: 1,
                backfaces: true
            });
            const mesh = new Mesh(scene, {
                id: SHADOW_ID,
                isObject: false,
                geometry,
                material,
                pickable: false,
                collidable: false,
                clippable: false,
                edges: false
            });
            shadow = { mesh, material, geometry, texture };
        }
        requestRenderFrame();
    };

    let timer = null;
    const scheduleBuild = () => {
        clearTimeout(timer);
        timer = setTimeout(build, 400);
    };

    scene.on("modelLoaded", scheduleBuild);
    scene.on("modelUnloaded", scheduleBuild);
    build();

    return {
        refresh: () => { lastKey = ""; build(); },
        destroy: destroyAll
    };
}

/** Cores do cubo de navegação no mesmo grafite da interface. */
export const NAV_CUBE_STYLE = Object.freeze({
    color: "#3b4048",
    frontColor: "#434952",
    backColor: "#434952",
    leftColor: "#3b4048",
    rightColor: "#3b4048",
    topColor: "#4d535d",
    bottomColor: "#30343a",
    textColor: "#eef0f3",
    hoverColor: "rgba(255, 255, 255, 0.28)",
    shadowVisible: false
});
