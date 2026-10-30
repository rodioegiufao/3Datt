// app.js Rodrigo Damasceno - 2026

import {
    Viewer,
    LocaleService,
    XKTLoaderPlugin,
    ContextMenu,
    PointerLens,
    NavCubePlugin,
    FastNavPlugin,
    TreeViewPlugin,
    SectionPlanesPlugin,
    LineSet,
    buildGridGeometry
} from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";
import { setupEletrodutoAssociationExportShortcut } from "../eletroduto-association-export.js";
import { getProjectConfig, hasProjectConfig } from "./project-config.js";
import { getViewerPermissions, RESTRICTED_EXPLORER_TABS } from "./core/viewer-permissions.js";
// Módulos do visualizador (funções separadas por área em ./app/)
import { NAV_CUBE_STYLE, setupSceneStyle } from "./app/scene-style.js";
import { setupSectionTools } from "./app/section-tools.js";
import { createModelLoader } from "./app/model-format.js";
import { materialsFeatureAllowed, setupClashLinkFromUrl, setupCollisionPanelControls, setupRestrictedViewerFeaturesAccessGate, transformFeatureAllowed } from "./app/access.js";
import { annotationClickModeEnabled, ensureAnnotationsFeature } from "./app/annotations.js";
import { closePropertyPanel } from "./app/electrical-schedules.js";
import { getSubnetworkObjectIdsForEntity, hideEntity, hideEntitySubnetwork, hideSimilarEntities, isolateEntity, isolateEntitySubnetwork, isolateSimilarEntities, resetXRay, showAllEntities } from "./app/entity-actions.js";
import { activeExplorerTab, circuitTraceFeaturePromise, explorerTabsInitialized, invalidateExplorerCaches, isExplorerTabAllowed, resetModelVisibility, scheduleExplorerRefresh, setActiveExplorerTab } from "./app/explorer.js";
import { setupHelpPanel } from "./app/help.js";
import { resolveMetaObject, resolveSceneObjectId } from "./app/ifc-meta.js";
import { findMaterialObjectIds, formatMaterialQuantity, generateAndRenderMaterialsList, getActiveSectionPlanes, isolateActiveWebBudgetSelection, isolateAssociatedItemsByName, isolateMaterialByName, isolateMaterialsByNames, updateMaterialsActiveItem } from "./app/materials.js";
import { renderMaterialsIdsList, resetMaterialsIdsPanel, setupMaterialsPanelControls, updateMaterialsDownloadButton } from "./app/materials-panel.js";
import { angleMeasurementsMouseControl, distanceMeasurementsMouseControl, setMeasurementMode } from "./app/measurements.js";
import { activeProjectKey, handleConfiguredProjectSelection, handleModelSelection, handleProjectSelectChange, loadModelsWithConcurrency, maybeFinalizeInitialization } from "./app/model-loading.js";
import { closePanelsOnEscape, hideBudgetPanel, setupDraggablePanels } from "./app/panels.js";
import { applyModelRenderProfile, applyPerformanceMode, getStoredPerformanceModePreference, goToHomeView, performanceModeEnabled, requestRenderFrame, setupHomeViewButton, setupTouchNavigation, startAutoPerformanceMonitor, syncNavCubeVisibility, togglePerformanceMode } from "./app/performance.js";
import { openProjectBudget } from "./app/project-budget.js";
import { showMaterialProperties } from "./app/properties-panel.js";
import { getAllObjectIds, getNextCloneId, getObjectMetaModelId, resolveEntityById, resolveRotationTargetId } from "./app/scene-objects.js";
import { setSearchStatus, setupSearchControls } from "./app/search.js";
import { downloadCurrentViewScreenshot } from "./app/snapshots.js";
import { applyTransformFromUI, registerModelTransform, removeModelOption, resetTransformFromUI, setDefaultCollisionSelection, setupTransformPanelControls, syncTransformInputs } from "./app/transform.js";
import { modelIsolateController, toggleSectionPlane, toggleTreeView } from "./app/treeview-section.js";
import { formatModelLabel, openWebBudgetPanel, webBudgetRowsContainer, webBudgetSummary } from "./app/web-budget.js";


const viewerUser = window.__VIEWER_AUTH_USER__;
const isClientProfile = viewerUser?.perfil === "cliente";
export const { jsPDF } = window.jspdf;
let horizontalPlaneControl; // NOVO: Variável para rastrear a entidade selecionada
export let lastSelectedEntity = null;
const MAX_MEASUREMENT_HISTORY = 100;
const measurementUndoStack = [];
const measurementRedoStack = [];
let isApplyingMeasurementHistory = false;

function detectViewerCompatibility() {
    const tempCanvas = document.createElement("canvas");
    const supportsWebGL2 = !!tempCanvas.getContext("webgl2");
    const supportsWebGL =
        supportsWebGL2 ||
        !!tempCanvas.getContext("webgl") ||
        !!tempCanvas.getContext("experimental-webgl");

    const isTouchDevice =
        window.matchMedia?.("(pointer: coarse)")?.matches ||
        /Android|iPhone|iPad|iPod|Mobile|Tablet/i.test(navigator.userAgent || "");

    const lowMemoryDevice =
        typeof navigator.deviceMemory === "number" && navigator.deviceMemory <= 4;
    const lowCpuDevice =
        typeof navigator.hardwareConcurrency === "number" && navigator.hardwareConcurrency <= 4;

    const useCompatibilityMode =
        !supportsWebGL2 ||
        lowMemoryDevice ||
        lowCpuDevice;

    const reasons = [];

    if (!supportsWebGL) {
        reasons.push("WebGL indisponível");
    } else if (!supportsWebGL2) {
        reasons.push("WebGL2 indisponível");
    }

    if (isTouchDevice) {
        reasons.push("dispositivo touch");
    }

    if (lowMemoryDevice) {
        reasons.push("memória reduzida");
    }

    if (lowCpuDevice) {
        reasons.push("CPU reduzida");
    }

    const enableDataTextures = supportsWebGL2 && !useCompatibilityMode;
    const enableNavCube = supportsWebGL2 && !isTouchDevice;

    return {
        supportsWebGL,
        supportsWebGL2,
        isTouchDevice,
        useCompatibilityMode,
        disableSAO: useCompatibilityMode,
        disableEdges: useCompatibilityMode,
        enableDataTextures,
        enableNavCube,
        reasons
    };
}

export const viewerCompatibility = detectViewerCompatibility();
export const defaultRenderProfile = Object.freeze({
    saoEnabled: !viewerCompatibility.disableSAO,
    edgesEnabled: !viewerCompatibility.disableEdges
});

