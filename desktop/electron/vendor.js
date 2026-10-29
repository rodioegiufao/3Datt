"use strict";
// Substitui o jsDelivr por cópias locais (pasta node_modules do app), para o visualizador
// abrir 100% offline e sem esperar a rede. Se a versão pedida não estiver empacotada,
// o servidor redireciona para o CDN original (funciona quando houver internet).

const fs = require("node:fs");
const path = require("node:path");

const CDN_ORIGIN = "https://cdn.jsdelivr.net/";
const LOCAL_PREFIX = "/__cdn/";

function rewriteCdnUrls(text) {
    return text.split(CDN_ORIGIN).join(LOCAL_PREFIX);
}

/** "/__cdn/npm/@xeokit/xeokit-sdk@2.6.107/dist/x.js" → { name, version, file, esm } */
function parseNpmPath(urlPath) {
    const rest = urlPath.slice(`${LOCAL_PREFIX}npm/`.length);
    const match = rest.match(/^((?:@[^/]+\/)?[^/@]+)@([^/]+)(\/.*)?$/);
    if (!match) return null;
    let file = match[3] || "";
    let esm = false;
    if (file === "/+esm" || file.endsWith("/+esm")) {
        esm = true;
        file = file.slice(0, -"/+esm".length);
    }
    return { name: match[1], version: match[2], file: file.replace(/^\//, ""), esm };
}

function createVendorResolver(nodeModulesDirs) {
    const pkgCache = new Map();

    function findPackage(name) {
        if (pkgCache.has(name)) return pkgCache.get(name);
        let found = null;
        for (const dir of nodeModulesDirs) {
            const pkgDir = path.join(dir, ...name.split("/"));
            try {
                const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
                found = { dir: pkgDir, pkg };
                break;
            } catch { /* tenta o próximo */ }
        }
        pkgCache.set(name, found);
        return found;
    }

    /**
     * Retorna { filePath, wrapEsm } para servir localmente, ou { redirect } para o CDN,
     * ou { stub } para recursos que o desktop desativa de propósito.
     */
    function resolve(urlPath) {
        if (urlPath.startsWith(`${LOCAL_PREFIX}pyodide/`)) {
            return { stub: "/* BIM Viewer Desktop: Pyodide desativado — IFC é convertido nativamente. */\n" };
        }
        if (!urlPath.startsWith(`${LOCAL_PREFIX}npm/`)) {
            return { redirect: CDN_ORIGIN + urlPath.slice(LOCAL_PREFIX.length) };
        }
        const spec = parseNpmPath(urlPath);
        const redirect = CDN_ORIGIN + urlPath.slice(LOCAL_PREFIX.length);
        if (!spec) return { redirect };
        const pkg = findPackage(spec.name);
        if (!pkg || pkg.pkg.version !== spec.version) return { redirect };

        let rel = spec.file;
        if (!rel) rel = pkg.pkg.main || "index.js";
        const filePath = path.resolve(pkg.dir, rel);
        if (!filePath.startsWith(pkg.dir + path.sep)) return { redirect };
        try {
            if (!fs.statSync(filePath).isFile()) return { redirect };
        } catch {
            return { redirect };
        }
        return { filePath, wrapEsm: spec.esm };
    }

    return { resolve };
}

/** Envolve um script CommonJS/UMD como módulo ES (equivalente ao "+esm" do jsDelivr). */
function wrapCommonJsAsEsm(source) {
    return [
        "const module = { exports: {} };",
        "const exports = module.exports;",
        "(function (module, exports) {",
        source,
        "}).call(globalThis, module, exports);",
        "export default module.exports;"
    ].join("\n");
}

module.exports = { CDN_ORIGIN, LOCAL_PREFIX, rewriteCdnUrls, parseNpmPath, createVendorResolver, wrapCommonJsAsEsm };
