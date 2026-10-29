// "Conheça o visualizador": tour guiado pelas ferramentas.
// Na primeira visita aparece um convite; depois o tour fica disponível na Ajuda.
// Cada passo destaca uma parte da tela e explica para que serve. Ferramentas que
// o perfil do usuário não tem (botões ocultos) são puladas automaticamente.

const STORAGE_KEY = "viewer_tour_seen_v1";

const isMobile = () => document.body.dataset.mode === "mobile";

// Passos do tour. target = seletor do elemento destacado (null = cartão no centro).
function buildSteps() {
    const mobile = isMobile();
    return [
        {
            target: null,
            title: "Como se movimentar",
            body: mobile
                ? "<b>Um dedo</b> gira em volta do ponto tocado. <b>Dois dedos</b> movem o modelo, e a <b>pinça</b> aproxima ou afasta. <b>Toque duplo</b> numa peça seleciona."
                : "<b>Botão esquerdo</b> gira o modelo, <b>botão direito</b> ou <b>Shift + arrastar</b> move, e a <b>rodinha</b> aproxima ou afasta. <b>Clique duas vezes</b> numa peça para selecionar."
        },
        {
            target: mobile ? "#btnHomeView" : "#myNavCubeCanvas",
            title: mobile ? "Vista inicial" : "Cubo de navegação",
            body: mobile
                ? "Perdeu o enquadramento? Este botão volta para a vista em que o projeto abriu."
                : "Clique numa face, aresta ou canto do cubo para ir direto a uma vista pronta (frente, topo, lateral…). A tecla <kbd>H</kbd> volta à vista inicial."
        },
        {
            target: "#btnMeasure",
            title: "Medir",
            body: "Escolha <b>Distância</b> ou <b>Ângulo</b> e clique nos pontos do modelo. As medidas ficam na tela até você sair com <kbd>Esc</kbd>."
        },
        {
            target: "#btnToggleTree",
            title: "Explorador",
            body: "Lista os <b>modelos</b> de cada disciplina, <b>pavimentos</b>, <b>redes</b> e peças. Use a caixa de seleção para mostrar ou ocultar e clique no nome para isolar."
        },
        {
            target: "#btnSectionPlane",
            title: "Cortes",
            body: "O <b>plano horizontal</b> corta na altura que você quiser. A <b>caixa de corte</b> (tecla <kbd>B</kbd>) mostra só o que está dentro dela: arraste as alças das faces para ajustar. Dá para usar os dois juntos."
        },
        {
            target: "#btnPerformanceMode",
            title: "Modo leve",
            body: "Se a navegação estiver pesada, o modo leve reduz os efeitos visuais e deixa tudo mais fluido. Em aparelhos simples ele já liga sozinho."
        },
        {
            target: "#btnSearchToggle",
            title: "Buscar peça",
            body: "Encontre qualquer elemento pelo <b>ID</b> ou pelo <b>nome</b>. O visualizador leva a câmera até a peça encontrada."
        },
        {
            target: "#btnTransformPanel",
            title: "Origem e rotação",
            body: "Ajusta a posição de um modelo que veio deslocado dos outros, para tudo ficar alinhado."
        },
        {
            target: "#btnCollisionPanel",
            title: "Compatibilização BIM",
            body: "Encontra <b>interferências</b> entre disciplinas (tubo atravessando viga, por exemplo), mostra cada uma isolada e gera o <b>relatório em PDF</b> com link para abrir cada colisão."
        },
        {
            target: "#btnMaterialsPanel",
            title: "Lista de materiais",
            body: "Soma os materiais dos modelos visíveis e exporta para Excel. Respeita o que estiver oculto e os cortes ativos."
        },
        {
            target: "#btnCivilPanel",
            title: "Instalações civis",
            body: "Quantitativo de hidráulica, sanitário, pluvial, incêndio, irrigação e gás, já associado às composições (SINAPI e próprias) e pronto para colar no <b>orçamento</b>."
        },
        {
            target: "#btnWifiCoverage",
            title: "Cobertura Wi-Fi e câmeras",
            body: "Simula o <b>sinal dos access points</b> e o <b>campo de visão das câmeras</b> sobre a planta do pavimento."
        },
        {
            target: null,
            title: "Informações de cada peça",
            body: mobile
                ? "<b>Mantenha o dedo pressionado</b> sobre uma peça para ver as propriedades, ocultar, isolar ou deixar o resto em raio-X."
                : "<b>Clique com o botão direito</b> numa peça para ver as propriedades, ocultar, isolar ou deixar o resto em raio-X."
        },
        {
            target: "#btnHelp",
            title: "Ajuda",
            body: "Aqui ficam todos os <b>atalhos de teclado</b>, e você pode rever este tutorial quando quiser."
        }
    ];
}

