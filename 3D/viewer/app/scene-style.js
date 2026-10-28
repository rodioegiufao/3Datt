// Aparência da cena 3D: fundo em degradê, chão com grade que some na distância,
// sombra de contato sob o prédio, oclusão de ambiente (SAO) e arestas suaves.
// Tudo que define a "cara" da cena fica aqui, num lugar só.
import {
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

    // Chão
    groundTint: "rgba(244, 247, 250, 0.45)",
    gridMinor: "rgba(58, 72, 88, 0.12)",
    gridMajor: "rgba(58, 72, 88, 0.26)",
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

const GROUND_ID = "sceneStyleGround";
const TEXTURE_SIZE = 2048;       // px (1024 em aparelhos fracos)
const MIN_GROUND_SIZE = 80;      // m
const MAX_GROUND_SIZE = 3000;    // m
const GROUND_SCALE = 3;          // chão = 3× o maior lado do prédio
const MAX_CELLS = 220;           // limite de células por lado (mantém as linhas nítidas)

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

function pickCellSize(size) {
    for (const cell of [0.5, 1, 2, 5, 10, 20, 50]) {
        if (size / cell <= MAX_CELLS) return cell;
    }
    return 100;
}

/**
 * Desenha a textura do chão: grade (fina e grossa), tom claro do piso,
 * desvanecimento radial e sombra de contato sob o prédio.
 */
function drawGroundTexture({ size, cell, footprint, textureSize = TEXTURE_SIZE }) {
    const px = textureSize;
    const canvas = document.createElement("canvas");
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext("2d");
    const scale = px / size;          // pixels por metro

    // Piso levemente mais claro que o céu
    ctx.fillStyle = SCENE_STYLE.groundTint;
    ctx.fillRect(0, 0, px, px);

    // Grade: linhas finas a cada célula, grossas a cada 5 células
    const cells = Math.round(size / cell);
    for (let i = 0; i <= cells; i++) {
        const major = i % 5 === 0;
        const p = Math.round(i * cell * scale) + 0.5;
        ctx.strokeStyle = major ? SCENE_STYLE.gridMajor : SCENE_STYLE.gridMinor;
        ctx.lineWidth = major ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(p, 0); ctx.lineTo(p, px);
        ctx.moveTo(0, p); ctx.lineTo(px, p);
        ctx.stroke();
    }

    // Some com a distância: totalmente visível perto do prédio, transparente nas bordas
    ctx.globalCompositeOperation = "destination-in";
    const fade = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
    fade.addColorStop(0, "rgba(0,0,0,1)");
    fade.addColorStop(0.45, "rgba(0,0,0,1)");
    fade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, px, px);
    ctx.globalCompositeOperation = "source-over";

    // Sombra de contato: elipse desfocada do tamanho da planta do prédio
    if (footprint) {
        const cx = footprint.cx * scale;
        const cy = footprint.cy * scale;
        const rx = Math.max(4, footprint.halfX * scale * 1.55);
        const ry = Math.max(4, footprint.halfZ * scale * 1.55);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(rx, ry);
        const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
        shadow.addColorStop(0, SCENE_STYLE.contactShadow);
        shadow.addColorStop(0.55, SCENE_STYLE.contactShadow.replace(/[\d.]+\)$/, (a) => `${(parseFloat(a) * 0.6).toFixed(3)})`));
        shadow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = shadow;
        ctx.beginPath();
        ctx.arc(0, 0, 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    return canvas.toDataURL("image/png");
}

/**
 * Aplica o visual da cena e mantém o chão ajustado ao tamanho dos modelos.
 * Chamado uma vez na inicialização do visualizador.
 */
export function setupSceneStyle({ viewer, requestRenderFrame = () => {}, enableSAO = true, lowPower = false }) {
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

    // Chão com grade e sombra de contato
    let ground = null;
    let lastKey = "";

    const destroyGround = () => {
        if (!ground) return;
        ground.mesh.destroy();
        ground.material.destroy();
        ground.geometry.destroy();
        ground.texture.destroy();
        ground = null;
    };

    const buildGround = () => {
        const a = modelsAABB(viewer);
        // Sem modelos ainda: chão padrão de 100 m em volta da origem
        const box = a || [-50, 0, -50, 50, 0, 50];
        const dx = box[3] - box[0];
        const dz = box[5] - box[2];
        const centerX = (box[0] + box[3]) / 2;
        const centerZ = (box[2] + box[5]) / 2;
        let size = Math.min(MAX_GROUND_SIZE, Math.max(MIN_GROUND_SIZE, Math.max(dx, dz) * GROUND_SCALE));
        const cell = pickCellSize(size);
        size = Math.ceil(size / (cell * 10)) * cell * 10;
        // Nível do chão: o zero do projeto quando ele está dentro do prédio, senão a base do modelo
        const groundY = (a && (box[1] > 0 || box[4] < 0) ? box[1] : 0) - 0.01;

        // Só refaz quando o tamanho/posição muda de verdade (evita refazer a cada modelo)
        const key = [size, cell, Math.round(centerX), Math.round(centerZ), groundY.toFixed(2), Math.round(dx), Math.round(dz)].join("|");
        if (key === lastKey) return;
        lastKey = key;

        const half = size / 2;
        const x0 = Math.round((centerX - half) / cell) * cell;   // alinha a grade em múltiplos da célula
        const z0 = Math.round((centerZ - half) / cell) * cell;

        const footprint = a ? {
            cx: centerX - x0,
            cy: centerZ - z0,
            halfX: dx / 2,
            halfZ: dz / 2
        } : null;

        const src = drawGroundTexture({ size, cell, footprint, textureSize: lowPower ? 1024 : TEXTURE_SIZE });
        destroyGround();

        const positions = [
            x0, groundY, z0,
            x0 + size, groundY, z0,
            x0 + size, groundY, z0 + size,
            x0, groundY, z0 + size
        ];
        const uv = [0, 0, 1, 0, 1, 1, 0, 1];
        const normals = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
        const indices = [0, 2, 1, 0, 3, 2];

        const texture = new Texture(scene, { src, flipY: false });
        const geometry = new ReadableGeometry(scene, { primitive: "triangles", positions, normals, uv, indices });
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
            id: GROUND_ID,
            isObject: false,
            geometry,
            material,
            pickable: false,
            collidable: false,
            clippable: false,
            edges: false
        });
        ground = { mesh, material, geometry, texture };
        requestRenderFrame();
    };

    let timer = null;
    const scheduleBuild = () => {
        clearTimeout(timer);
        timer = setTimeout(buildGround, 400);
    };

    scene.on("modelLoaded", scheduleBuild);
    scene.on("modelUnloaded", scheduleBuild);
    buildGround();

    return {
        refresh: () => { lastKey = ""; buildGround(); },
        destroy: destroyGround
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
