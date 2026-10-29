/* =====================================================================
   Layout v2 — ajustes de interface do visualizador 3D
   - troca os emojis da barra por ícones SVG de traço único
   - agrupa as ferramentas com divisores
   - tooltip rápido no lugar do title nativo
   - detecta celular/computador sozinho (sem o seletor na tela)
   - leva o crédito do responsável para o rodapé da Ajuda
   Não altera a lógica do viewer: só a apresentação.
   ===================================================================== */
(function () {
    "use strict";

    const svg = (paths) =>
        `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths}</svg>`;

    const ICONS = {
        btnAngle: svg('<path d="M4 20h16"/><path d="M4 20 15 5"/><path d="M10.5 20a6.5 6.5 0 0 0-2.4-5"/>'),
        btnDistance: svg('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>'),
        btnToggleTree: svg('<path d="M21 12h-8"/><path d="M21 6H8"/><path d="M21 18h-8"/><path d="M3 6v4a2 2 0 0 0 2 2h3"/><path d="M3 10v6a2 2 0 0 0 2 2h3"/>'),
        btnSectionPlane: svg('<path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z"/><path d="M3 7.5v9L12 21l9-4.5v-9"/><path d="M1.5 13.5h21" stroke-dasharray="2.5 2.5"/>'),
        btnPerformanceMode: svg('<path d="M12.7 19a2 2 0 0 0 1.4-.6l6.2-6.2a6 6 0 0 0-8.5-8.5l-6.2 6.2a2 2 0 0 0-.6 1.4V18a1 1 0 0 0 1 1Z"/><path d="M16 8 2 22"/><path d="M17.5 15H9"/>'),
        btnSearchToggle: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
        btnTransformPanel: svg('<path d="M5 3v16h16"/><path d="m5 19 6-6"/><path d="m2 6 3-3 3 3"/><path d="m18 16 3 3-3 3"/>'),
        btnCollisionPanel: svg('<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>'),
        btnMaterialsPanel: svg('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>'),
        btnAnnotationClick: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/><path d="M12 7v6"/><path d="M9 10h6"/>'),
        btnWifiCoverage: svg('<path d="M12 20h.01"/><path d="M2 8.8a15 15 0 0 1 20 0"/><path d="M5 12.9a10 10 0 0 1 14 0"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/>'),
        btnMeasure: svg('<path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/><path d="m17.5 15.5 2-2"/>'),
        btnShareUploadLink: svg('<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>'),
        btnHelp: svg('<circle cx="12" cy="12" r="9.5"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>')
    };

    const SEPARATORS = ["view", "tools"];

    /* ---------------- Ícones e rótulos ---------------- */

    function upgradeButton(button) {
        if (!button || button.dataset.uiV2 === "1") return;
        const icon = ICONS[button.id];
        if (!icon) return; // botão desconhecido: mantém como está

        // Texto atual do botão (sem o emoji), para virar rótulo acessível
        let labelText = "";
        let label = button.querySelector(".tool-label");
        if (label) {
            labelText = label.textContent.trim();
        } else {
            button.childNodes.forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) labelText += node.textContent;
            });
            labelText = labelText.trim();
        }

        button.dataset.uiV2 = "1";
        button.innerHTML = icon;
        label = document.createElement("span");
        label.className = "tool-label";
        label.textContent = labelText;
        button.appendChild(label);

        moveTitleToTooltip(button);
    }

    function moveTitleToTooltip(button) {
        const title = button.getAttribute("title");
        if (title) {
            button.dataset.tip = title;
            button.setAttribute("aria-label", title);
            button.removeAttribute("title");
        }
    }

    function ensureSeparators(toolbar) {
        SEPARATORS.forEach((group) => {
            if (toolbar.querySelector(`.ui-tool-sep[data-after="${group}"]`)) return;
            const sep = document.createElement("span");
            sep.className = "ui-tool-sep";
            sep.dataset.after = group;
            sep.setAttribute("aria-hidden", "true");
            toolbar.appendChild(sep);
        });
    }

    function upgradeToolbar() {
        const toolbar = document.getElementById("toolbar");
        if (!toolbar) return;
        toolbar.querySelectorAll(".tool-button").forEach(upgradeButton);
        ensureSeparators(toolbar);

        // Botões criados depois (anotação, cobertura) e títulos alterados pelo viewer
        new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (m.type === "childList") {
                    m.addedNodes.forEach((node) => {
                        if (node.nodeType === 1 && node.classList.contains("tool-button")) upgradeButton(node);
                    });
                } else if (m.type === "attributes" && m.target.classList?.contains("tool-button")) {
                    moveTitleToTooltip(m.target);
                }
            }
        }).observe(toolbar, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });
    }

    /* ---------------- Tooltip ---------------- */

    function setupTooltip() {
        const tip = document.createElement("div");
        tip.className = "ui-tooltip";
        tip.setAttribute("role", "tooltip");
        document.body.appendChild(tip);
        let current = null;

        function show(target) {
            current = target;
            tip.textContent = target.dataset.tip;
            const r = target.getBoundingClientRect();
            const isMobile = document.body.dataset.mode === "mobile";
            tip.classList.add("is-visible");
            const tw = tip.offsetWidth;
            const th = tip.offsetHeight;
            let left, top;
            if (isMobile) {
                left = r.left - tw - 10;
                top = r.top + (r.height - th) / 2;
            } else {
                left = r.left + (r.width - tw) / 2;
                top = r.bottom + 10;
            }
            left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
            tip.style.left = `${left}px`;
            tip.style.top = `${Math.max(8, top)}px`;
        }

        function hide() {
            current = null;
            tip.classList.remove("is-visible");
        }

        document.addEventListener("pointerover", (e) => {
            const target = e.target.closest?.("[data-tip]");
            if (target && target !== current && e.pointerType !== "touch") show(target);
            if (!target && current) hide();
        });
        document.addEventListener("focusin", (e) => {
            const target = e.target.closest?.("[data-tip]");
            if (target) show(target);
        });
        document.addEventListener("focusout", hide);
        document.addEventListener("pointerdown", hide);
        window.addEventListener("scroll", hide, true);
    }

    /* ---------------- Computador x celular automático ---------------- */

    const mobileQuery = window.matchMedia("(max-width: 768px), (pointer: coarse) and (max-width: 1024px)");

    function syncMode() {
        const mode = mobileQuery.matches ? "mobile" : "desktop";
        if (typeof window.applyMode === "function" && document.body.dataset.mode !== mode) {
            window.applyMode(mode);
        }
    }

    /* ---------------- Medir: ângulo + distância num só botão ---------------- */

    const MEASURE_OPTIONS = [
        { mode: "distance", source: "btnDistance", label: "Distância", hint: "Clique em dois pontos" },
        { mode: "angle", source: "btnAngle", label: "Ângulo", hint: "Clique em três pontos" }
    ];

    function setupMeasureMenu() {
        const toolbar = document.getElementById("toolbar");
        const sources = MEASURE_OPTIONS.map((o) => document.getElementById(o.source));
        if (!toolbar || sources.some((b) => !b) || document.getElementById("btnMeasure")) return;

        sources.forEach((b) => b.classList.add("ui-merged"));

        const button = document.createElement("button");
        button.type = "button";
        button.id = "btnMeasure";
        button.className = "tool-button";
        button.title = "Medir distância ou ângulo";
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        button.innerHTML = "Medir";
        toolbar.insertBefore(button, sources[0]);
        upgradeButton(button);

        const menu = document.createElement("div");
        menu.className = "ui-measure-menu";
        menu.setAttribute("role", "menu");
        menu.hidden = true;
        menu.innerHTML =
            MEASURE_OPTIONS.map((o) => `
            <button type="button" role="menuitemradio" aria-checked="false" data-mode="${o.mode}">
                ${ICONS[o.source]}
                <span><strong>${o.label}</strong><small>${o.hint}</small></span>
            </button>`).join("") +
            `<button type="button" role="menuitem" data-mode="none" class="ui-measure-stop">Parar medição</button>`;
        document.body.appendChild(menu);

        const activeOption = () => MEASURE_OPTIONS.find((o) => document.getElementById(o.source)?.classList.contains("active"));

        function syncState() {
            const active = activeOption();
            button.classList.toggle("active", Boolean(active));
            button.setAttribute("aria-pressed", active ? "true" : "false");
            menu.querySelectorAll("[data-mode]").forEach((item) => {
                if (item.dataset.mode !== "none") item.setAttribute("aria-checked", String(item.dataset.mode === active?.mode));
            });
            menu.querySelector(".ui-measure-stop").hidden = !active;
        }

        function placeMenu() {
            const r = button.getBoundingClientRect();
            const isMobile = document.body.dataset.mode === "mobile";
            menu.style.visibility = "hidden";
            menu.hidden = false;
            const mw = menu.offsetWidth;
            let left = isMobile ? r.left - mw - 10 : r.left;
            let top = isMobile ? r.top : r.bottom + 8;
            left = Math.max(8, Math.min(left, window.innerWidth - mw - 8));
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.style.visibility = "";
        }

        function openMenu() {
            syncState();
            placeMenu();
            button.setAttribute("aria-expanded", "true");
            menu.querySelector("[data-mode]")?.focus({ preventScroll: true });
        }

        function closeMenu() {
            menu.hidden = true;
            button.setAttribute("aria-expanded", "false");
        }

        button.addEventListener("click", (event) => {
            event.stopPropagation();
            if (menu.hidden) openMenu(); else closeMenu();
        });

        menu.addEventListener("click", (event) => {
            const item = event.target.closest("[data-mode]");
            if (!item) return;
            const option = MEASURE_OPTIONS.find((o) => o.mode === item.dataset.mode);
            if (option) {
                document.getElementById(option.source).click();
            } else if (typeof window.setMeasurementMode === "function") {
                window.setMeasurementMode("none", null);
            }
            closeMenu();
            setTimeout(syncState, 50);
        });

        document.addEventListener("pointerdown", (event) => {
            if (!menu.hidden && !menu.contains(event.target) && !button.contains(event.target)) closeMenu();
        });
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape" && !menu.hidden) {
                closeMenu();
                button.focus();
            }
        });
        window.addEventListener("resize", closeMenu);

        // O viewer liga/desliga "active" nos botões originais: espelha no botão Medir
        const observer = new MutationObserver(syncState);
        sources.forEach((b) => observer.observe(b, { attributes: true, attributeFilter: ["class"] }));
        syncState();
    }

    /* ---------------- Assinatura do criador ---------------- */

    function setupCredit() {
        const credit = document.getElementById("creditNote");
        if (!credit) return;
        credit.textContent = "Desenvolvido por Eng. Msc. Rodrigo Damasceno Nascimento";
        credit.setAttribute("aria-label", "Criador do visualizador");
    }

    function upgradeMobileToggle() {
        const toggle = document.getElementById("mobileToolbarToggle");
        if (!toggle || toggle.querySelector(".ui-icon")) return;
        toggle.insertAdjacentHTML(
            "afterbegin",
            svg('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>').replace('class="ui-icon"', 'class="ui-icon ui-icon-open"') +
            svg('<path d="m6 6 12 12M18 6 6 18"/>').replace('class="ui-icon"', 'class="ui-icon ui-icon-close"')
        );
    }

    function init() {
        document.body.classList.add("ui-v2");
        upgradeMobileToggle();
        upgradeToolbar();
        setupMeasureMenu();
        setupTooltip();
        setupCredit();
        syncMode();
        mobileQuery.addEventListener?.("change", syncMode);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