const STYLE = `
.tour-spot{position:fixed;z-index:400101;border-radius:12px;box-shadow:0 0 0 9999px rgba(12,14,18,.42),0 0 0 2px rgba(255,255,255,.9);pointer-events:none;transition:left .25s ease,top .25s ease,width .25s ease,height .25s ease,border-radius .25s ease,box-shadow .3s ease}
.tour-spot.is-free{box-shadow:0 0 0 9999px rgba(12,14,18,0),0 0 0 2px rgba(255,255,255,.9)}
.tour-spot.is-center{left:50%!important;top:50%!important;width:0!important;height:0!important;box-shadow:0 0 0 9999px rgba(12,14,18,.42)}
.tour-spot.is-center.is-free{box-shadow:0 0 0 9999px rgba(12,14,18,0)}
.tour-card{position:fixed;z-index:400102;width:min(340px,calc(100vw - 24px));box-sizing:border-box;padding:16px 16px 12px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:var(--ui-radius-lg,14px);background:var(--ui-surface-solid,#1a1c20);color:var(--ui-text,#eceef1);box-shadow:0 14px 40px rgba(8,10,14,.4);font:400 13px/1.5 var(--ui-font,system-ui,sans-serif);transition:left .25s ease,top .25s ease}
.tour-card .tour-drag{position:relative;margin:-4px -4px 0;padding:4px 26px 0 4px;border-radius:8px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}
.tour-card.is-dragging .tour-drag{cursor:grabbing}
.tour-card.is-dragging{transition:none}
.tour-card .tour-grip{position:absolute;top:6px;right:4px;width:14px;height:14px;fill:var(--ui-text-muted,rgba(236,238,241,.58))}
.tour-card .tour-drag:hover .tour-grip{fill:var(--ui-text,#eceef1)}
.tour-card .tour-try{margin-top:8px;font-size:12px;color:var(--ui-text-muted,rgba(236,238,241,.58))}
.tour-card .tour-step{font-size:11.5px;color:var(--ui-text-muted,rgba(236,238,241,.58));margin-bottom:4px;font-variant-numeric:tabular-nums}
.tour-card h3{margin:0 0 6px;font-size:16px;font-weight:600;letter-spacing:-.01em}
.tour-card p{margin:0}
.tour-card b{font-weight:600}
.tour-card kbd{display:inline-block;min-width:18px;padding:0 5px;border:1px solid var(--ui-border,rgba(255,255,255,.12));border-radius:5px;background:var(--ui-raised,rgba(255,255,255,.06));font:600 11px/1.6 var(--ui-font,system-ui,sans-serif);text-align:center}
.tour-progress{display:flex;gap:4px;margin:14px 0 12px}
.tour-progress span{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.12)}
.tour-progress span.is-done{background:var(--ui-active-bg,#eceef1)}
.tour-actions{display:flex;align-items:center;gap:8px}
.tour-actions .tour-skip{margin-right:auto;padding:6px 4px;border:none;background:none;color:var(--ui-text-muted,rgba(236,238,241,.58));font:500 12px var(--ui-font,system-ui,sans-serif);cursor:pointer}
.tour-actions .tour-skip:hover{color:var(--ui-text,#eceef1)}
.tour-actions button.tour-btn{height:34px;padding:0 14px;border:1px solid var(--ui-border,rgba(255,255,255,.1));border-radius:7px;background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1);font:600 12.5px var(--ui-font,system-ui,sans-serif);cursor:pointer}
.tour-actions button.tour-btn:hover{background:rgba(255,255,255,.12)}
.tour-actions button.tour-btn.is-primary{background:var(--ui-active-bg,#eceef1);border-color:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c)}
.tour-actions button.tour-btn.is-primary:hover{background:#fff}
.tour-card button:focus-visible{outline:2px solid var(--ui-focus,#8fc1ff);outline-offset:2px}
.tour-welcome{left:50%;bottom:64px;transform:translateX(-50%);width:min(380px,calc(100vw - 24px))}
.tour-welcome .tour-welcome-icon{width:36px;height:36px;display:grid;place-items:center;margin-bottom:10px;border-radius:10px;background:var(--ui-active-bg,#eceef1);color:var(--ui-active-fg,#17191c)}
.tour-welcome .tour-welcome-icon svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.tour-welcome .tour-actions{margin-top:14px}
.help-tour-button{display:flex;align-items:center;gap:8px;width:100%;margin:0 0 14px;padding:9px 12px;border:1px solid var(--ui-border,rgba(255,255,255,.08));border-radius:10px;background:var(--ui-raised,rgba(255,255,255,.06));color:var(--ui-text,#eceef1);font:600 13px var(--ui-font,system-ui,sans-serif);text-align:left;cursor:pointer}
.help-tour-button:hover{background:rgba(255,255,255,.12)}
.help-tour-button small{display:block;font-weight:400;font-size:11.5px;color:var(--ui-text-muted,rgba(236,238,241,.58))}
.help-tour-button svg{width:18px;height:18px;flex:0 0 auto;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
@media (prefers-reduced-motion: reduce){.tour-spot,.tour-card{transition:none}}
`;

