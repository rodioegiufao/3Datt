const assert = require("assert");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const bootstrap = read("3D/app.js");
const publicViewer = read("3D/viewer/viewer-public.js");
const core = read("3D/viewer/viewer-core.js");
const { readAuthenticatedViewerSource } = require("./_viewer-source");
const authenticated = readAuthenticatedViewerSource(root);
const measurementsFeature = read("3D/viewer/features/measurements.js");
const annotationsFeature = read("3D/viewer/features/annotations.js");
const eletrodutoAssociationExport = read("3D/eletroduto-association-export.js");

assert.match(bootstrap, /getViewerSession\(\)/);
assert.ok(bootstrap.indexOf("getViewerSession") < bootstrap.indexOf("viewer-authenticated.js"));
assert.match(publicViewer, /class="public-viewer-login"/);
assert.match(publicViewer, /class="public-login-modal"/);
assert.match(publicViewer, /method: "POST"/);
assert.match(publicViewer, /window\.location\.reload\(\)/);
assert.doesNotMatch(publicViewer + core, /xlsx|base_de_dados|excel-export|materials|collision|budget/i);
assert.doesNotMatch(authenticated, /^loadExplicitLinearMaterialsFromExcel\(\);/m);
assert.strictEqual((core.match(/xeokit-sdk@2\.6\.107/g) || []).length, 1);
assert.match(core, /getProjectConfig\(projectKey, "public"\)/);
assert.match(authenticated, /getProjectConfig\(projectFromDataset, "authenticated"\)/);
assert.doesNotMatch(authenticated, /const (?:IPER|FARMACIA|POLICLINICA|CANAA)_MODELS/);
assert.doesNotMatch(authenticated, /const PROJECT_CONFIGS/);
assert.doesNotMatch(authenticated, /import \{ createUserAnnotationsController \}/);
assert.match(authenticated, /import\("\.\.?\/features\/annotations\.js"\)/);
assert.match(authenticated, /import\("\.\.?\/features\/measurements\.js"\)/);
assert.match(authenticated, /const modelLoadPromises = new Map\(\)/);
assert.match(authenticated, /const MODEL_LOAD_CONCURRENCY = 2/);
assert.match(authenticated, /loadModelsWithConcurrency\(currentModels, MODEL_LOAD_CONCURRENCY\)/);
assert.match(authenticated, /const explorerLoadedTabs = new Set\(\)/);
assert.match(authenticated, /explorerLoadedTabs\.clear\(\)/);
assert.match(measurementsFeature, /new AngleMeasurementsPlugin/);
assert.match(annotationsFeature, /createUserAnnotationsController/);
assert.match(eletrodutoAssociationExport, /from "\.\/viewer\/features\/annotations\.js"/);
assert.ok(fs.existsSync(path.join(root, "3D/viewer/features/annotations.js")), "módulo de anotações deve existir no caminho importado");
assert.doesNotMatch(authenticated, /ACCESS_PASSWORD|accessGatePassword|farmacia_access_granted/);
assert.ok(!fs.existsSync(path.join(root, "3D/annotations.js")), "implementação legada de annotations deve ser removida");

for (const html of fs.readdirSync(path.join(root, "3D")).filter((name) => name.endsWith(".html"))) {
    const contents = read(`3D/${html}`);
    assert.doesNotMatch(contents, /<script[^>]+xeokit-sdk/i, `${html} imports xeokit redundantly`);
    if (contents.includes('/3D/app.js')) {
        assert.doesNotMatch(contents, /xlsx\.full|min\.js.*jspdf|user-badge\.js|pyodide\.js|ifc_upload\.js/i,
            `${html} eagerly loads an authenticated dependency`);
    }
}
console.log("viewer loading architecture: ok");
// Regressão: IDs IFC repetidos devem permanecer distintos na cena federada.
const vm = require("node:vm");
// Páginas de projeto: XKT, GLB e glTF pelo carregador único (app/model-format.js), com IDs globalizados no XKT
assert.match(authenticated, /modelLoader\.load\(options\)/);
assert.match(authenticated, /xktOptions:\s*\{[\s\S]*?globalizeObjectIds: true,/);
const modelFormat = read("3D/viewer/app/model-format.js");
assert.match(modelFormat, /GLTFLoaderPlugin/);
assert.match(modelFormat, /xktLoader\.load\(\{ id, xkt: buffer, \.\.\.rest \}\)/);
assert.match(core, /createModelLoader\(viewer, loader\)/);
assert.match(core, /xktOptions: \{ src, globalizeObjectIds: true,/);
assert.match(read("3D/ifc_upload.js"), /bridge\.xktLoader\.load\(\{\s*globalizeObjectIds: true,/);
const objects = {
    "220V#peca-1": { visible: true },
    "380V#peca-1": { visible: true }
};
const scene = {
    objects,
    get visibleObjectIds() { return Object.keys(objects).filter(id => objects[id].visible); },
    setObjectsVisible(ids, visible) { ids.forEach(id => { objects[id].visible = visible; }); },
    setObjectsXRayed() {},
    setObjectsHighlighted() {}
};
const context = vm.createContext({
    viewer: { scene }, modelIsolateController: scene,
    loadedModels: new Map([
        ["220V", { objectIds: ["220V#peca-1"] }],
        ["380V", { objectIds: ["380V#peca-1"] }]
    ]),
    getTreeViewModelCheckbox: () => null,
    isSceneObjectId: id => !!objects[id], expandHierarchy: ids => ids,
    scheduleExplorerRefresh() {}, clearSelection() {}, requestRenderFrame() {}
});
for (const name of ["getModelObjectIds", "isModelVisible", "setModelVisibility"]) {
    const start = authenticated.indexOf(`function ${name}(`);
    const end = authenticated.indexOf("\nfunction ", start + 1);
    vm.runInContext(authenticated.slice(start, end), context);
}
assert.equal(context.setModelVisibility("220V", false), true);
assert.equal(objects["220V#peca-1"].visible, false);
assert.equal(context.isModelVisible("380V"), true);
context.setModelVisibility("380V", false);
assert.equal(scene.visibleObjectIds.length, 0, "ocultar todos não deve deixar peças residuais");
context.setModelVisibility("220V", true);
assert.deepEqual(scene.visibleObjectIds, ["220V#peca-1"]);
console.log("viewer model visibility with duplicate IFC IDs: ok");

// A lista de ocultação inicial continua aceitando o ID original após o prefixo.
context.PROJECT_INITIAL_HIDDEN_IDS = { fecomercio: ["peca-1"] };
context.projectFromDataset = "fecomercio";
context.getAllObjectIds = () => Object.keys(objects);
context.console = { log() {} };
const hiddenStart = authenticated.indexOf("function applyProjectHiddenIds()");
const hiddenEnd = authenticated.indexOf("\nconst PROJECT_ROUTES", hiddenStart);
vm.runInContext(authenticated.slice(hiddenStart, hiddenEnd), context);
context.applyProjectHiddenIds();
assert.equal(scene.visibleObjectIds.length, 0);
console.log("viewer initial hidden IDs with duplicate IFC IDs: ok");