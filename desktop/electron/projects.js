"use strict";
// Lê o cadastro de projetos do site (api/_viewer-projects.js + 3D/viewer/project-config.js)
// para a tela inicial mostrar quantos modelos de cada projeto já estão disponíveis offline,
// e para o menu "Baixar modelos para uso offline".

const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

async function loadCatalog(siteDir) {
    const { VIEWER_PROJECTS = [] } = require(path.join(siteDir, "api", "_viewer-projects.js"));
    let getProjectConfig = null;
    try {
        const file = path.join(siteDir, "3D", "viewer", "project-config.js");
        try {
            ({ getProjectConfig } = await import(pathToFileURL(file).href));
        } catch {
            // .js sem "type":"module" por perto: carrega o texto como módulo ES
            const source = fs.readFileSync(file, "utf8");
            ({ getProjectConfig } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`));
        }
    } catch (error) {
        console.warn("[desktop] project-config.js não pôde ser lido:", error.message);
    }
    return VIEWER_PROJECTS.map((p) => {
        let models = [];
        try {
            models = getProjectConfig ? getProjectConfig(p.project, "authenticated").models : [];
        } catch { /* projeto sem modelos */ }
        const srcs = [...new Set(models.map((m) => m?.src).filter((s) => typeof s === "string" && s.startsWith("/")))];
        return { slug: p.slug, project: p.project, name: p.name, image: p.image || null, srcs };
    });
}

function projectStatus(catalog, findLocal) {
    return catalog.map(({ slug, name, image, srcs }) => {
        const offline = srcs.filter((src) => findLocal(decodeURIComponent(src))).length;
        return { slug, name, image, total: srcs.length, offline };
    });
}

/** Baixa tudo o que falta para uso offline. onProgress({ done, total, failed, current }) */
async function prefetchAll(catalog, { findLocal, download }, onProgress = () => {}, { slugs = null, concurrency = 3 } = {}) {
    const wanted = catalog.filter((p) => !slugs || slugs.includes(p.slug));
    const missing = [...new Set(wanted.flatMap((p) => p.srcs))]
        .map((src) => decodeURIComponent(src))
        .filter((src) => !findLocal(src));
    let done = 0;
    let failed = 0;
    let next = 0;
    onProgress({ done, total: missing.length, failed, current: null });
    const worker = async () => {
        while (next < missing.length) {
            const src = missing[next++];
            const file = await download(src);
            if (!file) failed++;
            done++;
            onProgress({ done, total: missing.length, failed, current: src });
        }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
    return { total: missing.length, failed };
}

module.exports = { loadCatalog, projectStatus, prefetchAll };
