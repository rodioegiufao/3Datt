import { createViewerCore } from "./viewer-core.js";

const ICONS = {
    menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.6"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
    user: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-4 3-6 7-6s6.3 2 7 6"/></svg>`
};

function loadPublicStyles() {
    if (document.querySelector('link[data-public-viewer-styles]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/3D/viewer/public-viewer.css";
    link.dataset.publicViewerStyles = "";
    document.head.append(link);
}

function createPublicViewerUI(config) {
    const count = config.models.length;
    const root = document.createElement("div");
    root.id = "publicViewerUI";
    root.className = "public-viewer-ui";
    root.innerHTML = `
        <div class="public-viewer-topbar">
            <header class="public-viewer-header" aria-label="Identificação do projeto">
                <strong>${config.name}</strong><span>Visualização pública</span>
            </header>
            <button class="public-viewer-trigger" type="button" aria-expanded="false" aria-controls="publicDisciplineDrawer">
                ${ICONS.menu}<span>Disciplinas</span><span class="public-viewer-count">${count}</span>
            </button>
        </div>
        <button class="public-viewer-login" type="button" aria-haspopup="dialog" aria-controls="publicLoginModal" title="Fazer login">
            ${ICONS.user}<span>Login</span>
        </button>
        <div class="public-login-modal" id="publicLoginModal" hidden>
            <div class="public-login-card" role="dialog" aria-modal="true" aria-labelledby="publicLoginTitle">
                <button class="public-login-close" type="button" aria-label="Fechar login">${ICONS.close}</button>
                <div class="public-login-heading">
                    <span class="public-login-icon">${ICONS.user}</span>
                    <div><h2 id="publicLoginTitle">Login</h2><p>Entre para acessar as ferramentas técnicas.</p></div>
                </div>
                <form class="public-login-form">
                    <label>Usuário<input name="usuario" type="text" autocomplete="username" required></label>
                    <label>Senha<input name="senha" type="password" autocomplete="current-password" required></label>
                    <p class="public-login-error" role="alert" hidden></p>
                    <button type="submit">Entrar</button>
                </form>
            </div>
        </div>
        <div class="public-viewer-scrim" aria-hidden="true"></div>
        <aside id="publicDisciplineDrawer" class="public-viewer-drawer" aria-hidden="true" aria-label="Disciplinas do projeto">
            <div class="public-viewer-drawer-header">
                <div><strong>Disciplinas</strong><span>${count} ${count === 1 ? "modelo" : "modelos"}</span></div>
                <button class="public-viewer-close" type="button" aria-label="Fechar disciplinas">${ICONS.close}</button>
            </div>
            <div class="public-viewer-controls">
                <label class="public-viewer-search"><span class="sr-only">Pesquisar disciplina</span>
                    <input type="search" placeholder="Pesquisar disciplina..." autocomplete="off">
                </label>
                <div class="public-viewer-bulk-actions">
                    <button type="button" data-visibility="show">Mostrar todas</button>
                    <button type="button" data-visibility="hide">Ocultar todas</button>
                </div>
            </div>
            <div class="public-viewer-list" role="list"></div>
            <p class="public-viewer-empty" hidden>Nenhuma disciplina encontrada.</p>
        </aside>
        <div class="public-viewer-loading" role="status" aria-live="polite">
            <div><span>Carregando modelo...</span><span data-loading-count>0 de ${count}</span></div>
            <div class="public-viewer-progress"><span></span></div>
        </div>`;
    document.body.append(root);
    return root;
}
function connectLogin(root) {
    const trigger = root.querySelector(".public-viewer-login");
    const modal = root.querySelector(".public-login-modal");
    const card = root.querySelector(".public-login-card");
    const form = root.querySelector(".public-login-form");
    const errorMessage = root.querySelector(".public-login-error");
    const submit = form.querySelector('button[type="submit"]');
    const userInput = form.elements.usuario;

    const setOpen = (open) => {
        modal.hidden = !open;
        document.body.classList.toggle("public-login-open", open);
        if (open) window.setTimeout(() => userInput.focus(), 0);
        else trigger.focus({ preventScroll: true });
    };

    trigger.addEventListener("click", () => setOpen(true));
    root.querySelector(".public-login-close").addEventListener("click", () => setOpen(false));
    modal.addEventListener("click", (event) => { if (event.target === modal) setOpen(false); });
    card.addEventListener("click", (event) => event.stopPropagation());
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !modal.hidden) setOpen(false);
    });

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        errorMessage.hidden = true;
        submit.disabled = true;
        submit.textContent = "Entrando...";
        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ usuario: userInput.value, senha: form.elements.senha.value })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.user) throw new Error(payload.error || "Não foi possível fazer login.");
            window.location.reload();
        } catch (error) {
            errorMessage.textContent = error.message || "Usuário ou senha inválidos.";
            errorMessage.hidden = false;
            form.elements.senha.value = "";
            form.elements.senha.focus();
            submit.disabled = false;
            submit.textContent = "Entrar";
        }
    });
}
function connectDisciplineDrawer(root, core) {
    const drawer = root.querySelector(".public-viewer-drawer");
    const trigger = root.querySelector(".public-viewer-trigger");
    const search = root.querySelector('input[type="search"]');
    const list = root.querySelector(".public-viewer-list");
    const empty = root.querySelector(".public-viewer-empty");

    const setOpen = (open) => {
        root.classList.toggle("is-drawer-open", open);
        trigger.setAttribute("aria-expanded", String(open));
        drawer.setAttribute("aria-hidden", String(!open));
        if (open) window.setTimeout(() => search.focus(), 180);
        else trigger.focus({ preventScroll: true });
    };

    const updateButton = (button, visible) => {
        button.classList.toggle("is-visible", visible);
        button.setAttribute("aria-pressed", String(visible));
        button.setAttribute("aria-label", `${visible ? "Ocultar" : "Mostrar"} ${button.dataset.label}`);
    };

    core.config.models.forEach(({ id, label }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "public-viewer-discipline is-visible";
        button.dataset.label = label;
        button.dataset.search = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        button.innerHTML = `<span class="public-viewer-eye">${ICONS.eye}</span><span>${label}</span>`;
        updateButton(button, true);
        button.addEventListener("click", () => {
            const model = core.models.get(id);
            model.visible = !model.visible;
            updateButton(button, model.visible);
        });
        list.append(button);
    });

    trigger.addEventListener("click", () => setOpen(true));
    root.querySelector(".public-viewer-close").addEventListener("click", () => setOpen(false));
    root.querySelector(".public-viewer-scrim").addEventListener("click", () => setOpen(false));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && root.classList.contains("is-drawer-open")) setOpen(false);
    });
    search.addEventListener("input", () => {
        const term = search.value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
        let matches = 0;
        list.querySelectorAll(".public-viewer-discipline").forEach((button) => {
            button.hidden = !button.dataset.search.includes(term);
            if (!button.hidden) matches += 1;
        });
        empty.hidden = matches !== 0;
    });
    root.querySelectorAll("[data-visibility]").forEach((action) => action.addEventListener("click", () => {
        const visible = action.dataset.visibility === "show";
        core.config.models.forEach(({ id }) => { core.models.get(id).visible = visible; });
        list.querySelectorAll(".public-viewer-discipline").forEach((button) => updateButton(button, visible));
    }));
}

export function startPublicViewer() {
    document.body.classList.add("viewer-public-mode");
    loadPublicStyles();
    let root;
    const core = createViewerCore({ onModelProgress: ({ loaded, total }) => {
        if (!root) return;
        root.querySelector("[data-loading-count]").textContent = `${loaded} de ${total}`;
        root.querySelector(".public-viewer-progress span").style.width = `${(loaded / total) * 100}%`;
        if (loaded === total) root.querySelector(".public-viewer-loading").classList.add("is-complete");
    } });
    root = createPublicViewerUI(core.config);
    connectDisciplineDrawer(root, core);
    connectLogin(root);
    core.viewer.scene.input.on("mouseclicked", (coords) => {
        const pick = core.viewer.scene.pick({ canvasPos: coords, pickSurface: true });
        if (!pick?.entity) return;
        core.viewer.scene.setObjectsSelected(core.viewer.scene.selectedObjectIds, false);
        pick.entity.selected = true;
    });
    return core;
}