const COMPASS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>';

function isAvailable(selector) {
    if (!selector) return true;
    const el = document.querySelector(selector);
    if (!el || el.hidden || el.closest("[hidden]")) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

function markSeen() {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch (_error) { /* navegação privada */ }
}

function wasSeen() {
    try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch (_error) { return true; }
}

let running = null;

/** Abre o tour a partir do primeiro passo. */
export function startTour() {
    closeWelcome();
    running?.close();

    // Fecha a Ajuda, se estiver aberta (ela cobriria parte da tela)
    const helpPanel = document.getElementById("helpPanel");
    if (helpPanel && !helpPanel.hidden) document.getElementById("closeHelpPanel")?.click();

    // No celular as ferramentas ficam recolhidas: abre a barra durante o tour
    const toggle = document.getElementById("mobileToolbarToggle");
    const toolbar = document.getElementById("toolbar");
    const openedToolbar = isMobile() && toggle && !toolbar?.classList.contains("open");
    if (openedToolbar) toggle.click();

    const steps = buildSteps().filter((step) => isAvailable(step.target));
    let index = 0;

    const spot = document.createElement("div");
    spot.className = "tour-spot";
    const card = document.createElement("section");
    card.className = "tour-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "false");
    card.setAttribute("aria-label", "Tutorial do visualizador");
    document.body.append(spot, card);

    // Posição escolhida pelo usuário ao arrastar o cartão (vale até o fim do tour)
    let manualPosition = null;
    let drag = null;

    const ensureMobileToolbar = (step) => {
        if (!isMobile() || !toggle || !step.target) return;
        const target = document.querySelector(step.target);
        if (target?.closest("#toolbar") && !toolbar?.classList.contains("open")) toggle.click();
    };

    function placeCard(left, top) {
        const margin = 12;
        const rect = card.getBoundingClientRect();
        card.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin))}px`;
        card.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin))}px`;
    }

    function position() {
        const step = steps[index];
        const target = step.target ? document.querySelector(step.target) : null;
        const cardRect = card.getBoundingClientRect();
        const margin = 12;

        if (!target) {
            spot.classList.add("is-center");
        } else {
            spot.classList.remove("is-center");
            const r = target.getBoundingClientRect();
            const pad = 6;
            spot.style.left = `${r.left - pad}px`;
            spot.style.top = `${r.top - pad}px`;
            spot.style.width = `${r.width + pad * 2}px`;
            spot.style.height = `${r.height + pad * 2}px`;
            spot.style.borderRadius = target.id === "myNavCubeCanvas" ? "18px" : "12px";
        }

        if (manualPosition) {
            placeCard(manualPosition.left, manualPosition.top);
            return;
        }
        if (!target) {
            placeCard((window.innerWidth - cardRect.width) / 2, (window.innerHeight - cardRect.height) / 2);
            return;
        }

        // Cartão abaixo do alvo; se não couber, acima. No celular, embaixo ou em cima da tela.
        const r = target.getBoundingClientRect();
        const pad = 6;
        let left;
        let top;
        if (isMobile()) {
            left = (window.innerWidth - cardRect.width) / 2;
            top = r.top + r.height / 2 > window.innerHeight * 0.55 ? margin : window.innerHeight - cardRect.height - 84;
        } else {
            left = r.left + r.width / 2 - cardRect.width / 2;
            top = r.bottom + margin + pad;
            if (top + cardRect.height > window.innerHeight - margin) top = r.top - cardRect.height - margin - pad;
        }
        placeCard(left, top);
    }

    function render() {
        const step = steps[index];
        const last = index === steps.length - 1;
        ensureMobileToolbar(step);
        spot.classList.remove("is-free"); // a cada passo, destaca de novo
        const tryHint = step.target
            ? (isMobile() ? "Pode tocar no item destacado e testar. O tutorial espera você." : "Pode clicar no item destacado e testar. O tutorial espera você.")
            : "Pode testar no modelo agora. O tutorial espera você.";
        card.innerHTML = `
            <div class="tour-drag" title="Arraste para mover o cartão (duplo clique volta ao lugar)">
                <div class="tour-step">${index + 1} de ${steps.length}</div>
                <svg class="tour-grip" viewBox="0 0 12 12" aria-hidden="true"><circle cx="4" cy="3" r="1"/><circle cx="8" cy="3" r="1"/><circle cx="4" cy="6" r="1"/><circle cx="8" cy="6" r="1"/><circle cx="4" cy="9" r="1"/><circle cx="8" cy="9" r="1"/></svg>
                <h3>${step.title}</h3>
            </div>
            <p>${step.body}</p>
            <p class="tour-try">${tryHint}</p>
            <div class="tour-progress" aria-hidden="true">${steps.map((_, i) => `<span class="${i <= index ? "is-done" : ""}"></span>`).join("")}</div>
            <div class="tour-actions">
                <button type="button" class="tour-skip" data-action="close">${last ? "Fechar" : "Pular tutorial"}</button>
                ${index > 0 ? '<button type="button" class="tour-btn" data-action="back">Voltar</button>' : ""}
                <button type="button" class="tour-btn is-primary" data-action="next">${last ? "Concluir" : "Próximo"}</button>
            </div>`;
        requestAnimationFrame(() => {
            position();
            card.querySelector('[data-action="next"]')?.focus({ preventScroll: true });
        });
    }

    function close() {
        markSeen();
        spot.remove();
        card.remove();
        window.removeEventListener("resize", position);
        document.removeEventListener("keydown", onKey, true);
        document.removeEventListener("pointerdown", onPagePointer, true);
        window.removeEventListener("pointermove", onDragMove);
        window.removeEventListener("pointerup", onDragEnd);
        if (openedToolbar && toolbar?.classList.contains("open")) toggle.click();
        running = null;
    }

    function go(delta) {
        const next = index + delta;
        if (next < 0) return;
        if (next >= steps.length) {
            close();
            return;
        }
        index = next;
        render();
    }

    // Teclado: setas sempre trocam de passo; Enter e Esc só quando o foco está no cartão
    // (assim Esc continua saindo da medição, e os atalhos do visualizador funcionam)
    function onKey(event) {
        const target = event.target;
        const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
        if (typing) return;
        const inCard = card.contains(document.activeElement);
        if (event.key === "ArrowRight" || (inCard && event.key === "Enter" && !target.closest?.("button"))) {
            event.preventDefault(); event.stopPropagation(); go(1);
        } else if (event.key === "ArrowLeft") {
            event.preventDefault(); event.stopPropagation(); go(-1);
        } else if (inCard && event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); close();
        }
    }

    // Quando a pessoa usa a tela (clica num botão, gira o modelo), o escurecimento sai
    // para ela ver o que abriu; o cartão continua ali para seguir o tutorial.
    function onPagePointer(event) {
        if (card.contains(event.target)) return;
        spot.classList.add("is-free");
        setTimeout(position, 250); // painéis que abrem podem mover os botões
    }

    // Arrastar o cartão pelo título
    function onDragStart(event) {
        const handle = event.target.closest(".tour-drag");
        if (!handle || event.button > 0) return;
        const rect = card.getBoundingClientRect();
        drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, id: event.pointerId };
        card.classList.add("is-dragging");
        handle.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    }
    function onDragMove(event) {
        if (!drag) return;
        manualPosition = { left: event.clientX - drag.dx, top: event.clientY - drag.dy };
        placeCard(manualPosition.left, manualPosition.top);
    }
    function onDragEnd() {
        if (!drag) return;
        drag = null;
        card.classList.remove("is-dragging");
    }

    card.addEventListener("pointerdown", onDragStart);
    card.addEventListener("dblclick", (event) => {
        if (!event.target.closest(".tour-drag")) return;
        manualPosition = null;
        position();
    });
    // Cliques no cartão não chegam ao resto da página (no celular, fechariam a barra)
    card.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "next") go(1);
        else if (action === "back") go(-1);
        else if (action === "close") close();
    });
    window.addEventListener("pointermove", onDragMove);
    window.addEventListener("pointerup", onDragEnd);
    window.addEventListener("resize", position);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPagePointer, true);

    running = { close };
    render();
}

