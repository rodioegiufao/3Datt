// Abrir uma pasta inteira de modelos (IFC/XKT/GLB) e vigiar atualizações.
//
// O navegador não permite abrir um caminho digitado (ex.: \\Servidor\...). O jeito oficial é o seletor
// de pasta (File System Access API, Chrome/Edge): o usuário escolhe a pasta uma vez — inclusive de rede,
// colando o caminho na barra de endereço da janela do Windows — e o site pode ler e vigiar os arquivos.
// Nada é enviado ao servidor.

const MODEL_EXTENSIONS = [".xkt", ".ifc", ".glb"];
const POLL_INTERVAL_MS = 5000;
const DB_NAME = "ifc-folder-watch";
const STORE = "handles";
const LAST_KEY = "lastFolder";

const STYLE = `
.folder-watch-actions{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:8px;margin:2px 0 0}
.folder-watch-actions button{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:var(--ui-radius-sm,7px);padding:0 14px;background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1);font:600 13px var(--ui-font,system-ui,sans-serif);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.folder-watch-actions button:hover:not(:disabled){background:rgba(255,255,255,.12)}
.folder-watch-actions button[hidden]{display:none}
.folder-watch-actions button:disabled{opacity:.45;cursor:default}
.folder-watch-actions svg,.folder-share-title svg{width:16px;height:16px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.folder-watch-hint{font-size:11.5px!important;color:var(--ui-text-muted,rgba(236,238,241,.58))!important;text-align:center;margin:0!important}
.folder-watch-chip{position:fixed;right:16px;bottom:16px;z-index:300020;display:flex;align-items:center;gap:8px;padding:6px 6px 6px 12px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:999px;background:var(--ui-surface,rgba(26,28,32,.92));color:var(--ui-text,#eceef1);font:500 12px/1.3 var(--ui-font,system-ui,sans-serif);box-shadow:var(--ui-shadow,0 10px 30px rgba(10,12,16,.28));backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)}
.folder-watch-chip[hidden]{display:none}
.folder-watch-chip .dot{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.22)}
.folder-watch-chip.is-paused .dot{background:#f2b94b;box-shadow:0 0 0 3px rgba(242,185,75,.22)}
.folder-watch-chip button{height:26px;border:none;border-radius:999px;padding:0 10px;background:var(--ui-raised,rgba(255,255,255,.08));color:var(--ui-text,#eceef1);cursor:pointer;font:600 11.5px var(--ui-font,system-ui,sans-serif)}
.folder-watch-chip button:hover{background:rgba(255,255,255,.16)}
.folder-watch-dialog{position:fixed;right:16px;bottom:64px;z-index:300021;width:min(380px,calc(100vw - 32px));box-sizing:border-box;padding:16px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:var(--ui-radius-lg,14px);background:var(--ui-surface-solid,#1a1c20);color:var(--ui-text,#eceef1);font:400 13px/1.45 var(--ui-font,system-ui,sans-serif);box-shadow:var(--ui-shadow,0 10px 30px rgba(10,12,16,.28))}
.folder-watch-dialog[hidden]{display:none}
.folder-watch-dialog h3{margin:0 0 6px;font-size:15px;font-weight:600}
.folder-watch-dialog ul{list-style:none;margin:8px 0;padding:0;max-height:220px;overflow:auto}
.folder-watch-dialog li label{display:flex;gap:8px;align-items:flex-start;padding:4px 0;cursor:pointer}
.folder-watch-dialog li small{display:block;color:var(--ui-text-muted,rgba(236,238,241,.58))}
.folder-watch-dialog input[type=checkbox]{accent-color:var(--ui-active-bg,#eceef1)}
.folder-watch-dialog .buttons{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}
.folder-watch-dialog .buttons button{height:34px;border:1px solid var(--ui-active-bg,#eceef1);border-radius:7px;padding:0 14px;font:600 12.5px var(--ui-font,system-ui,sans-serif);cursor:pointer;background:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c)}
.folder-watch-dialog .buttons button.secondary{border-color:var(--ui-border,rgba(255,255,255,.1));background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1)}
.folder-share-section{margin-top:12px;padding:12px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid var(--ui-border,rgba(255,255,255,.08));display:grid;gap:8px}
.folder-share-title{display:flex;align-items:center;gap:6px;font-weight:600;font-size:13px}
.folder-share-title small{font-weight:400;color:var(--ui-text-muted,rgba(236,238,241,.58))}
.folder-share-path{width:100%;box-sizing:border-box;height:36px;padding:0 10px;border-radius:7px;border:1px solid var(--ui-border,rgba(255,255,255,.08));background:rgba(0,0,0,.28);color:var(--ui-text,#eceef1);font:400 13px var(--ui-font,system-ui,sans-serif)}
.folder-share-generate{height:36px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:7px;padding:0 12px;background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1);font:600 13px var(--ui-font,system-ui,sans-serif);cursor:pointer}
.folder-share-generate:hover:not(:disabled){background:rgba(255,255,255,.12)}
.folder-share-generate:disabled{opacity:.45;cursor:default}
.folder-share-note{margin:0;font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58))}
.folder-share-banner{margin:4px 0;padding:12px;border-radius:10px;background:rgba(143,193,255,.1);color:var(--ui-text,#eceef1);border:1px solid rgba(143,193,255,.35);font-size:13px;text-align:left}
.folder-share-banner p{margin:6px 0;text-align:left!important}
.folder-share-path-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.folder-share-path-row code{flex:1;min-width:0;overflow-wrap:anywhere;background:rgba(0,0,0,.3);padding:5px 8px;border-radius:6px;font-size:12px}
.folder-share-path-row button{height:30px;border:none;border-radius:7px;padding:0 12px;background:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c);font:600 12px var(--ui-font,system-ui,sans-serif);cursor:pointer}
`;
const FOLDER_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>';
const REOPEN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';

