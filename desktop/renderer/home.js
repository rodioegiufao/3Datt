(() => {
    "use strict";
    const api = window.bimDesktop;
    const $ = (id) => document.getElementById(id);
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

    async function refresh() {
        const state = await fetch("/__desktop/api/state").then((r) => r.json()).catch(() => null);
        if (!state) return;
        $("version").textContent = state.version || "—";
        $("quality").textContent = state.qualityLabel || "—";

        const gpu = state.gpu || {};
        const gpuEl = $("gpuName");
        gpuEl.textContent = gpu.summary || "abra um modelo para detectar";
        gpuEl.className = gpu.warning ? "gpu-warn" : gpu.summary ? "gpu-ok" : "";
        gpuEl.title = gpu.warning || "";

        const projects = state.projects || [];
        $("projects").innerHTML = projects.length ? projects.map((p) => {
            const pct = p.total ? Math.round((p.offline / p.total) * 100) : 0;
            const label = !p.total ? "sem modelos cadastrados"
                : p.offline === p.total ? "todos no computador"
                : `${p.offline} de ${p.total} no computador`;
            return `<div class="row">
                <span class="pname">${esc(p.name)}</span>
                <span class="meter"><span>${esc(label)}</span><span class="bar"><span style="width:${pct}%"></span></span></span>
                <a href="/3D/${encodeURIComponent(p.slug)}">Abrir</a>
            </div>`;
        }).join("") : `<div class="row"><span class="empty">Nenhum projeto cadastrado em api/_viewer-projects.js.</span></div>`;

        const recent = state.recent || [];
        $("recent").innerHTML = recent.length ? recent.map((r, i) => `<li><button type="button" data-i="${i}" title="${esc(r.path)}">
            <span class="name">${esc(r.name)}</span><span class="dir">${esc(r.dir)}</span></button></li>`).join("")
            : `<li class="empty">Nenhum arquivo aberto ainda.</li>`;
        $("recent").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => api?.openPaths([recent[Number(b.dataset.i)].path])));
    }

    $("btnOpen").addEventListener("click", () => api?.openFileDialog());
    $("btnFolder").addEventListener("click", async () => { await api?.action("add-models-dir"); refresh(); });
    $("btnOffline").addEventListener("click", async () => {
        $("btnOffline").disabled = true;
        await api?.action("prefetch");
        $("btnOffline").disabled = false;
        refresh();
    });

    // Arrastar e soltar em qualquer lugar da janela
    const drop = $("drop");
    let depth = 0;
    window.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; drop.classList.add("is-over"); });
    window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; drop.classList.remove("is-over"); } });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
        e.preventDefault();
        depth = 0;
        drop.classList.remove("is-over");
        const paths = Array.from(e.dataTransfer?.files || []).map((f) => api?.pathForFile(f)).filter(Boolean);
        if (paths.length) api.openPaths(paths);
    });

    api?.onEvent((event) => {
        if (event?.type === "prefetch-progress") {
            const { done, total, failed } = event;
            $("status").textContent = total
                ? `Baixando modelos: ${done} de ${total}${failed ? ` (${failed} não encontrados no site)` : ""}`
                : "Todos os modelos já estão disponíveis offline.";
            if (done === total) refresh();
        }
        if (event?.type === "refresh") refresh();
    });

    refresh();
})();