// -----------------------------------------------------------------------------
// 1. Configuração do Viewer e Redimensionamento (100% da tela)
// -----------------------------------------------------------------------------

export const viewer = new Viewer({

    canvasId: "meuCanvas",
    preserveDrawingBuffer: true,
    transparent: true, // o fundo em degradê fica atrás do canvas (ver app/scene-style.js)
    saoEnabled: !viewerCompatibility.disableSAO,
    edgesEnabled: !viewerCompatibility.disableEdges,
    pbrEnabled: false,
    dtxEnabled: viewerCompatibility.enableDataTextures,
    backgroundColor: [0.72, 0.77, 0.82],

    // CONFIGURAÇÃO DE LOCALIZAÇÃO (NavCube em Português)
    localeService: new LocaleService({
        messages: {
            "pt": { // Português
                "NavCube": {
                    "front": "Frente",
                    "back": "Trás",
                    "top": "Topo",
                    "bottom": "Baixo",
                    "left": "Esquerda",
                    "right": "Direita"
                }
            }
        },
        locale: "pt" // Define o idioma padrão como Português
     })
});

export const fastNavPlugin = new FastNavPlugin(viewer, {
    hideEdges: true,
    hideSAO: true,
    hideColorTexture: true,
    hidePBR: true,
    scaleCanvasResolution: true,
    defaultScaleCanvasResolutionFactor: 1,
    scaleCanvasResolutionFactor: 0.6,
    delayBeforeRestore: true,
    delayBeforeRestoreSeconds: 0.35
});

if (!viewerCompatibility.supportsWebGL) {
    console.error("Este dispositivo não oferece suporte a WebGL, necessário para abrir os modelos 3D.");
} else if (viewerCompatibility.useCompatibilityMode) {
    console.warn(
        `Modo de compatibilidade 3D ativado (${viewerCompatibility.reasons.join(", ")}). ` +
        "SAO, realce de arestas e shaders mais pesados foram reduzidos para evitar falhas em celulares/tablets."
    );
}

// Ajusta a cor do destaque (highlight) para azul
const { highlightMaterial } = viewer.scene;
highlightMaterial.color = [0, 0, 0];
highlightMaterial.edgeColor = [0, 0, 0];

// Fundo, chão com grade, sombra de contato, SAO e arestas (app/scene-style.js)
setupSceneStyle({ viewer, requestRenderFrame, enableSAO: !viewerCompatibility.disableSAO });
// Excel é carregado somente quando uma ferramenta de materiais/orçamento o solicita.
setupEletrodutoAssociationExportShortcut({ viewer, setSearchStatus, requestRenderFrame, focusObjectById });


