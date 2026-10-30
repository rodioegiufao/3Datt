import {
    Viewer,
    LocaleService,
    XKTLoaderPlugin,
    FastNavPlugin,
    NavCubePlugin
} from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";
import { getProjectConfig } from "./project-config.js";
import { createModelLoader } from "./app/model-format.js";

export const XEOKIT_VERSION = "2.6.107";

function detectLightProfile() {
    const canvas = document.createElement("canvas");
    const webgl2 = Boolean(canvas.getContext("webgl2"));
    const constrained = (navigator.deviceMemory && navigator.deviceMemory <= 4)
        || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    return { webgl2, constrained };
}

export function createViewerCore({
    projectKey = document.body?.dataset?.project,
    onModelProgress = () => {}
} = {}) {
    const profile = detectLightProfile();
    const viewer = new Viewer({
        canvasId: "meuCanvas",
        transparent: false,
        preserveDrawingBuffer: false,
        saoEnabled: false,
        edgesEnabled: !profile.constrained,
        pbrEnabled: false,
        dtxEnabled: profile.webgl2,
        backgroundColor: [0.72, 0.77, 0.82],
        localeService: new LocaleService({ locale: "pt", messages: { pt: { NavCube: {
            front: "Frente", back: "Trás", top: "Topo", bottom: "Baixo", left: "Esquerda", right: "Direita"
        } } } })
    });

    new FastNavPlugin(viewer, {
        hideEdges: true, hideSAO: true, hideColorTexture: true, hidePBR: true,
        scaleCanvasResolution: true, scaleCanvasResolutionFactor: 0.6
    });

    if (profile.webgl2 && document.getElementById("myNavCubeCanvas")) {
        new NavCubePlugin(viewer, { canvasId: "myNavCubeCanvas", visible: true, size: 120 });
    }

    const loader = new XKTLoaderPlugin(viewer);
    // XKT, GLB ou glTF: o formato é escolhido pelo arquivo (app/model-format.js)
    const modelLoader = createModelLoader(viewer, loader);
    const config = getProjectConfig(projectKey, "public");
    const models = new Map();
    let loaded = 0;

    config.models.forEach(({ id, src }) => {
        const edges = !profile.constrained;
        Promise.resolve(modelLoader.load({
            id, src, edges, saoEnabled: false,
            xktOptions: { src, globalizeObjectIds: true, edges, saoEnabled: false, dtxEnabled: profile.webgl2 }
        })).then((model) => watchModel(model, id, src), (error) => {
            loaded += 1;
            onModelProgress({ loaded, total: config.models.length, id, status: "error" });
            console.error(`Erro ao carregar ${src}:`, error);
        });
    });

    function watchModel(model, id, src) {
        models.set(id, model);
        model.on("loaded", () => {
            const transform = config.transforms[id];
            if (transform?.position) model.position = [...transform.position];
            if (transform?.rotation) model.rotation = [...transform.rotation];
            loaded += 1;
            onModelProgress({ loaded, total: config.models.length, id, status: "loaded" });
            if (loaded === config.models.length) viewer.cameraFlight.flyTo(viewer.scene);
        });
        model.on("error", (error) => {
            loaded += 1;
            onModelProgress({ loaded, total: config.models.length, id, status: "error" });
            console.error(`Erro ao carregar ${src}:`, error);
            if (loaded === config.models.length) viewer.cameraFlight.flyTo(viewer.scene);
        });
    }

    const resize = () => {
        viewer.scene.canvas.width = window.innerWidth;
        viewer.scene.canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", resize);
    resize();

    return { viewer, models, config, destroy: () => window.removeEventListener("resize", resize) };
}