// Substituição local de modelos: o colaborador troca um modelo do projeto por um XKT ou IFC do
// próprio computador para conferir colisões, cobertura etc. Nada é enviado ao servidor:
// a troca vale só nesta aba e some ao recarregar a página (ou com "Restaurar original").

const XEOKIT_URL = "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";
// Versão do web-ifc usada nos exemplos oficiais do xeokit 2.6.x
const WEB_IFC_VERSION = "0.0.51";
const WEB_IFC_BASE = `https://cdn.jsdelivr.net/npm/web-ifc@${WEB_IFC_VERSION}/`;
const ACCEPTED_EXTENSIONS = ["xkt", "ifc"];

const STYLE = `
.model-replace-toast{position:fixed;left:16px;bottom:70px;z-index:300010;max-width:min(420px,calc(100vw - 32px));padding:10px 14px;border-radius:8px;background:rgba(20,28,38,.94);color:#fff;font:13px/1.45 Arial,sans-serif;box-shadow:0 6px 16px rgba(0,0,0,.35)}
.model-replace-toast[hidden]{display:none}
.model-replace-toast.is-error{background:rgba(127,29,29,.95)}
.model-replace-toast.is-done{background:rgba(20,83,45,.95)}
`;

export function createModelReplaceFeature({
    viewer,
    xktLoader,
    getModel,                 // (id) => SceneModel carregado
    getOriginalSource,        // (id) => src original do projeto (XKT no servidor)
    getLoadOptions = () => ({}),
    registerModel,            // (model) => registra no visualizador (Explorer, Origem e Rotação, compatibilização…)
    unregisterModel,          // (id) => remove dos registros antes de destruir
    onChanged = () => {}
}) {
    const scene = viewer.scene;
    const replaced = new Map();   // id -> { fileName, format, objectUrl, loadedAt }
    const originals = new Map();  // id -> src original
    let ifcLoaderPromise = null;
    let busy = false;

    if (!document.getElementById("modelReplaceStyle")) {
        const style = document.createElement("style");
        style.id = "modelReplaceStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }
    const toast = document.createElement("div");
    toast.className = "model-replace-toast";
    toast.setAttribute("role", "status");
    toast.hidden = true;
    document.body.appendChild(toast);
    let toastTimer = null;

    function showToast(text, { kind = "", autoHide = false } = {}) {
        window.clearTimeout(toastTimer);
        toast.textContent = text;
        toast.className = `model-replace-toast${kind ? ` is-${kind}` : ""}`;
        toast.hidden = false;
        if (autoHide) toastTimer = window.setTimeout(() => { toast.hidden = true; }, 6000);
    }

    // -----------------------------------------------------------------------
    // Carregadores
    // -----------------------------------------------------------------------
    function getIfcLoader() {
        ifcLoaderPromise ||= (async () => {
            const [{ WebIFCLoaderPlugin }, WebIFC] = await Promise.all([
                import(XEOKIT_URL),
                import(`${WEB_IFC_BASE}web-ifc-api.js`)
            ]);
            const IfcAPI = new WebIFC.IfcAPI();
            IfcAPI.SetWasmPath(WEB_IFC_BASE, true);
            await IfcAPI.Init();
            return new WebIFCLoaderPlugin(viewer, { WebIFC, IfcAPI });
        })().catch((error) => {
            ifcLoaderPromise = null;
            throw error;
        });
        return ifcLoaderPromise;
    }

    /** Chama o carregador e espera o modelo terminar (ou falhar). */
    function loadAndWait(loader, params) {
        return new Promise((resolve, reject) => {
            let model = null;
            let settled = false;
            const finish = (callback, value) => {
                if (settled) return;
                settled = true;
                scene.off(subscription);
                callback(value);
            };
            // Ouve na cena antes de chamar load(): o IFC pode terminar dentro da própria chamada
            // O aviso da cena só vale enquanto load() ainda não retornou (IFC terminando dentro da chamada).
            // Depois disso, valem os eventos do próprio modelo — assim um aviso atrasado de um modelo
            // anterior com o mesmo id não é confundido com o novo.
            let returned = false;
            const subscription = scene.on("modelLoaded", (loadedId) => {
                if (!returned && loadedId === params.id) finish(resolve, scene.models[params.id]);
            });
            try {
                model = loader.load(params);
            } catch (error) {
                finish(reject, error);
                return;
            }
            returned = true;
            model?.on?.("loaded", () => finish(resolve, model));
            model?.on?.("error", (error) => finish(reject, error instanceof Error ? error : new Error(String(error))));
            if (model?.loaded) finish(resolve, model);
        });
    }

    function snapshotTransform(model) {
        return {
            position: model?.position ? Array.from(model.position) : [0, 0, 0],
            rotation: model?.rotation ? Array.from(model.rotation) : [0, 0, 0]
        };
    }

    function applyTransform(model, transform) {
        if (transform.position) model.position = [...transform.position];
        if (transform.rotation) model.rotation = [...transform.rotation];
    }

    function dropModel(id) {
        unregisterModel(id);
        const model = getModel(id) || scene.models[id];
        model?.destroy?.();
    }

    async function loadOriginal(id, transform) {
        const src = originals.get(id) || getOriginalSource(id);
        if (!src) throw new Error(`Arquivo original de ${id} não encontrado.`);
        const model = await loadAndWait(xktLoader, {
            id,
            src,
            globalizeObjectIds: true,
            ...getLoadOptions()
        });
        applyTransform(model, transform);
        registerModel(model);
        return model;
    }

    // -----------------------------------------------------------------------
    // Substituir / restaurar
    // -----------------------------------------------------------------------
    async function replaceModel(id, file) {
        if (busy) throw new Error("Já existe uma substituição em andamento.");
        const extension = String(file?.name || "").split(".").pop().toLowerCase();
        if (!ACCEPTED_EXTENSIONS.includes(extension)) {
            throw new Error("Use um arquivo .xkt ou .ifc.");
        }

        busy = true;
        const current = getModel(id);
        const transform = snapshotTransform(current);
        if (!originals.has(id)) originals.set(id, getOriginalSource(id));
        const previous = replaced.get(id);

        try {
            let loader = xktLoader;
            const params = {
                id,
                globalizeObjectIds: true,
                // geometria legível: a compatibilização e a cobertura leem direto deste modelo
                readableGeometryEnabled: true,
                ...getLoadOptions()
            };
            let objectUrl = null;

            if (extension === "ifc") {
                showToast(`Preparando o leitor de IFC…`);
                loader = await getIfcLoader();
                showToast(`Lendo ${file.name}… (arquivos grandes podem travar a tela por alguns segundos)`);
                params.ifc = await file.arrayBuffer();
                params.excludeTypes = ["IfcSpace", "IfcOpeningElement"];
                params.loadMetadata = true;
            } else {
                objectUrl = URL.createObjectURL(file);
                params.src = objectUrl;
                showToast(`Carregando ${file.name}…`);
            }

            dropModel(id);
            if (previous?.objectUrl) URL.revokeObjectURL(previous.objectUrl);
            replaced.delete(id);

            let model;
            try {
                model = await loadAndWait(loader, params);
            } catch (error) {
                if (objectUrl) URL.revokeObjectURL(objectUrl);
                // Não deixa o projeto sem o modelo: volta para o original
                scene.models[id]?.destroy?.();
                try {
                    await loadOriginal(id, transform);
                } catch (restoreError) {
                    console.error("[substituir modelo] Falha ao restaurar o original:", restoreError);
                }
                throw error;
            }

            applyTransform(model, transform);
            model.localReplacement = { fileName: file.name, format: extension.toUpperCase(), loadedAt: new Date() };
            replaced.set(id, { ...model.localReplacement, objectUrl });
            registerModel(model);
            onChanged(id);
            showToast(`✓ ${id} substituído por ${file.name} (só nesta sessão).`, { kind: "done", autoHide: true });
            return model;
        } catch (error) {
            onChanged(id);
            showToast(`Não foi possível substituir ${id}: ${error?.message || error}`, { kind: "error", autoHide: true });
            throw error;
        } finally {
            busy = false;
        }
    }

    async function restoreModel(id) {
        if (busy || !replaced.has(id)) return null;
        busy = true;
        const transform = snapshotTransform(getModel(id));
        const entry = replaced.get(id);
        try {
            showToast(`Restaurando o modelo original de ${id}…`);
            dropModel(id);
            if (entry?.objectUrl) URL.revokeObjectURL(entry.objectUrl);
            replaced.delete(id);
            const model = await loadOriginal(id, transform);
            onChanged(id);
            showToast(`✓ ${id} voltou ao arquivo do projeto.`, { kind: "done", autoHide: true });
            return model;
        } catch (error) {
            onChanged(id);
            showToast(`Não foi possível restaurar ${id}: ${error?.message || error}`, { kind: "error", autoHide: true });
            throw error;
        } finally {
            busy = false;
        }
    }

    /** Abre o seletor de arquivo e substitui o modelo. */
    function pickAndReplace(id) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".xkt,.ifc";
        input.onchange = () => {
            const file = input.files?.[0];
            if (file) replaceModel(id, file).catch((error) => console.error("[substituir modelo]", error));
        };
        input.click();
    }

    return {
        pickAndReplace,
        replaceModel,
        restoreModel,
        isReplaced: (id) => replaced.has(id),
        getReplacement: (id) => replaced.get(id) || null,
        isBusy: () => busy
    };
}