function onWindowResize() {
    const canvas = viewer.scene.canvas;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

window.addEventListener('resize', onWindowResize);
onWindowResize();

// -----------------------------------------------------------------------------
// 2. Carregamento dos Modelos e Ajuste da Câmera
// -----------------------------------------------------------------------------

const xktDataSource = {
    getXKT(src, ok, error) {
        const resolvedSrc = normalizeBlobUrl(src);

        fetch(resolvedSrc)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Falha HTTP ${response.status} ao baixar XKT.`);
                }
                return response.arrayBuffer();
            })
            .then((arrayBuffer) => ok(arrayBuffer))
            .catch((fetchError) => {
                if (typeof error === "function") {
                    error(fetchError?.message || fetchError);
                }
            });
    }
};

export const xktLoader = new XKTLoaderPlugin(viewer, {
    dataSource: xktDataSource
});
// Carregador único das páginas de projeto: XKT, GLB e glTF
const modelLoader = createModelLoader(viewer, xktLoader);
function normalizeBlobUrl(src) {
    if (typeof src !== "string") {
        return src;
    }

    return src.startsWith("blob:") ? src.split("?")[0] : src;
}

let modelsLoadedCount = 0;
let expectedModels = 0;
let defaultModelChecksDone = 0;
export let currentModels = [];
export let lastMaterialsResults = [];  // NOVO
export let activeMaterialFilter = null;
export let activeWebBudgetSelection = null;
const rotationShortcutKey = "j";
export const rotatedEntityAliases = new Map();
export const hiddenOriginalEntityIds = new Set();
export const loadedModels = new Map();
const modelLoadPromises = new Map();
export const MODEL_LOAD_CONCURRENCY = 2;
export const originalTransforms = new Map();
export let currentModelTransforms = {};

export const helpPanel = document.getElementById("helpPanel");
export const helpPanelToggleButton = document.getElementById("btnHelp");
export const performanceModeToggleButton = document.getElementById("btnPerformanceMode");
export const treeViewContainer = document.getElementById("treeViewContainer");
export const treeViewContent = document.getElementById("treeViewContent");
const closeTreeViewButton = document.getElementById("closeTreeView");
export const toggleTreeViewSelectionButton = document.getElementById("toggleTreeViewSelection");
const toggleTreeViewButton = document.getElementById("btnToggleTree");
export const treeViewTitleElement = treeViewContainer?.querySelector(".tree-view-title");
export const treeViewSubtitleElement = treeViewContainer?.querySelector(".tree-view-subtitle");
export const EXPLORER_TAB_DEFINITIONS = [
    { id: "models", label: "Modelos", subtitle: "Modelos carregados" },
    { id: "objects", label: "Objetos", subtitle: "Objetos para focar e inspecionar" },
    { id: "classes", label: "Classes", subtitle: "Classes IFC para isolar" },
    { id: "storeys", label: "Pavimentos", subtitle: "Pavimentos para isolar" },
    { id: "networks", label: "Redes", subtitle: "Modelos agrupados por rede" },
    { id: "parts", label: "Peças", subtitle: "Peças por classe, tipo e nome" }
];
export let allowedExplorerTabs = new Set(RESTRICTED_EXPLORER_TABS);
export let explorerTabButtons = new Map();
export let objectModelIdLookup = new Map();
export let normalizedSceneObjectIdLookup = new Map();
const EXPLORER_HOVER_THROTTLE_MS = 40;
export const transformPanel = document.getElementById("transformPanel");
export const transformPanelToggleButton = document.getElementById("btnTransformPanel");
export const transformModelSelect = document.getElementById("transformModelSelect");
const applyTransformButton = document.getElementById("applyTransformButton");
const resetTransformButton = document.getElementById("resetTransformButton");
export const collisionPanel = document.getElementById("collisionPanel");
export const collisionPanelToggleButton = document.getElementById("btnCollisionPanel");
const closeCollisionPanelButton = document.getElementById("closeCollisionPanel");
export const collisionModelASelect = document.getElementById("collisionModelA");
const runCollisionCheckButton = document.getElementById("runCollisionCheck");
export const collisionSummary = document.getElementById("collisionSummary");
export const collisionResultsList = document.getElementById("collisionResults");
export const materialsPanel = document.getElementById("materialsPanel");
export const materialsPanelToggleButton = document.getElementById("btnMaterialsPanel");
export const generateMaterialsButton = document.getElementById("generateMaterialsList");
export const materialsSummary = document.getElementById("materialsSummary");
export const materialsResultsList = document.getElementById("materialsResults");
export const materialsSearchInput = document.getElementById("materialsSearchInput");
export const materialsIdsPanel = document.getElementById("materialsIdsPanel");
export const materialsIdsSummary = document.getElementById("materialsIdsSummary");
export const searchBar = document.getElementById("searchBar");
export const searchInput = document.getElementById("searchIdInput");
export const budgetPanel = document.getElementById("budgetPanel");
export const budgetPanelToggleButton = document.getElementById("btnBudget");
const closeBudgetPanelButton = document.getElementById("closeBudgetPanel");

setupHelpPanel();
setupRestrictedViewerFeaturesAccessGate();
if (!isClientProfile) {
    setupTransformPanelControls();
    setupCollisionPanelControls();
    setupMaterialsPanelControls();
}
setupSearchControls();
setupDraggablePanels();
setupClashLinkFromUrl();
performanceModeToggleButton?.addEventListener("click", () => togglePerformanceMode());
{
    const storedPerformancePreference = getStoredPerformanceModePreference();
    // Sem escolha do usuário: aparelhos fracos já começam no modo leve
    applyPerformanceMode(storedPerformancePreference ?? viewerCompatibility.useCompatibilityMode, { persist: false });
    if (storedPerformancePreference === null && !performanceModeEnabled) {
        window.addEventListener("viewer:models-loaded", startAutoPerformanceMonitor, { once: true });
    }
}
setupTouchNavigation();
setupHomeViewButton();
setupSectionTools();
// Tutorial "Conheça o visualizador": convite na primeira visita e botão na Ajuda
import("./features/tour/tour.js")
    .then(({ setupTour }) => setupTour({
        firstModelReady: new Promise((resolve) => {
            if (Object.keys(viewer.scene.models || {}).length) resolve();
            else viewer.scene.once("modelLoaded", () => resolve());
        }),
        // Quem chega por link de interferência vai direto ao assunto
        skipWelcome: new URLSearchParams(window.location.search).has("interferencia")
    }))
    .catch((error) => console.warn("[tutorial] Não foi possível carregar:", error));

export function setExplorerTabsAccess(tabIds) {
    const knownTabIds = new Set(EXPLORER_TAB_DEFINITIONS.map(({ id }) => id));
    allowedExplorerTabs = new Set((tabIds || []).filter((id) => knownTabIds.has(id)));
    allowedExplorerTabs.add("models");

    if (!explorerTabsInitialized) {
        return;
    }

    explorerTabButtons.forEach((button, id) => {
        const isAllowed = isExplorerTabAllowed(id);
        button.hidden = !isAllowed;
        button.setAttribute("aria-hidden", String(!isAllowed));
    });

    setActiveExplorerTab(activeExplorerTab);
}

function rotateEntityWithCloneAlias(sourceId) {
    if (!transformFeatureAllowed) {
        return null;
    }
    const requestedId = String(sourceId || "").trim();
    const baseAliasEntry = rotatedEntityAliases.get(requestedId);
    const normalizedSourceId = baseAliasEntry?.sourceId || requestedId;
    const entity = resolveEntityById(requestedId);

    if (!entity?.isObject) {
        setSearchStatus(`Não foi possível rotacionar: peça ${normalizedSourceId} não encontrada.`, true);
        return null;
    }

    const cloneId = getNextCloneId(normalizedSourceId);
    const entityRotation = Array.isArray(entity.rotation)
        ? [...entity.rotation]
        : (ArrayBuffer.isView(entity.rotation) ? Array.from(entity.rotation) : [0, 0, 0]);
    const currentRotation = [
        entityRotation[0] ?? 0,
        entityRotation[1] ?? 0,
        entityRotation[2] ?? 0
    ];

    // Aplicação da transformação linear de rotação em 90º no eixo Y.
    currentRotation[1] = ((currentRotation[1] + 90) % 360 + 360) % 360;

    entity.rotation = currentRotation;
    entity.visible = true;

    rotatedEntityAliases.set(cloneId, {
        entity,
        sourceId: normalizedSourceId,
        copiedProperties: {
            visible: entity.visible,
            colorize: Array.isArray(entity.colorize) ? [...entity.colorize] : entity.colorize,
            opacity: entity.opacity,
            rotation: currentRotation
        }
    });

    hiddenOriginalEntityIds.add(normalizedSourceId);
    lastSelectedEntity = entity;
    requestRenderFrame();

    setSearchStatus(`Rotação aplicada: ${normalizedSourceId} ocultado e alias ${cloneId} criado.`);
    return cloneId;
}

export function renderWebBudgetRows(materials) {
    if (!webBudgetRowsContainer || !webBudgetSummary) {
        return;
    }

    webBudgetRowsContainer.innerHTML = "";

    if (!materials.length) {
        webBudgetSummary.textContent = "Nenhum item para exibir.";
        return;
    }

    webBudgetSummary.textContent = `${materials.length} associação(ões) da planilha web. Itens separados por modelo XKT.`;

    const fragment = document.createDocumentFragment();
    let currentGroupModel = null;
    materials.forEach((item) => {
        if (item.modelId !== currentGroupModel) {
            currentGroupModel = item.modelId;
            const groupRow = document.createElement("tr");
            groupRow.className = "web-budget-group-row";
            const groupCell = document.createElement("td");
            groupCell.colSpan = 5;
            groupCell.textContent = `${formatModelLabel(item.modelId)}:`;
            groupRow.appendChild(groupCell);
            fragment.appendChild(groupRow);
        }
        const sourceMaterialNames = Array.isArray(item.sourceMaterialNames) && item.sourceMaterialNames.length
            ? item.sourceMaterialNames
            : [item.name];
        const ids = Array.from(new Set(
            sourceMaterialNames
                .flatMap((materialName) => findMaterialObjectIds(materialName, { activeOnly: false }))
                .filter((id) => getObjectMetaModelId(id) === item.modelId)
        ));
        const tr = document.createElement("tr");
        tr.setAttribute("role", "button");
        tr.setAttribute("tabindex", "0");
        tr.title = `Localizar ${item.descricao} no modelo`;
        tr.innerHTML = `
            <td>${item.codigo || "-"}</td>
            <td>${item.base || "-"}</td>
            <td>${item.descricao}</td>
            <td>${item.unidade || "-"}</td>
            <td class="numeric">${formatMaterialQuantity(item.quantidade)}</td>
        `;

        const handleRowSelection = () => {
            activeMaterialFilter = sourceMaterialNames.length === 1 ? sourceMaterialNames[0] : item.descricao;
            activeWebBudgetSelection = {
                modelId: item.modelId,
                materialNames: sourceMaterialNames,
                descricao: item.descricao
            };
            isolateMaterialsByNames(sourceMaterialNames, { modelId: item.modelId });
            updateMaterialsActiveItem();
            if (sourceMaterialNames.length === 1) {
                renderMaterialsIdsList(sourceMaterialNames[0]);
            } else {
                resetMaterialsIdsPanel();
                if (materialsIdsSummary) {
                    materialsIdsSummary.textContent = `${item.descricao} (${formatModelLabel(item.modelId)}): ${ids.length} ID(s) vinculados em ${sourceMaterialNames.length} item(ns) associado(s).`;
                }
            }
            webBudgetSummary.textContent = `${formatModelLabel(item.modelId)} · ${item.descricao}: ${formatMaterialQuantity(item.quantidade)} ${item.unidade || "unid."}. Itens localizados no modelo.`;
        };

        tr.addEventListener("click", handleRowSelection);
        tr.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleRowSelection();
            }
        });

        fragment.appendChild(tr);
    });

    webBudgetRowsContainer.appendChild(fragment);
}

export function focusObjectById(objectId, { animate = true, xrayOthers = true } = {}) {
    if (!modelIsolateController || !objectId) {
        return false;
    }

    const targetId = resolveSceneObjectId(objectId) || String(objectId).trim();
    const allIds = getAllObjectIds();

    if (!allIds.includes(targetId)) {
        return false;
    }

    const aliasEntry = rotatedEntityAliases.get(targetId);
    const sceneTargetId = aliasEntry?.sourceId || targetId;

    modelIsolateController.setObjectsVisible(allIds, true);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    if (xrayOthers && allIds.length) {
        modelIsolateController.setObjectsXRayed(allIds, true);
    } else {
        modelIsolateController.setObjectsXRayed(allIds, false);
    }

    modelIsolateController.setObjectsXRayed([sceneTargetId], false);
    modelIsolateController.setObjectsHighlighted([sceneTargetId], true);

    const entity = resolveEntityById(targetId);
    if (entity) {
        lastSelectedEntity = entity;
    }

    const aabb = viewer.scene.getAABB(sceneTargetId);
    if (aabb) {
        if (animate) {
            viewer.cameraFlight.flyTo({ aabb, duration: 0.6 });
        } else {
            viewer.cameraFlight.jumpTo({ aabb });
        }
    }

    requestRenderFrame();

    if (entity && document.getElementById("propertyPanel")) {
        showMaterialProperties(entity);
    }

    return true;
}

export function adjustCameraOnLoad() {
    modelsLoadedCount++;
    maybeFinalizeInitialization();
}

export function loadDefaultModel({ id, src }) {
    if (loadedModels.has(id)) {
        return Promise.resolve(loadedModels.get(id));
    }
    if (modelLoadPromises.has(id)) {
        return modelLoadPromises.get(id);
    }
    defaultModelChecksDone++;
    expectedModels++;

    const promise = new Promise((resolve, reject) => {
        const edges = performanceModeEnabled ? false : defaultRenderProfile.edgesEnabled;
        const saoEnabled = performanceModeEnabled ? false : defaultRenderProfile.saoEnabled;
        const options = {
            id, src, edges, saoEnabled,
            xktOptions: {
                src,
                // IDs IFC são locais ao arquivo; prefixar evita colisões entre disciplinas.
                globalizeObjectIds: true,
                edges,
                saoEnabled,
                dtxEnabled: viewerCompatibility.enableDataTextures
            }
        };
        const attach = (model) => {
            model.uploadDateSrc = src;
            model.on("loaded", () => {
                const transform = currentModelTransforms[id];
                if (transform?.position) model.position = [...transform.position];
                if (transform?.rotation) model.rotation = [...transform.rotation];
                adjustCameraOnLoad();
                registerModelTransform(model);
                resolve(model);
            });
            model.on("error", reject);
        };

        try {
            // XKT, GLB ou glTF: o carregador escolhe pelo formato do arquivo (app/model-format.js)
            Promise.resolve(modelLoader.load(options)).then(attach, reject);
        } catch (error) {
            reject(error);
        }
    }).finally(() => modelLoadPromises.delete(id));
    modelLoadPromises.set(id, promise);
    return promise;
}

export function loadModelGroup(models, transforms) {
    currentModels = models;
    currentModelTransforms = transforms;
    modelsLoadedCount = 0;
    expectedModels = 0;
    defaultModelChecksDone = 0;

    void loadModelsWithConcurrency(currentModels, MODEL_LOAD_CONCURRENCY)
        .then(() => window.dispatchEvent(new CustomEvent("viewer:models-loaded")))
        .catch(() => {});
}
const selectIperModelsButton = document.getElementById("selectIperModels");
const selectPoliclinicaModelsButton = document.getElementById("selectPoliclinicaModels");
const selectFarmaciaModelsButton = document.getElementById("selectFarmaciaModels");
const selectLacenModelsButton = document.getElementById("selectLacenModels");
const selectCanaaModelsButton = document.getElementById("selectCanaaModels");
const selectPublicProject = document.getElementById("selectPublicProject");
const selectPrivateProject = document.getElementById("selectPrivateProject");
export const projectFromDataset = document.body?.dataset?.project;

export function clearAllLoadedModels() {
    loadedModels.forEach((model) => {
        if (typeof model.destroy === "function") {
            model.destroy();
        }
    });

    loadedModels.clear();
    objectModelIdLookup.clear();
    normalizedSceneObjectIdLookup.clear();
    invalidateExplorerCaches();
    originalTransforms.clear();
    currentModels = [];
    currentModelTransforms = {};
    scheduleExplorerRefresh(0);
}

const ifcUploadBridge = {
    viewer,
    xktLoader,
    viewerCompatibility,
    normalizeBlobUrl,
    requestRenderFrame,
    ensureAnnotationsFeature,
    adjustCameraOnLoad,
    registerModelTransform,
    applyModelRenderProfile,
    getPerformanceModeEnabled: () => performanceModeEnabled,
    getDefaultRenderProfile: () => defaultRenderProfile,
    updateExpectedModels: (count = 1) => {
        expectedModels += count;
        defaultModelChecksDone += count;
    },
    addUploadedModelRecord: (modelId, fileName, file = null) => {
        // file: o arquivo do computador (Blob). Sem ele, quem precisar reler a geometria
        // tentaria baixar "fileName" do servidor e receberia 404.
        currentModels = [...currentModels, { id: modelId, src: fileName, file }];
    },
    removeUploadedModelRecord: (modelId) => {
        if (!modelId) {
            return;
        }

        const model = loadedModels.get(modelId);
        if (model && typeof model.destroy === "function") {
            model.destroy();
        }

        loadedModels.delete(modelId);
        originalTransforms.delete(modelId);
        currentModels = currentModels.filter((currentModel) => currentModel.id !== modelId);
        circuitTraceFeaturePromise?.then((feature) => feature?.forgetModel?.(modelId));
        objectModelIdLookup.clear();
        normalizedSceneObjectIdLookup.clear();
        invalidateExplorerCaches();

        removeModelOption(transformModelSelect, modelId);
        removeModelOption(collisionModelASelect, modelId);

        if (transformModelSelect && transformModelSelect.options.length > 0) {
            transformModelSelect.value = transformModelSelect.options[0].value;
            syncTransformInputs(transformModelSelect.value);
        }

        setDefaultCollisionSelection();
        scheduleExplorerRefresh(0);
        requestRenderFrame();
    },
    setUploadStatus: (message, isError = false) => {
        const uploadStatusElement = document.getElementById("ifcUploadStatus");
        if (!uploadStatusElement) {
            return;
        }

        uploadStatusElement.textContent = message;
        uploadStatusElement.style.color = isError ? "#fecaca" : "#cbd5e1";
    }
};

window.ifcUploadBridge = ifcUploadBridge;

if (selectIperModelsButton) {
    selectIperModelsButton.addEventListener("click", () => {
        handleConfiguredProjectSelection("iper");
    });
}

if (selectPoliclinicaModelsButton) {
    selectPoliclinicaModelsButton.addEventListener("click", () => {
        handleConfiguredProjectSelection("policlinica");
    });
}

if (selectFarmaciaModelsButton) {
    selectFarmaciaModelsButton.addEventListener("click", () => {
        handleConfiguredProjectSelection("farmacia");
    });
}

if (selectLacenModelsButton) {
    selectLacenModelsButton.addEventListener("click", () => {
        handleConfiguredProjectSelection("lacen");
    });
}

if (selectCanaaModelsButton) {
    selectCanaaModelsButton.addEventListener("click", () => {
        handleConfiguredProjectSelection("esc_canaa");
    });
}

if (selectPublicProject) {
    selectPublicProject.addEventListener("change", handleProjectSelectChange);
}

if (selectPrivateProject) {
    selectPrivateProject.addEventListener("change", handleProjectSelectChange);
}

if (projectFromDataset && hasProjectConfig(projectFromDataset)) {
    const { models, transforms } = getProjectConfig(projectFromDataset, "authenticated");
    handleModelSelection(models, transforms, projectFromDataset, { replaceUrl: true });
}

if (!isClientProfile && transformModelSelect) {
    transformModelSelect.addEventListener("change", (event) => syncTransformInputs(event.target.value));
}

if (!isClientProfile && applyTransformButton) {
    applyTransformButton.addEventListener("click", applyTransformFromUI);
}

if (!isClientProfile && resetTransformButton) {
    resetTransformButton.addEventListener("click", resetTransformFromUI);
}

// -----------------------------------------------------------------------------
// Suporte a toque para medições (ângulo e distância)
// -----------------------------------------------------------------------------
// Os controles de medição originais funcionam apenas com eventos de mouse.
// Para tablets e celulares, convertemos eventos de toque em eventos de mouse
// equivalentes, garantindo que as ferramentas de medir funcionem via toque.
(function enableTouchForMeasurements() {
    const canvasElement = viewer.scene.canvas.canvas;
    const TAP_MAX_MOVE = 10;
    const TAP_MAX_MS = 450;
    let touchActive = false;
    let emulatingDrag = false;
    let start = null;

    // Ferramentas que precisam do "mouse" para funcionar no toque
    const clickToolActive = () =>
        Boolean(angleMeasurementsMouseControl?.active) ||
        Boolean(distanceMeasurementsMouseControl?.active) ||
        annotationClickModeEnabled;

    const dispatchMouseEvent = (type, touch) => {
        const eventInit = {
            clientX: touch.clientX,
            clientY: touch.clientY,
            screenX: touch.screenX,
            screenY: touch.screenY,
            bubbles: true,
            cancelable: true
        };
        canvasElement.dispatchEvent(new MouseEvent(type, eventInit));
    };

    canvasElement.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) {
            // Segundo dedo: deixa a câmera cuidar do gesto (mover / pinçar)
            if (emulatingDrag && start) dispatchMouseEvent('mouseup', start);
            touchActive = false;
            emulatingDrag = false;
            return;
        }

        const touch = event.touches[0];
        touchActive = true;
        start = { clientX: touch.clientX, clientY: touch.clientY, screenX: touch.screenX, screenY: touch.screenY, time: performance.now() };
        // Fora das ferramentas de clique, o arraste de um dedo é só da câmera (girar).
        // Antes, o arraste também virava "mouse" e a câmera girava em dobro.
        emulatingDrag = clickToolActive();
        if (emulatingDrag) {
            dispatchMouseEvent('mousemove', touch);
            dispatchMouseEvent('mousedown', touch);
        }
        event.preventDefault();
    }, { passive: false });

    canvasElement.addEventListener('touchmove', (event) => {
        if (!touchActive || event.touches.length !== 1) {
            return;
        }

        if (emulatingDrag) {
            dispatchMouseEvent('mousemove', event.touches[0]);
        }
        event.preventDefault();
    }, { passive: false });

    canvasElement.addEventListener('touchend', (event) => {
        if (!touchActive) {
            return;
        }

        const touch = event.changedTouches[0];
        const moved = Math.hypot(touch.clientX - start.clientX, touch.clientY - start.clientY);
        const isTap = moved <= TAP_MAX_MOVE && performance.now() - start.time <= TAP_MAX_MS;
        if (emulatingDrag) {
            dispatchMouseEvent('mouseup', touch);
            dispatchMouseEvent('click', touch);
        } else if (isTap) {
            // Toque rápido continua valendo como clique (seleção, anotação, mira de câmera)
            dispatchMouseEvent('mousemove', touch);
            dispatchMouseEvent('mousedown', touch);
            dispatchMouseEvent('mouseup', touch);
            dispatchMouseEvent('click', touch);
        }
        touchActive = false;
        emulatingDrag = false;
        event.preventDefault();
    }, { passive: false });

    canvasElement.addEventListener('touchcancel', () => {
        if (!touchActive) {
            return;
        }

        if (emulatingDrag) {
            dispatchMouseEvent('mouseup', { clientX: 0, clientY: 0, screenX: 0, screenY: 0 });
        }
        touchActive = false;
        emulatingDrag = false;
    });
})();
// -----------------------------------------------------------------------------
// Função utilitária: Limpa qualquer seleção, destaque ou estado de botão ativo
// -----------------------------------------------------------------------------
export function clearSelection(removeButtonHighlight = true) {
    try {
        // Remove seleção de qualquer entidade
        if (viewer.scene && viewer.scene.selectedObjectIds) {
            viewer.scene.setObjectsSelected(viewer.scene.selectedObjectIds, false);
        }

        // Limpa a referência da última seleção
        lastSelectedEntity = null;

        // Remove destaque visual (highlight)
        if (viewer.scene && viewer.scene.highlightedObjectIds) {
            viewer.scene.setObjectsHighlighted(viewer.scene.highlightedObjectIds, false);
        }

        // Opcionalmente remove destaque do botão ativo
        if (removeButtonHighlight) {
            document.querySelectorAll('.tool-button').forEach(btn => btn.classList.remove('active'));
        }
    } catch (e) {
        console.warn("⚠️ clearSelection(): falhou ao limpar seleção:", e);
    }
}

function selectEntity(entity) {
    if (!entity || !entity.isObject) {
        return;
    }

    // Remove seleções anteriores e marca a nova entidade
    clearSelection(false);
    entity.selected = true;
    lastSelectedEntity = entity;

    if (document.getElementById("propertyPanel")) {
        showMaterialProperties(entity);
    }
}

window.setMeasurementMode = setMeasurementMode;

const CAIXA_GORDURA_DUPLA_DESCRICAO = "CAIXA DE GORDURA DUPLA (CAPACIDADE: 126 L), RETANGULAR, EM ALVENARIA COM TIJOLOS CERÂMICOS MACIÇOS, DIMENSÕES INTERNAS = 0,4X0,7 M, ALTURA INTERNA = 0,8 M. AF_12/2020";
const CAIXA_GORDURA_SIMPLES_DESCRICAO = "CAIXA DE GORDURA SIMPLES (CAPACIDADE: 36L), RETANGULAR, EM ALVENARIA COM TIJOLOS CERÂMICOS MACIÇOS, DIMENSÕES INTERNAS = 0,2X0,4 M, ALTURA INTERNA = 0,8 M. AF_12/2020";
export const CAIXA_GORDURA_VALOR_MATERIAL_MAP = Object.freeze({
    "0.192265": CAIXA_GORDURA_DUPLA_DESCRICAO,
    "0.094248": CAIXA_GORDURA_SIMPLES_DESCRICAO
});

export function clearMaterialIsolation() {
    activeMaterialFilter = null;
    activeWebBudgetSelection = null;
    resetModelVisibility();
    updateMaterialsActiveItem();
    resetMaterialsIdsPanel();
}

export function renderMaterialsResults(items, options = {}) {
    if (!materialsSummary || !materialsResultsList) {
        return;
    }

    const totalCount = Number.isFinite(options.totalCount) ? options.totalCount : items.length;
    const query = options.query || "";

    if (!items.length) {
        lastMaterialsResults = [];
        updateMaterialsDownloadButton();
        if (totalCount > 0 && query) {
            materialsSummary.textContent = `Nenhum material encontrado para "${query}".`;
        } else {
            materialsSummary.textContent = "Nenhuma propriedade quantitativa encontrada nos modelos carregados.";
        }
        materialsResultsList.innerHTML = "";
        resetMaterialsIdsPanel();
        return;
    }

    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);
    const allInMeters = items.length > 0 && items.every((item) => item.unitLabel === "metro(s)");
    const totalUnit = allInMeters ? "metro(s)" : "item(ns)";
    const baseSummary = `${items.length} material(is) consolidado(s)${getActiveSectionPlanes().length ? " (só o que está à vista no corte)" : ""}`;
    const filterHint = query && totalCount !== items.length ? ` de ${totalCount} (filtro: "${query}")` : "";
    materialsSummary.textContent = `${baseSummary}${filterHint}. Clique em um material para isolar no modelo (clique novamente para limpar).`;
    lastMaterialsResults = items;
    updateMaterialsDownloadButton()

    materialsResultsList.innerHTML = "";

    items.forEach((item) => {
        const li = document.createElement("li");
        li.className = "materials-result-item";
        li.dataset.materialName = item.name;
        li.setAttribute("role", "button");
        li.setAttribute("tabindex", "0");
        li.setAttribute("title", "Clique para isolar os elementos com este material");
        li.innerHTML = `
            <span class="materials-result-name">${item.name}</span>
            <span class="materials-result-quantity">${formatMaterialQuantity(item.quantity)} ${item.unitLabel}</span>
        `;
        const handleMaterialClick = () => {
            if (activeMaterialFilter === item.name) {
                clearMaterialIsolation();
                return;
            }

            activeMaterialFilter = item.name;
            isolateMaterialByName(item.name);
            updateMaterialsActiveItem();
            if (materialsIdsPanel && !materialsIdsPanel.hidden) {
                renderMaterialsIdsList(item.name);
            }
        };
        li.addEventListener("click", handleMaterialClick);
        li.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleMaterialClick();
            }
        });
        materialsResultsList.appendChild(li);
    });

    updateMaterialsActiveItem();
}

function isEditableKeyboardTarget(target) {
    return target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
}

function isScreenshotShortcut(event) {
    return event.key === "9" || event.code === "Digit9" || event.code === "Numpad9" || event.keyCode === 57 || event.keyCode === 105;
}

document.addEventListener("keydown", async (event) => {
    const key = event.key?.toLowerCase();
    const isTyping = isEditableKeyboardTarget(event.target);

    if (isTyping && key !== "escape") {
        return;
    }

    if (event.repeat) {
        return;
    }

    if (key === "escape") {
        setMeasurementMode("none");
        closePropertyPanel();
        closePanelsOnEscape();
        return;
    }

    if (key === "z" && materialsFeatureAllowed && materialsPanel && !materialsPanel.hidden) {
        event.preventDefault();
        openWebBudgetPanel();
        return;
    }

    if (key === "r") {
        resetXRay();
        return;
    }

    if (key === "m") {
        showAllEntities();
        return;
    }

    if (key === "h") {
        goToHomeView();
        return;
    }

    if (key === "g") {
        togglePerformanceMode();
        return;
    }

    if (key === "l") {
        if (!materialsFeatureAllowed) return;
        if (materialsPanel) {
            materialsPanel.hidden = false;
            materialsPanelToggleButton?.classList.add("active");
            await generateAndRenderMaterialsList();
        }
        return;
    }
    if (key === "t") {
        if (!materialsFeatureAllowed) return;
        if (materialsPanel) {
            materialsPanel.hidden = false;
            materialsPanelToggleButton?.classList.add("active");
        }
        renderMaterialsIdsList(activeMaterialFilter);
        return;
    }
     if (key === "k") {
        if (activeMaterialFilter) {
            isolateAssociatedItemsByName(activeMaterialFilter);
            updateMaterialsActiveItem();
        }
        return;
    }

    if (key === "7") {
        if (!materialsFeatureAllowed) return;
        if (isolateActiveWebBudgetSelection()) {
            const { modelId, descricao } = activeWebBudgetSelection;
            if (webBudgetSummary) {
                webBudgetSummary.textContent = `${formatModelLabel(modelId)} · ${descricao}: isolamento por modelo XKT aplicado.`;
            }
        }
        return;
    }

    if (isScreenshotShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        downloadCurrentViewScreenshot();
        return;
    }

    if (key === rotationShortcutKey) {
        if (!transformFeatureAllowed) return;
        const selectedSourceId = resolveRotationTargetId();

        if (!selectedSourceId) {
            setSearchStatus("Selecione uma peça (duplo clique), deixe o cursor sobre ela ou informe o ID na busca antes de usar o atalho J.", true);
            return;
        }

        rotateEntityWithCloneAlias(selectedSourceId);
        return;
    }
    // Atalhos de entidade: requerem uma seleção prévia (duplo clique)
    if (!lastSelectedEntity) {
        return;
    }
    // Atalhos de entidade: requerem uma seleção prévia (duplo clique)
    if (!lastSelectedEntity) {
        return;
    }

    if (key === "i") {
        isolateEntity(lastSelectedEntity);
    } else if (key === "p") {
        showMaterialProperties(lastSelectedEntity);
    } else if (key === "o" && activeProjectKey !== "esc_canaa") {
        hideEntity(lastSelectedEntity);
    }
});

if (budgetPanelToggleButton) {
    budgetPanelToggleButton.addEventListener("click", () => {
        if (budgetPanel?.hidden) {
            openProjectBudget();
            return;
        }

        hideBudgetPanel();
    });
}

closeBudgetPanelButton?.addEventListener("click", () => {
    hideBudgetPanel();
});
// -----------------------------------------------------------------------------
// 4. Menu de Contexto (Deletar Medição) (MANTIDO)
// -----------------------------------------------------------------------------

export const contextMenu = new ContextMenu({
    items: [
        [
            {
                title: "Deletar Medição",
                doAction: function (context) {
                    context.measurement.destroy();
                }
            }
        ]
    ]
});


// -----------------------------------------------------------------------------
// 5. Cubo de Navegação (NavCube) (MANTIDO)
// -----------------------------------------------------------------------------

if (viewerCompatibility.enableNavCube) {
    new NavCubePlugin(viewer, {
        canvasId: "myNavCubeCanvas",
        visible: true,
        size: 150,
        alignment: "bottomRight",
        bottomMargin: 20,
        rightMargin: 20,
        ...NAV_CUBE_STYLE
    });
}

syncNavCubeVisibility();

// EXPOR AO ESCOPO GLOBAL para ser chamado pelo 'onclick' do HTML
window.toggleTreeView = toggleTreeView;
window.resetModelVisibility = resetModelVisibility;

closeTreeViewButton?.addEventListener("click", () => {
    toggleTreeView(toggleTreeViewButton);
});

window.toggleSectionPlane = toggleSectionPlane;

// -----------------------------------------------------------------------------
// 8. Destaque de Entidades ao Passar o Mouse (Hover Highlight)
// -----------------------------------------------------------------------------

export let lastEntity = null;
let pendingHoverCoords = null;
let hoverFrameHandle = null;
let lastHoverPickAt = 0;

function clearHoverHighlight() {
    if (lastEntity) {
        lastEntity.highlighted = false;
        lastEntity = null;
    }
}

function processHoverHighlight() {
    hoverFrameHandle = null;

    if (!pendingHoverCoords) {
        clearHoverHighlight();
        return;
    }

    const now = performance.now();
    const elapsed = now - lastHoverPickAt;
    if (elapsed < EXPLORER_HOVER_THROTTLE_MS) {
        hoverFrameHandle = window.requestAnimationFrame(processHoverHighlight);
        return;
    }

    const hit = viewer.scene.pick({
        canvasPos: pendingHoverCoords
    });

    if (hit && hit.entity && hit.entity.isObject) {
        if (!lastEntity || hit.entity.id !== lastEntity.id) {

            clearHoverHighlight();
            lastEntity = hit.entity;
            hit.entity.highlighted = true;
        }
        return;
    }
    clearHoverHighlight();
}

// Monitora o movimento do mouse sobre o canvas
viewer.scene.input.on("mousemove", function (coords) {
    pendingHoverCoords = coords;

    if (!hoverFrameHandle) {
        hoverFrameHandle = window.requestAnimationFrame(processHoverHighlight);
    }
});

// -----------------------------------------------------------------------------
// 8.1 Seleção por Duplo Clique
// -----------------------------------------------------------------------------

viewer.cameraControl.on("doublePicked", (pickResult) => {
    const entity = pickResult?.entity;

    if (entity && entity.isObject) {
        selectEntity(entity);
    }
});

viewer.cameraControl.on("doublePickedNothing", () => {
    clearSelection();
});

// -----------------------------------------------------------------------------
// 9. Menu de Contexto (Propriedades + Visibilidade + X-Ray) - VERSÃO FINAL
// -----------------------------------------------------------------------------

// Desabilita o pan com o botão direito (para permitir o menu)
viewer.cameraControl.panRightClick = false;

// ---- Racks de cabeamento estruturado — NOVO
export const RACK_LENGTH_LIMIT_M = 90;

// Cria o menu de contexto
const materialContextMenu = new ContextMenu({
    enabled: true,
    items: [
        [
            {
                title: "Propriedades do Material",
                doAction: function (context) {
                    showMaterialProperties(context.entity);
                }
            },
            {
                title: "Add Anotação",
                doAction: async function (context) {
                    const text = window.prompt("Digite o texto da anotação:");
                    if (!text || !text.trim()) {
                        return;
                    }
                    const controller = await ensureAnnotationsFeature();
                    controller.addAnnotationFromPickResult(context.pickResult, text);
                }
            }
        ],
        [
            {
                title: "Ocultar",
                getEnabled: (context) => context.entity.visible,
                doAction: (context) => {
                    hideEntity(context.entity);
                }
            },
            {
                title: "Ocultar Similares",
                getEnabled: (context) => context.entity.visible,
                doAction: (context) => {
                    hideSimilarEntities(context.entity);
                }
            },
            {
                title: "Isolar Similares",
                doAction: (context) => {
                    isolateSimilarEntities(context.entity);
                }
            },
            {
                title: "Ocultar Subrede",
                getEnabled: (context) => getSubnetworkObjectIdsForEntity(context.entity).length > 0,
                doAction: (context) => {
                    hideEntitySubnetwork(context.entity);
                }
            },
            {
                title: "Isolar Subrede",
                getEnabled: (context) => getSubnetworkObjectIdsForEntity(context.entity).length > 0,
                doAction: (context) => {
                    isolateEntitySubnetwork(context.entity);
                }
            },
            {
                title: "Isolar",
                doAction: (context) => {
                    isolateEntity(context.entity);
                }
            },
            {
                title: "Ocultar Todos",
                getEnabled: (context) => context.viewer.scene.numVisibleObjects > 0,
                doAction: (context) => {
                    context.viewer.scene.setObjectsVisible(context.viewer.scene.visibleObjectIds, false);
                }
            },
            {
                title: "Mostrar Todos",
                getEnabled: (context) => {
                    const scene = context.viewer.scene;
                    return scene.numVisibleObjects < scene.numObjects;
                },
                doAction: showAllEntities
            }
        ],
        [
            {
                title: "Aplicar X-Ray",
                getEnabled: (context) => !context.entity.xrayed,
                doAction: (context) => {
                    context.entity.xrayed = true;
                }
            },
            {
                title: "Remover X-Ray",
                getEnabled: (context) => context.entity.xrayed,
                doAction: (context) => {
                    context.entity.xrayed = false;
                }
            },
            {
                title: "X-Ray em Outros",
                doAction: (context) => {
                    const scene = context.viewer.scene;
                    const entity = context.entity;
                    const metaObject = resolveMetaObject(entity.id);
                    if (!metaObject) return;
                    scene.setObjectsVisible(scene.objectIds, true);
                    scene.setObjectsXRayed(scene.objectIds, true);
                    metaObject.withMetaObjectsInSubtree((mo) => {
                        const e = scene.objects[mo.id];
                        if (e) e.xrayed = false;
                    });
                }
            },
            {
                title: "Redefinir X-Ray",
                getEnabled: (context) => context.viewer.scene.numXRayedObjects > 0,
                doAction: (context) => {
                    context.viewer.scene.setObjectsXRayed(context.viewer.scene.xrayedObjectIds, false);
                }
            }
        ]
    ]
});
function pickEntityForContextMenu(canvasPos) {
    const pickOptions = {
        canvasPos,
        pickSurface: true
    };
    const surfaceHit = viewer.scene.pick(pickOptions);

    if (surfaceHit?.entity?.isObject) {
        return surfaceHit;
    }

    return viewer.scene.pick({
        canvasPos
    });
}
function showEntityContextMenu(pageX, pageY) {
    const canvasElement = viewer.scene.canvas.canvas;
    const canvasRect = canvasElement.getBoundingClientRect();
    const canvasPos = [pageX - canvasRect.left, pageY - canvasRect.top];
    const hit = pickEntityForContextMenu(canvasPos);

    if (hit?.entity?.isObject) {
        materialContextMenu.context = { viewer, entity: hit.entity, pickResult: hit };
        materialContextMenu.show(pageX, pageY);
        return true;
    }
    return false;
}

function handleCanvasContextMenuEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    showEntityContextMenu(event.clientX, event.clientY);
}

// Captura o clique direito no canvas antes do controle de câmera consumir o evento.
const contextMenuCanvas = viewer.scene.canvas.canvas;
contextMenuCanvas.addEventListener('contextmenu', handleCanvasContextMenuEvent, true);
contextMenuCanvas.addEventListener('pointerdown', (event) => {
    if (event.button === 2) {
        event.preventDefault();
        event.stopPropagation();
    }
}, true);
contextMenuCanvas.addEventListener('pointerup', (event) => {
    if (event.button === 2) {
        handleCanvasContextMenuEvent(event);
    }
}, true);

// Suporte a toque: abre o menu ao manter o dedo pressionado sobre o objeto
(() => {
    const canvasElement = viewer.scene.canvas.canvas;
    const longPressDuration = 600;
    const moveThreshold = 10;
    let touchTimeout = null;
    let touchStartPos = null;
    let menuOpened = false;

    const clearTouch = () => {
        if (touchTimeout) {
            clearTimeout(touchTimeout);
            touchTimeout = null;
        }
        touchStartPos = null;
        menuOpened = false;
    };

    canvasElement.addEventListener('touchstart', (event) => {
        if (event.touches.length !== 1) {
            clearTouch();
            return;
        }

        const touch = event.touches[0];
        touchStartPos = { x: touch.clientX, y: touch.clientY };
        menuOpened = false;

        touchTimeout = setTimeout(() => {
            menuOpened = true;
            showEntityContextMenu(touchStartPos.x, touchStartPos.y);
        }, longPressDuration);
    }, { passive: true });

    canvasElement.addEventListener('touchmove', (event) => {
        if (!touchStartPos || event.touches.length !== 1) {
            clearTouch();
            return;
        }

        const touch = event.touches[0];
        const dx = touch.clientX - touchStartPos.x;
        const dy = touch.clientY - touchStartPos.y;
        if (Math.sqrt(dx * dx + dy * dy) > moveThreshold) {
            clearTouch();
        }
    }, { passive: true });

    const endTouch = (event) => {
        if (menuOpened) {
            event.preventDefault();
        }
        clearTouch();
    };

    canvasElement.addEventListener('touchend', endTouch, { passive: false });
    canvasElement.addEventListener('touchcancel', clearTouch, { passive: true });

})();