let welcome = null;

function closeWelcome() {
    welcome?.remove();
    welcome = null;
}

/** Convite da primeira visita. */
export function showWelcome() {
    if (welcome || running) return;
    welcome = document.createElement("section");
    welcome.className = "tour-card tour-welcome";
    welcome.setAttribute("role", "dialog");
    welcome.setAttribute("aria-label", "Conheça o visualizador");
    welcome.innerHTML = `
        <div class="tour-welcome-icon">${COMPASS_ICON}</div>
        <h3>Conheça o visualizador</h3>
        <p>Primeira vez por aqui? Em um minuto mostramos como navegar no modelo 3D e o que cada ferramenta faz.</p>
        <div class="tour-actions">
            <button type="button" class="tour-skip" data-action="later">Agora não</button>
            <button type="button" class="tour-btn is-primary" data-action="start">Começar tour</button>
        </div>`;
    welcome.addEventListener("click", (event) => {
        event.stopPropagation();
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (action === "start") startTour();
        else if (action === "later") {
            markSeen();
            closeWelcome();
        }
    });
    document.body.appendChild(welcome);
}

/** Botão "Ver tutorial" no topo do painel de Ajuda. */
function addHelpEntry() {
    const help = document.getElementById("helpPanel");
    if (!help || help.querySelector(".help-tour-button")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "help-tour-button";
    button.innerHTML = `${COMPASS_ICON}<span>Ver tutorial<small>Tour rápido pelas ferramentas</small></span>`;
    button.addEventListener("click", () => startTour());
    const header = help.querySelector(".help-panel-header");
    header ? header.after(button) : help.prepend(button);
}

/**
 * Prepara o tour: botão na Ajuda e, na primeira visita, o convite
 * (depois que o primeiro modelo aparece, para o usuário já ver o 3D).
 */
export function setupTour({ firstModelReady = Promise.resolve(), skipWelcome = false } = {}) {
    if (!document.getElementById("viewerTourStyle")) {
        const style = document.createElement("style");
        style.id = "viewerTourStyle";
        style.textContent = STYLE;
        document.head.appendChild(style);
    }
    addHelpEntry();
    if (skipWelcome || wasSeen()) return;
    firstModelReady.then(() => setTimeout(showWelcome, 1200));
}
