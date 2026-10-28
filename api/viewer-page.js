// Monta a página de um projeto do visualizador 3D a partir de 3D/viewer.html.
// As rotas /3D/<slug> chegam aqui pelo vercel.json. A resposta fica em cache na
// CDN da Vercel, então só a primeira visita após cada deploy executa esta função.
const fs = require("fs");
const path = require("path");
const { findViewerProject, BUDGET_PANEL } = require("./_viewer-projects");

let templateCache = null;
function readTemplate() {
    if (!templateCache) {
        templateCache = fs.readFileSync(path.join(process.cwd(), "3D", "viewer.html"), "utf8");
    }
    return templateCache;
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));

function renderViewerPage(project, { origin }) {
    const title = `Visualizador BIM - ${project.name}`;
    const description = project.description || `Modelo BIM 3D do ${project.name} com todas as disciplinas de projeto.`;
    const url = `${origin}/3D/${project.slug}`;
    const meta = [
        `<meta name="description" content="${escapeHtml(description)}">`,
        `<link rel="canonical" href="${escapeHtml(url)}">`,
        `<meta property="og:type" content="website">`,
        `<meta property="og:site_name" content="Eng. Rodrigo Damasceno">`,
        `<meta property="og:title" content="${escapeHtml(title)}">`,
        `<meta property="og:description" content="${escapeHtml(description)}">`,
        `<meta property="og:url" content="${escapeHtml(url)}">`
    ];
    if (project.image) {
        const image = `${origin}${project.image}`;
        meta.push(
            `<meta property="og:image" content="${escapeHtml(image)}">`,
            `<meta property="og:image:width" content="1200">`,
            `<meta property="og:image:height" content="630">`,
            `<meta name="twitter:card" content="summary_large_image">`,
            `<meta name="twitter:image" content="${escapeHtml(image)}">`
        );
    }

    const help = (project.help || []).map((item) => `                <li>${item}</li>`).join("\n");
    const body = project.budget ? BUDGET_PANEL(escapeHtml(project.name)) : "";
    // O chão ajustado ao prédio agora vale para todos os projetos (3D/viewer/app/scene-style.js)
    const scripts = "";

    return readTemplate()
        .replace("{{title}}", escapeHtml(title))
        .replace("{{project}}", escapeHtml(project.project))
        .replace("<!-- viewer:meta -->", meta.join("\n    "))
        .replace("                <!-- viewer:help -->", help)
        .replace("    <!-- viewer:body -->", body)
        .replace("    <!-- viewer:scripts -->", scripts ? `    ${scripts}` : "");
}

function requestOrigin(req) {
    const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "www.engrodrigodamasceno.com.br").split(",")[0].trim();
    const proto = String(req.headers?.["x-forwarded-proto"] || "https").split(",")[0].trim();
    return `${proto}://${host}`;
}

module.exports = function viewerPage(req, res) {
    const slug = req.query?.p || new URL(req.url, "http://localhost").searchParams.get("p");
    const project = findViewerProject(slug);
    if (!project) {
        res.status(404).setHeader("Content-Type", "text/html; charset=utf-8");
        res.send(`<!DOCTYPE html><meta charset="utf-8"><title>Projeto não encontrado</title><p>Projeto não encontrado. <a href="/3D/">Ver projetos</a></p>`);
        return;
    }
    // Endereço com maiúsculas/minúsculas diferentes (ex.: /3D/tce) vai para o oficial
    if (project.slug !== String(slug).replace(/\.html$/i, "")) {
        const search = new URL(req.url, "http://localhost").searchParams;
        search.delete("p");
        const qs = search.toString();
        res.status(308).setHeader("Location", `/3D/${project.slug}${qs ? `?${qs}` : ""}`);
        res.end();
        return;
    }
    try {
        const html = renderViewerPage(project, { origin: requestOrigin(req) });
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        // Cache na CDN; um novo deploy limpa o cache automaticamente
        res.setHeader("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
        res.status(200).send(html);
    } catch (error) {
        console.error("[viewer-page]", error);
        res.status(500).setHeader("Content-Type", "text/plain; charset=utf-8");
        res.send("Não foi possível montar a página do projeto.");
    }
};

module.exports.renderViewerPage = renderViewerPage;
