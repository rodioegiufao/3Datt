// Menu do botão "Corte": plano horizontal e caixa de corte, que podem ser usados juntos.
// A caixa de corte fica em ../features/section-box/ e só é baixada no primeiro uso.
import { viewer } from "../viewer-authenticated.js";
import { requestRenderFrame } from "./performance.js";
import { sectionPlaneEnabled, toggleSectionPlane } from "./treeview-section.js";

let sectionBoxPromise = null;
function getSectionBox() {
    sectionBoxPromise ||= import("../features/section-box/section-box.js")
        .then(({ createSectionBox }) => createSectionBox({ viewer, requestRenderFrame, onChange: () => syncSectionButton() }))
        .catch((error) => {
            sectionBoxPromise = null;
            throw error;
        });
    return sectionBoxPromise;
}

let sectionBoxActive = false;
let sectionButton = null;
let sectionMenu = null;

export function isSectionBoxActive() {
    return sectionBoxActive;
}

export function syncSectionButton() {
    if (!sectionButton) return;
    const on = sectionPlaneEnabled || sectionBoxActive;
    sectionButton.classList.toggle("active", on);
    sectionButton.setAttribute("aria-pressed", on ? "true" : "false");
}

export async function toggleSectionBox(force) {
    const box = await getSectionBox();
    const turnOn = typeof force === "boolean" ? force : !box.isActive();
    if (turnOn) {
        sectionBoxActive = box.enable();
        if (sectionBoxActive) box.frame();
    } else {
        box.disable();
        sectionBoxActive = false;
    }
    syncSectionButton();
    return sectionBoxActive;
}

export async function fitSectionBoxToSelection() {
    const box = await getSectionBox();
    if (!box.isActive()) {
        sectionBoxActive = box.enable();
    } else {
        box.fitToSelection();
    }
    box.frame();
    syncSectionButton();
}

export async function turnOffAllSections() {
    if (sectionPlaneEnabled && sectionButton) toggleSectionPlane(sectionButton);
    if (sectionBoxActive) await toggleSectionBox(false);
    syncSectionButton();
}

function placeMenu() {
    const r = sectionButton.getBoundingClientRect();
    const isMobile = document.body.dataset.mode === "mobile";
    sectionMenu.style.visibility = "hidden";
    sectionMenu.hidden = false;
    const width = sectionMenu.offsetWidth;
    let left = isMobile ? r.left - width - 10 : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    sectionMenu.style.left = `${left}px`;
    sectionMenu.style.top = `${isMobile ? r.top : r.bottom + 8}px`;
    sectionMenu.style.visibility = "";
}

function renderMenu() {
    const horizontal = sectionPlaneEnabled;
    const anyOn = horizontal || sectionBoxActive;
    sectionMenu.innerHTML = `
        <button type="button" role="menuitemcheckbox" aria-checked="${horizontal}" data-action="plane">
            <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12h20"/><path d="M12 3v6"/><path d="m9 6 3-3 3 3"/><path d="M5 16l3 4h8l3-4"/></svg>
            <span><strong>Plano horizontal</strong><small>Corte na altura, ajustável pela seta</small></span>
        </button>
        <button type="button" role="menuitemcheckbox" aria-checked="${sectionBoxActive}" data-action="box">
            <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 7.5l9 4.5 9-4.5L12 3Z"/><path d="M3 7.5v9L12 21l9-4.5v-9"/><path d="M12 12v9"/></svg>
            <span><strong>Caixa de corte</strong><small>Mostra só o que está dentro (tecla B)</small></span>
        </button>
        ${sectionBoxActive ? `<button type="button" role="menuitem" data-action="fit" class="ui-measure-stop">Ajustar caixa à seleção</button>` : ""}
        ${anyOn ? `<button type="button" role="menuitem" data-action="off" class="ui-measure-stop">Desligar cortes</button>` : ""}`;
}

function closeMenu() {
    if (!sectionMenu) return;
    sectionMenu.hidden = true;
    sectionButton?.setAttribute("aria-expanded", "false");
}

function openMenu() {
    renderMenu();
    placeMenu();
    sectionButton.setAttribute("aria-expanded", "true");
    sectionMenu.querySelector("button")?.focus({ preventScroll: true });
}

/** Troca o clique do botão "Corte" por um menu com as opções de corte. */
export function setupSectionTools() {
    sectionButton = document.getElementById("btnSectionPlane");
    if (!sectionButton || sectionMenu) return;

    sectionButton.removeAttribute("onclick");
    sectionButton.onclick = null;
    sectionButton.setAttribute("aria-haspopup", "menu");
    sectionButton.setAttribute("aria-expanded", "false");
    sectionButton.dataset.tip = "Cortes: plano horizontal e caixa de corte";
    sectionButton.removeAttribute("title");

    sectionMenu = document.createElement("div");
    sectionMenu.className = "ui-measure-menu";
    sectionMenu.setAttribute("role", "menu");
    sectionMenu.hidden = true;
    document.body.appendChild(sectionMenu);

    sectionButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (sectionMenu.hidden) openMenu(); else closeMenu();
    });

    sectionMenu.addEventListener("click", async (event) => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (!action) return;
        closeMenu();
        try {
            if (action === "plane") toggleSectionPlane(sectionButton);
            else if (action === "box") await toggleSectionBox();
            else if (action === "fit") await fitSectionBoxToSelection();
            else if (action === "off") await turnOffAllSections();
        } catch (error) {
            console.error("[corte]", error);
        }
        syncSectionButton();
    });

    document.addEventListener("pointerdown", (event) => {
        if (sectionMenu.hidden) return;
        if (!sectionMenu.contains(event.target) && !sectionButton.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && !sectionMenu.hidden) {
            closeMenu();
            return;
        }
        const target = event.target;
        const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable;
        if (!typing && !event.repeat && !event.ctrlKey && !event.metaKey && event.key?.toLowerCase() === "b") {
            event.preventDefault();
            toggleSectionBox().catch((error) => console.error("[caixa de corte]", error));
        }
    });
    window.addEventListener("resize", closeMenu);
}