const isModelFile = (name = "") => MODEL_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext));
const baseName = (name = "") => name.replace(/\.[^/.]+$/, "").toLowerCase();
const extensionOf = (name = "") => (name.toLowerCase().match(/\.[^/.]+$/) || [""])[0];
const formatTime = (ms) => new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });

// ---------------------------------------------------------------------------
// IndexedDB: lembra a última pasta (o navegador pede permissão de novo ao reabrir)
// ---------------------------------------------------------------------------
function openDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function dbGet(key) {
    try {
        const db = await openDb();
        return await new Promise((resolve, reject) => {
            const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (_error) {
        return null;
    }
}

async function dbSet(key, value) {
    try {
        const db = await openDb();
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(STORE, "readwrite");
            transaction.objectStore(STORE).put(value, key);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error);
        });
    } catch (_error) {
        // sem IndexedDB: só não lembra a pasta
    }
}

/**
 * Escolhe quais arquivos carregar: modelos da pasta (sem subpastas). Se existir o mesmo nome em
 * .xkt e .ifc, fica só o .xkt (carrega muito mais rápido e evita o modelo duplicado).
 * entries: [{ name, ... }] — devolve a mesma lista filtrada e ordenada.
 */
export function pickModelEntries(entries) {
    const models = entries.filter((entry) => isModelFile(entry.name));
    const xktBases = new Set(models.filter((entry) => extensionOf(entry.name) === ".xkt").map((entry) => baseName(entry.name)));
    return models
        .filter((entry) => extensionOf(entry.name) === ".xkt" || !xktBases.has(baseName(entry.name)))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * Compara o estado anterior com o atual da pasta.
 * previous/current: Map nome -> { lastModified, size }
 * Devolve { changed: [nome], added: [nome], removed: [nome] }.
 */
export function diffFolderState(previous, current) {
    const changed = [], added = [], removed = [];
    for (const [name, info] of current) {
        const before = previous.get(name);
        if (!before) added.push(name);
        else if (before.lastModified !== info.lastModified || before.size !== info.size) changed.push(name);
    }
    for (const name of previous.keys()) if (!current.has(name)) removed.push(name);
    return { changed, added, removed };
}

// ---------------------------------------------------------------------------
// Link de pasta: a "receita" (pasta, caminho, arquivos, posição/rotação, câmera) vai no próprio link,
// compactada. Nenhum arquivo é enviado; quem abre escolhe a mesma pasta do servidor.
// ---------------------------------------------------------------------------
const SHARE_HASH_KEY = "pasta";
const PATH_STORAGE_PREFIX = "folderSharePath:";

const toBase64Url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromBase64Url = (text) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));

async function streamBytes(bytes, transform) {
    const stream = new Blob([bytes]).stream().pipeThrough(transform);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Codifica a receita para o link. Usa compactação quando o navegador permite (prefixo "z."). */
export async function encodeFolderShare(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (typeof CompressionStream === "function") {
        return `z.${toBase64Url(await streamBytes(bytes, new CompressionStream("deflate-raw")))}`;
    }
    return `j.${toBase64Url(bytes)}`;
}

export async function decodeFolderShare(text) {
    const [kind, data] = [text.slice(0, 2), text.slice(2)];
    let bytes = fromBase64Url(data);
    if (kind === "z.") bytes = await streamBytes(bytes, new DecompressionStream("deflate-raw"));
    else if (kind !== "j.") throw new Error("Link de pasta inválido.");
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload?.v !== 1 || !Array.isArray(payload.models)) throw new Error("Link de pasta inválido.");
    return payload;
}

const round = (value, digits = 4) => Math.round(Number(value || 0) * 10 ** digits) / 10 ** digits;

export function setupFolderWatch(api) {
    const supportsPicker = typeof window.showDirectoryPicker === "function";
    let directoryHandle = null;
    let tracked = new Map();      // nome -> { handle, file, lastModified, size }
    let dismissed = new Map();    // nome -> lastModified recusado ("agora não")
    let pollTimer = null;
    let paused = false;
    let checking = false;
    let dialogOpen = false;
    let pendingShare = null;      // receita recebida pelo link, aguardando a pasta

    // -----------------------------------------------------------------------
    // Interface
    // -----------------------------------------------------------------------
    if (!document.getElementById("folderWatchStyle")) {
        const style = document.createElement("style");
        style.id = "folderWatchStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }

    const uploadPanel = document.getElementById("ifcUploadPanel");
    const dropzone = uploadPanel?.querySelector(".ifc-upload-dropzone");
    const actions = document.createElement("div");
    actions.className = "folder-watch-actions";
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.innerHTML = `${FOLDER_ICON}<span>Abrir pasta</span>`;
    openButton.title = "Carregar todos os IFC/XKT/GLB de uma pasta e avisar quando algum for atualizado";
    const reopenButton = document.createElement("button");
    reopenButton.type = "button";
    reopenButton.className = "secondary";
    reopenButton.hidden = true;
    actions.append(openButton, reopenButton);
    const hint = document.createElement("p");
    hint.className = "folder-watch-hint";
    hint.textContent = supportsPicker
        ? "Dica: na janela de pasta, cole o caminho de rede (ex.: \\\\Servidor\\...\\IFCs) na barra de endereço."
        : "Seu navegador só abre a pasta uma vez, sem vigiar atualizações. Para vigiar, use Chrome ou Edge.";
    if (dropzone) dropzone.after(actions, hint);
    else uploadPanel?.append(actions, hint);

    // Botão também no painel de modelos (ao lado de "Adicionar modelos")
    const shareActions = document.querySelector(".share-upload-actions");
    const shareOpenButton = document.createElement("button");
    shareOpenButton.type = "button";
    shareOpenButton.textContent = "Abrir pasta";
    shareActions?.appendChild(shareOpenButton);

    // Link da pasta, no painel "Compartilhar modelos"
    const shareSection = document.createElement("div");
    shareSection.className = "folder-share-section";
    shareSection.innerHTML = `
        <div class="folder-share-title">${FOLDER_ICON}Link da pasta <small>sem enviar arquivos, não expira</small></div>
        <input type="text" class="folder-share-path" placeholder="Caminho na rede, ex.: \\\\Servidor\\...\\IFCs" aria-label="Caminho da pasta na rede">
        <button type="button" class="folder-share-generate">Gerar link da pasta</button>
        <p class="folder-share-note"></p>`;
    const sharePathInput = shareSection.querySelector(".folder-share-path");
    const shareGenerateButton = shareSection.querySelector(".folder-share-generate");
    const shareNote = shareSection.querySelector(".folder-share-note");
    shareActions?.after(shareSection);

    // Aviso para quem recebeu um link de pasta
    const shareBanner = document.createElement("div");
    shareBanner.className = "folder-share-banner";

    const fallbackInput = document.createElement("input");
    fallbackInput.type = "file";
    fallbackInput.webkitdirectory = true;
    fallbackInput.multiple = true;
    fallbackInput.hidden = true;
    document.body.appendChild(fallbackInput);

    const chip = document.createElement("div");
    chip.className = "folder-watch-chip";
    chip.hidden = true;
    chip.setAttribute("role", "status");
    const chipDot = document.createElement("span");
    chipDot.className = "dot";
    const chipText = document.createElement("span");
    const chipCheck = document.createElement("button");
    chipCheck.type = "button";
    chipCheck.textContent = "Verificar agora";
    const chipPause = document.createElement("button");
    chipPause.type = "button";
    const chipStop = document.createElement("button");
    chipStop.type = "button";
    chipStop.textContent = "✕";
    chipStop.title = "Parar de vigiar a pasta";
    chip.append(chipDot, chipText, chipCheck, chipPause, chipStop);
    document.body.appendChild(chip);

    const dialog = document.createElement("div");
    dialog.className = "folder-watch-dialog";
    dialog.hidden = true;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Modelos atualizados na pasta");
    document.body.appendChild(dialog);

    function renderShareSection() {
        const hasFolder = Boolean(directoryHandle && tracked.size);
        shareGenerateButton.disabled = !hasFolder;
        if (hasFolder && !sharePathInput.value) {
            sharePathInput.value = window.localStorage?.getItem(PATH_STORAGE_PREFIX + directoryHandle.name) || "";
        }
        shareNote.textContent = hasFolder
            ? `Quem abrir o link escolhe a pasta “${directoryHandle.name}” e recebe os ${tracked.size} modelo(s) com a posição/rotação atuais e esta vista.`
            : "Abra uma pasta (botão “Abrir pasta”) para gerar um link que usa os arquivos do servidor.";
    }

    async function generateFolderShareLink() {
        if (!directoryHandle || !tracked.size) return;
        const path = sharePathInput.value.trim();
        try {
            window.localStorage?.setItem(PATH_STORAGE_PREFIX + directoryHandle.name, path);
        } catch (_error) {
            // sem armazenamento: só não lembra o caminho
        }
        const camera = api.viewer?.camera;
        const payload = {
            v: 1,
            folder: directoryHandle.name,
            path,
            createdAt: new Date().toISOString(),
            camera: camera ? {
                eye: Array.from(camera.eye).map((v) => round(v, 3)),
                look: Array.from(camera.look).map((v) => round(v, 3)),
                up: Array.from(camera.up).map((v) => round(v, 3))
            } : null,
            models: [...tracked.keys()].map((file) => ({ file, ...readTransform(findModelForFile(file)) }))
        };
        const encoded = await encodeFolderShare(payload);
        const url = new URL(window.location.href);
        url.search = "";
        url.hash = `${SHARE_HASH_KEY}=${encoded}`;
        const linkInput = document.getElementById("shareUploadLinkInput");
        const codeElement = document.getElementById("shareUploadCode");
        if (linkInput) linkInput.value = url.toString();
        if (codeElement) codeElement.textContent = `Link da pasta “${directoryHandle.name}” • ${payload.models.length} modelo(s) • não expira • funciona para quem tem acesso à pasta.`;
        api.setStatus("Link da pasta gerado. Use “Copiar” para enviar.");
    }

    async function showReceivedShare(share) {
        pendingShare = share;
        const pathText = share.path || share.folder;
        shareBanner.innerHTML = "";
        const title = document.createElement("strong");
        title.textContent = `Projeto compartilhado por link de pasta (${share.models.length} modelo(s))`;
        const info = document.createElement("p");
        info.textContent = `Clique em “Abrir pasta” e escolha a pasta “${share.folder}”. Na janela do Windows, cole o caminho abaixo na barra de endereço:`;
        const pathRow = document.createElement("div");
        pathRow.className = "folder-share-path-row";
        const pathCode = document.createElement("code");
        pathCode.textContent = pathText;
        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.textContent = "Copiar caminho";
        copyButton.onclick = async () => {
            try {
                await navigator.clipboard.writeText(pathText);
                copyButton.textContent = "Copiado ✓";
            } catch (_error) {
                copyButton.textContent = "Selecione e use Ctrl+C";
            }
        };
        pathRow.append(pathCode, copyButton);
        shareBanner.append(title, info, pathRow);
        (actions.parentElement || uploadPanel)?.insertBefore(shareBanner, actions);
        if (!supportsPicker) {
            info.textContent = "Para abrir um link de pasta use o Chrome ou o Edge (este navegador não permite escolher a pasta).";
        }
    }

    function renderChip() {
        renderShareSection();
        if (!directoryHandle) {
            chip.hidden = true;
            return;
        }
        chip.hidden = false;
        chip.classList.toggle("is-paused", paused);
        chipText.textContent = `${directoryHandle.name} | ${tracked.size} modelo(s) | ${paused ? "pausado" : "vigiando"}`;
        chipPause.textContent = paused ? "Retomar" : "Pausar";
    }

    // -----------------------------------------------------------------------
    // Modelos na cena (o upload nomeia cada modelo pelo nome do arquivo, sem extensão)
    // -----------------------------------------------------------------------
    const displayNameOf = (fileName) => fileName.replace(/\.[^/.]+$/, "").trim();

    function findModelForFile(fileName) {
        const models = api.viewer?.scene?.models || {};
        const wanted = displayNameOf(fileName);
        return Object.values(models).find((model) => model?.displayName === wanted && !model.destroyed) || null;
    }

    async function waitForModel(fileName, timeoutMs = 180000) {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const model = findModelForFile(fileName);
            if (model) return model;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return null;
    }

    function readTransform(model) {
        return {
            position: Array.from(model?.position || [0, 0, 0]).map((v) => round(v)),
            rotation: Array.from(model?.rotation || [0, 0, 0]).map((v) => round(v, 3))
        };
    }

    function applyTransform(model, transform) {
        if (!model || !transform) return;
        if (transform.position) model.position = [...transform.position];
        if (transform.rotation) model.rotation = [...transform.rotation];
    }

    // -----------------------------------------------------------------------
    // Leitura da pasta
    // -----------------------------------------------------------------------
    async function ensurePermission(handle) {
        const options = { mode: "read" };
        if ((await handle.queryPermission?.(options)) === "granted") return true;
        return (await handle.requestPermission?.(options)) === "granted";
    }

    async function readFolder(handle) {
        const entries = [];
        for await (const entry of handle.values()) {
            if (entry.kind === "file" && isModelFile(entry.name)) entries.push(entry);
        }
        const picked = pickModelEntries(entries);
        const state = new Map();
        for (const entry of picked) {
            const file = await entry.getFile();
            state.set(entry.name, { handle: entry, file, lastModified: file.lastModified, size: file.size });
        }
        return state;
    }

    async function waitUntilIdle() {
        while (api.isBusy()) await new Promise((resolve) => setTimeout(resolve, 500));
    }

    async function openFolder(handle, { remember = true } = {}) {
        if (!(await ensurePermission(handle))) {
            api.setStatus("Permissão para ler a pasta negada.", true);
            return;
        }
        stopWatching({ keepHandle: false });
        api.setStatus(`Lendo a pasta ${handle.name}...`);
        let state = await readFolder(handle);
        const share = pendingShare;
        let missing = [];
        if (share) {
            // Link de pasta: carrega só os arquivos do link (os que existirem nesta pasta)
            const wanted = new Set(share.models.map((item) => item.file));
            missing = [...wanted].filter((name) => !state.has(name));
            state = new Map([...state].filter(([name]) => wanted.has(name)));
        }
        if (!state.size) {
            api.setStatus(share
                ? `Nenhum dos ${share.models.length} arquivo(s) do link está em “${handle.name}”. Confira se escolheu a pasta ${share.path || share.folder}.`
                : `Nenhum arquivo .xkt, .ifc ou .glb encontrado em ${handle.name}.`, true);
            return;
        }
        directoryHandle = handle;
        tracked = state;
        dismissed = new Map();
        if (remember) await dbSet(LAST_KEY, handle);

        await waitUntilIdle();
        await api.processFiles([...state.values()].map((item) => item.file));
        startWatching();
        renderChip();
        updateReopenButton();
        if (share) {
            pendingShare = null;
            shareBanner.remove();
            await applySharedLayout(share, missing);
        }
    }

    async function applySharedLayout(share, missing) {
        api.setStatus("Posicionando os modelos como no link...");
        let applied = 0;
        await Promise.all(share.models.filter((item) => tracked.has(item.file)).map(async (item) => {
            const model = await waitForModel(item.file);
            if (model) {
                applyTransform(model, item);
                applied++;
            }
        }));
        const camera = api.viewer?.camera;
        if (share.camera && camera) {
            api.viewer.cameraFlight?.flyTo?.({ eye: share.camera.eye, look: share.camera.look, up: share.camera.up, duration: 0.6 });
        }
        api.setStatus(
            `Link de pasta aplicado: ${applied} modelo(s) posicionado(s)` +
            (missing.length ? ` • não encontrado(s) nesta pasta: ${missing.join(", ")}` : "."),
            missing.length > 0
        );
    }

    async function pickFolder() {
        if (!supportsPicker) {
            fallbackInput.click();
            return;
        }
        try {
            const handle = await window.showDirectoryPicker({ id: "ifc-models", mode: "read" });
            await openFolder(handle);
        } catch (error) {
            if (error?.name !== "AbortError") {
                console.error("[pasta] Falha ao abrir a pasta:", error);
                api.setStatus(`Não foi possível abrir a pasta: ${error?.message || error}`, true);
            }
        }
    }

    // Navegadores sem seletor de pasta: carrega uma vez (sem vigiar)
    fallbackInput.addEventListener("change", async () => {
        const files = pickModelEntries(Array.from(fallbackInput.files || []).filter((file) => !file.webkitRelativePath.split("/").slice(1, -1).length));
        fallbackInput.value = "";
        if (!files.length) {
            api.setStatus("Nenhum arquivo .xkt, .ifc ou .glb encontrado na pasta.", true);
            return;
        }
        await waitUntilIdle();
        await api.processFiles(files);
    });

    // -----------------------------------------------------------------------
    // Vigiar atualizações
    // -----------------------------------------------------------------------
    function startWatching() {
        window.clearInterval(pollTimer);
        paused = false;
        pollTimer = window.setInterval(() => checkForUpdates(), POLL_INTERVAL_MS);
    }

    function stopWatching({ keepHandle = false } = {}) {
        window.clearInterval(pollTimer);
        pollTimer = null;
        if (!keepHandle) {
            directoryHandle = null;
            tracked = new Map();
        }
        dialog.hidden = true;
        dialogOpen = false;
        renderChip();
    }

    async function checkForUpdates({ manual = false } = {}) {
        if (!directoryHandle || checking || dialogOpen || (paused && !manual)) return;
        if (!manual && document.hidden) return;
        checking = true;
        try {
            const current = await readFolder(directoryHandle);
            const previous = new Map([...tracked].map(([name, item]) => [name, item]));
            const { changed, added, removed } = diffFolderState(previous, current);

            // Arquivos que sumiram: só param de ser vigiados (o modelo continua na tela)
            removed.forEach((name) => tracked.delete(name));

            const pending = [...changed.map((name) => ({ name, kind: "changed" })), ...added.map((name) => ({ name, kind: "added" }))]
                .filter(({ name }) => dismissed.get(name) !== current.get(name).lastModified);

            if (pending.length) showUpdateDialog(pending, current);
            else if (manual) api.setStatus(`Pasta ${directoryHandle.name}: nenhum modelo novo ou atualizado.`);
            renderChip();
        } catch (error) {
            console.warn("[pasta] Falha ao verificar a pasta:", error);
            if (manual) api.setStatus(`Não foi possível ler a pasta: ${error?.message || error}`, true);
        } finally {
            checking = false;
        }
    }

    function showUpdateDialog(pending, current) {
        dialogOpen = true;
        dialog.innerHTML = "";
        const title = document.createElement("h3");
        title.textContent = pending.length > 1 ? `${pending.length} modelos mudaram na pasta` : "Um modelo mudou na pasta";
        const text = document.createElement("div");
        text.textContent = `Pasta ${directoryHandle.name}. Deseja atualizar no visualizador?`;
        const list = document.createElement("ul");
        for (const item of pending) {
            const info = current.get(item.name);
            const li = document.createElement("li");
            const label = document.createElement("label");
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = true;
            checkbox.value = item.name;
            const description = document.createElement("span");
            description.textContent = `${item.kind === "added" ? "🆕" : "🔄"} ${item.name}`;
            const detail = document.createElement("small");
            detail.textContent = `${item.kind === "added" ? "Novo arquivo" : "Atualizado"} em ${formatTime(info.lastModified)}`;
            description.appendChild(detail);
            label.append(checkbox, description);
            li.appendChild(label);
            list.appendChild(li);
        }
        const buttons = document.createElement("div");
        buttons.className = "buttons";
        const laterButton = document.createElement("button");
        laterButton.type = "button";
        laterButton.className = "secondary";
        laterButton.textContent = "Agora não";
        const updateButton = document.createElement("button");
        updateButton.type = "button";
        updateButton.textContent = "Atualizar";
        buttons.append(laterButton, updateButton);
        dialog.append(title, text, list, buttons);
        dialog.hidden = false;

        const close = () => {
            dialog.hidden = true;
            dialogOpen = false;
        };

        laterButton.onclick = () => {
            // não pergunta de novo pela mesma versão desses arquivos
            pending.forEach(({ name }) => dismissed.set(name, current.get(name).lastModified));
            close();
        };

        updateButton.onclick = async () => {
            const selected = new Set([...list.querySelectorAll("input:checked")].map((input) => input.value));
            pending.filter(({ name }) => !selected.has(name))
                .forEach(({ name }) => dismissed.set(name, current.get(name).lastModified));
            close();
            if (!selected.size) return;
            await applyUpdates([...selected], current);
        };
    }

    async function applyUpdates(names, current) {
        await waitUntilIdle();
        const files = [];
        const keptTransforms = new Map();
        for (const name of names) {
            const previous = tracked.get(name);
            // guarda a posição/rotação ajustadas para reaplicar na versão nova
            const loaded = findModelForFile(name);
            if (loaded) keptTransforms.set(name, readTransform(loaded));
            // Remove a versão antiga (modelo e item da lista) antes de carregar a nova
            if (previous?.file) api.removeFile(previous.file);
            const next = current.get(name);
            tracked.set(name, next);
            dismissed.delete(name);
            files.push(next.file);
        }
        api.setStatus(`Atualizando ${files.length} modelo(s) da pasta ${directoryHandle.name}...`);
        await api.processFiles(files);
        renderChip();
        for (const [name, transform] of keptTransforms) {
            waitForModel(name).then((model) => applyTransform(model, transform));
        }
    }

    // -----------------------------------------------------------------------
    // Reabrir a última pasta
    // -----------------------------------------------------------------------
    let lastHandle = null;
    async function updateReopenButton() {
        if (!supportsPicker) return;
        lastHandle = await dbGet(LAST_KEY);
        const show = Boolean(lastHandle) && (!directoryHandle || !(await lastHandle.isSameEntry?.(directoryHandle)));
        reopenButton.hidden = !show;
        if (show) { reopenButton.innerHTML = `${REOPEN_ICON}<span></span>`; reopenButton.querySelector("span").textContent = `Reabrir “${lastHandle.name}”`; reopenButton.title = `Reabrir a pasta ${lastHandle.name}`; }
    }

    reopenButton.addEventListener("click", async () => {
        if (!lastHandle) return;
        try {
            await openFolder(lastHandle, { remember: false });
        } catch (error) {
            console.error("[pasta] Falha ao reabrir:", error);
            api.setStatus("Não foi possível reabrir a pasta. Use “Abrir pasta” e escolha de novo.", true);
        }
    });

    shareGenerateButton.addEventListener("click", () => {
        generateFolderShareLink().catch((error) => {
            console.error("[pasta] Falha ao gerar link:", error);
            api.setStatus(`Não foi possível gerar o link da pasta: ${error?.message || error}`, true);
        });
    });
    openButton.addEventListener("click", pickFolder);
    shareOpenButton.addEventListener("click", pickFolder);
    chipCheck.addEventListener("click", () => checkForUpdates({ manual: true }));
    chipPause.addEventListener("click", () => {
        paused = !paused;
        renderChip();
    });
    chipStop.addEventListener("click", () => {
        stopWatching();
        api.setStatus("A pasta deixou de ser vigiada. Os modelos continuam carregados.");
    });
    // Ao voltar para a aba, verifica na hora
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) checkForUpdates();
    });

    updateReopenButton();
    renderShareSection();

    // Link de pasta recebido (…/ifc_upload#pasta=…)
    const hashMatch = window.location.hash.match(new RegExp(`[#&]${SHARE_HASH_KEY}=([^&]+)`));
    if (hashMatch) {
        decodeFolderShare(hashMatch[1])
            .then(showReceivedShare)
            .catch((error) => api.setStatus(`Link de pasta inválido: ${error?.message || error}`, true));
    }

    return { pickFolder, openFolder, checkForUpdates, stopWatching };
}
