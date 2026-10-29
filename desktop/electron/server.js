"use strict";
// Servidor HTTP local (somente 127.0.0.1) que entrega o site do visualizador ao Electron.
//
// Ordem para encontrar um arquivo /3D/...:
//   1. pastas de modelos escolhidas pelo usuário
//   2. arquivos do site empacotados no app
//   3. cache de modelos baixados do site (uso offline)
//   4. download do site publicado (e grava no cache para a próxima vez)

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { applyPatches, hasPatches } = require("./patches");
const { rewriteCdnUrls, LOCAL_PREFIX, createVendorResolver, wrapCommonJsAsEsm } = require("./vendor");

const MIME = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".xkt": "application/octet-stream",
    ".wasm": "application/wasm", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2",
    ".ttf": "font/ttf", ".pdf": "application/pdf", ".ifc": "application/octet-stream", ".glb": "model/gltf-binary",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8"
};
const TEXT_EXT = new Set([".html", ".js", ".mjs", ".css"]);
const REMOTE_EXT = new Set([".xkt", ".glb", ".json", ".xlsx", ".ifc", ".png", ".jpg", ".jpeg", ".webp"]);

function safeJoin(base, urlPath) {
    const root = path.resolve(base);
    const resolved = path.resolve(root, `.${urlPath}`);
    return resolved === root || resolved.startsWith(root + path.sep) ? resolved : null;
}

function isFile(p) {
    try { return Boolean(p) && fs.statSync(p).isFile(); } catch { return false; }
}

function injectBoost(html) {
    const tag = '<script src="/__desktop/boost.js"></script>';
    if (html.includes(tag)) return html;
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`) : tag + html;
}

function startServer({
    siteDir,
    rendererDir,
    nodeModulesDirs = [],
    remoteCacheDir,
    conversionCacheDir,
    getModelsDirs = () => [],
    getPrefs = () => ({}),
    getBoostConfig = () => ({}),
    getState = async () => ({}),
    fetchImpl = globalThis.fetch,
    preferredPort = 0
}) {
    const site = path.resolve(siteDir);
    const vendor = createVendorResolver(nodeModulesDirs);
    const textCache = new Map();        // filePath -> { mtimeMs, body }
    const openTokens = new Map();       // token -> filePath
    const revalidated = new Set();
    const downloads = new Map();        // urlPath -> Promise<filePath|null>

    let viewerProjects = null;
    let renderViewerPage = null;
    try {
        ({ findViewerProject: viewerProjects } = require(path.join(site, "api", "_viewer-projects.js")));
        ({ renderViewerPage } = require(path.join(site, "api", "viewer-page.js")));
    } catch (error) {
        console.error("[desktop] não foi possível carregar o cadastro de projetos do site:", error.message);
    }

    // ------------------------------------------------------------------ resolução de arquivos
    function findLocal(urlPath) {
        if (urlPath.startsWith("/3D/")) {
            for (const dir of getModelsDirs()) {
                const rel = urlPath.slice("/3D".length);              // /TCE/x.xkt
                const candidates = [safeJoin(dir, urlPath), safeJoin(dir, rel)];
                if (/\.(xkt|ifc|glb)$/i.test(urlPath)) candidates.push(safeJoin(dir, `/${path.basename(rel)}`));
                const hit = candidates.find(isFile);
                if (hit) return { file: hit, source: "pasta" };
            }
        }
        const inSite = safeJoin(site, urlPath);
        if (isFile(inSite)) return { file: inSite, source: "app" };
        if (remoteCacheDir && urlPath.startsWith("/3D/")) {
            const cached = safeJoin(remoteCacheDir, urlPath);
            if (isFile(cached)) return { file: cached, source: "cache" };
        }
        return null;
    }

    function remoteAllowed(urlPath) {
        const prefs = getPrefs();
        return Boolean(prefs.remoteEnabled && prefs.remoteOrigin && remoteCacheDir && fetchImpl)
            && urlPath.startsWith("/3D/") && REMOTE_EXT.has(path.extname(urlPath).toLowerCase());
    }

    function remoteUrl(urlPath) {
        const encoded = urlPath.split("/").map((seg) => encodeURIComponent(seg)).join("/");
        return getPrefs().remoteOrigin.replace(/\/$/, "") + encoded;
    }

    /** Baixa um arquivo do site para o cache. Retorna o caminho local ou null. */
    function download(urlPath) {
        if (downloads.has(urlPath)) return downloads.get(urlPath);
        const promise = (async () => {
            const target = safeJoin(remoteCacheDir, urlPath);
            if (!target) return null;
            const response = await fetchImpl(remoteUrl(urlPath));
            if (!response.ok || !response.body) return null;
            const type = response.headers.get("content-type") || "";
            if (/text\/html/i.test(type)) return null; // página de erro/login, não é modelo
            fs.mkdirSync(path.dirname(target), { recursive: true });
            const part = `${target}.${process.pid}.${Date.now()}.part`;
            await new Promise((resolve, reject) => {
                const out = fs.createWriteStream(part);
                Readable.fromWeb(response.body).on("error", reject).pipe(out).on("finish", resolve).on("error", reject);
            });
            fs.renameSync(part, target);
            fs.writeFileSync(`${target}.meta.json`, JSON.stringify({
                etag: response.headers.get("etag"),
                lastModified: response.headers.get("last-modified"),
                size: fs.statSync(target).size,
                downloadedAt: new Date().toISOString()
            }));
            return target;
        })().catch((error) => {
            console.warn(`[desktop] não foi possível baixar ${urlPath}: ${error.message}`);
            return null;
        }).finally(() => downloads.delete(urlPath));
        downloads.set(urlPath, promise);
        return promise;
    }

    /** Em segundo plano: se o modelo mudou no site, apaga o cache (próxima abertura baixa o novo). */
    function revalidate(urlPath, file) {
        if (revalidated.has(urlPath) || !remoteAllowed(urlPath)) return;
        revalidated.add(urlPath);
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(`${file}.meta.json`, "utf8")); } catch { return; }
        fetchImpl(remoteUrl(urlPath), { method: "HEAD" }).then((r) => {
            if (!r.ok) return;
            const etag = r.headers.get("etag");
            const size = Number(r.headers.get("content-length") || 0);
            const changed = (etag && meta.etag && etag !== meta.etag) || (size && meta.size && size !== meta.size);
            if (changed) {
                fs.rmSync(file, { force: true });
                fs.rmSync(`${file}.meta.json`, { force: true });
                console.log(`[desktop] ${urlPath} mudou no site; será baixado de novo na próxima abertura.`);
            }
        }).catch(() => { /* offline */ });
    }

    // ------------------------------------------------------------------ respostas
    function sendText(res, req, status, body, type = "text/plain; charset=utf-8", extra = {}) {
        res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra });
        res.end(req.method === "HEAD" ? undefined : body);
    }

    function sendJson(res, req, status, data) {
        sendText(res, req, status, JSON.stringify(data), "application/json; charset=utf-8");
    }

    function readTransformed(file, urlPath) {
        const st = fs.statSync(file);
        const cached = textCache.get(file);
        if (cached && cached.mtimeMs === st.mtimeMs && cached.urlPath === urlPath) return cached.body;
        let body = fs.readFileSync(file, "utf8");
        if (hasPatches(urlPath)) body = applyPatches(urlPath, body);
        body = rewriteCdnUrls(body);
        if (path.extname(file).toLowerCase() === ".html" && /id=["']meuCanvas["']/.test(body)) body = injectBoost(body);
        textCache.set(file, { mtimeMs: st.mtimeMs, urlPath, body });
        return body;
    }

    function serveFile(req, res, file, { urlPath, immutable = false, transform = false } = {}) {
        const st = fs.statSync(file);
        const ext = path.extname(file).toLowerCase();
        const type = MIME[ext] || "application/octet-stream";
        const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}${transform ? "-t" : ""}"`;
        const headers = {
            "Content-Type": type,
            "X-Content-Type-Options": "nosniff",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
            ETag: etag
        };
        if (req.headers["if-none-match"] === etag) {
            res.writeHead(304, headers);
            res.end();
            return;
        }
        if (transform && TEXT_EXT.has(ext)) {
            const body = readTransformed(file, urlPath);
            res.writeHead(200, { ...headers, "Content-Length": Buffer.byteLength(body) });
            res.end(req.method === "HEAD" ? undefined : body);
            return;
        }
        res.writeHead(200, { ...headers, "Content-Length": st.size });
        if (req.method === "HEAD") { res.end(); return; }
        fs.createReadStream(file, { highWaterMark: 4 * 1024 * 1024 }).pipe(res);
    }

    function serveVendor(req, res, urlPath) {
        const hit = vendor.resolve(urlPath);
        if (hit.stub) return sendText(res, req, 200, hit.stub, "text/javascript; charset=utf-8");
        if (hit.redirect) {
            res.writeHead(302, { Location: hit.redirect, "Cache-Control": "no-store" });
            res.end();
            return;
        }
        if (hit.wrapEsm) {
            const body = wrapCommonJsAsEsm(fs.readFileSync(hit.filePath, "utf8"));
            res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*" });
            res.end(req.method === "HEAD" ? undefined : body);
            return;
        }
        serveFile(req, res, hit.filePath, { immutable: true });
    }

    async function handle(req, res) {
        const url = new URL(req.url, "http://127.0.0.1");
        let urlPath;
        try { urlPath = decodeURIComponent(url.pathname); } catch { return sendText(res, req, 400, "URL inválida"); }
        if (req.method !== "GET" && req.method !== "HEAD") {
            if (urlPath.startsWith("/api/")) return sendJson(res, req, 503, { error: "Recurso online indisponível no aplicativo desktop." });
            return sendText(res, req, 405, "Método não permitido");
        }

        // Tela inicial e recursos do desktop
        if (urlPath === "/" || urlPath === "/index.html" || urlPath === "/3D" || urlPath === "/3D/" || urlPath === "/3D/index.html") {
            if (urlPath !== "/") { res.writeHead(302, { Location: "/" }); res.end(); return; }
            return serveFile(req, res, path.join(rendererDir, "home.html"));
        }
        if (urlPath === "/__desktop/boost.js") {
            const body = `window.__BIM_DESKTOP_CONFIG__ = ${JSON.stringify(getBoostConfig())};\n${fs.readFileSync(path.join(rendererDir, "boost.js"), "utf8")}`;
            return sendText(res, req, 200, body, "text/javascript; charset=utf-8");
        }
        if (urlPath === "/__desktop/api/state") return sendJson(res, req, 200, await getState());
        if (urlPath.startsWith("/__desktop/cache/")) {
            const name = path.basename(urlPath);
            const file = /^[a-f0-9]{40}\.xkt$/.test(name) ? path.join(conversionCacheDir, name) : null;
            return isFile(file) ? serveFile(req, res, file, { immutable: true }) : sendText(res, req, 404, "Conversão não encontrada");
        }
        if (urlPath.startsWith("/__desktop/file/")) {
            const file = openTokens.get(path.basename(urlPath));
            return isFile(file) ? serveFile(req, res, file) : sendText(res, req, 404, "Arquivo não encontrado");
        }
        if (urlPath.startsWith("/__desktop/")) {
            const file = safeJoin(rendererDir, urlPath.slice("/__desktop".length));
            return isFile(file) ? serveFile(req, res, file) : sendText(res, req, 404, "Não encontrado");
        }
        if (urlPath.startsWith(LOCAL_PREFIX)) return serveVendor(req, res, urlPath);

        // Sessão local: o visualizador completo abre sem login (perfil escolhido no menu)
        if (urlPath === "/api/auth") {
            const profile = getPrefs().profile === "cliente" ? "cliente" : "admin";
            return sendJson(res, req, 200, { user: { id: "desktop", nome: profile === "cliente" ? "Apresentação" : "BIM Viewer Desktop", usuario: "desktop", perfil: profile } });
        }
        if (urlPath.startsWith("/api/")) return sendJson(res, req, 503, { error: "Recurso online indisponível no aplicativo desktop." });

        // Páginas de projeto (/3D/TCE etc.), montadas como na Vercel
        const pageMatch = urlPath.match(/^\/3D\/([^/.]+)(?:\.html)?\/?$/);
        if (pageMatch && viewerProjects && renderViewerPage) {
            const project = viewerProjects(pageMatch[1]);
            if (project) {
                if (project.slug !== pageMatch[1]) { res.writeHead(302, { Location: `/3D/${project.slug}${url.search}` }); res.end(); return; }
                // viewer-page.js do site lê 3D/viewer.html a partir de process.cwd() (raiz do projeto na Vercel)
                const previousCwd = process.cwd();
                let rendered;
                try {
                    process.chdir(site);
                    rendered = renderViewerPage(project, { origin: "http://127.0.0.1" });
                } finally {
                    process.chdir(previousCwd);
                }
                const html = injectBoost(rewriteCdnUrls(rendered));
                return sendText(res, req, 200, html, "text/html; charset=utf-8");
            }
        }

        // Arquivos estáticos e modelos
        let local = findLocal(urlPath);
        if (!local && !path.extname(urlPath)) local = findLocal(`${urlPath}.html`); // cleanUrls da Vercel
        if (local) {
            const servedPath = local.file.endsWith(".html") && !urlPath.endsWith(".html") ? `${urlPath}.html` : urlPath;
            if (local.source === "cache") revalidate(urlPath, local.file);
            return serveFile(req, res, local.file, { urlPath: servedPath, transform: local.source === "app" });
        }
        if (remoteAllowed(urlPath)) {
            const file = await download(urlPath);
            if (file) return serveFile(req, res, file);
        }
        return sendText(res, req, 404, `Arquivo não encontrado: ${urlPath}`);
    }

    const server = http.createServer((req, res) => {
        handle(req, res).catch((error) => {
            console.error("[desktop] erro no servidor local:", error);
            if (!res.headersSent) sendText(res, req, 500, "Erro interno");
            else res.destroy();
        });
    });
    server.keepAliveTimeout = 60_000;

    function listen(port) {
        return new Promise((resolve, reject) => {
            const onError = (error) => { server.off("listening", onListening); reject(error); };
            const onListening = () => { server.off("error", onError); resolve(server.address().port); };
            server.once("error", onError);
            server.once("listening", onListening);
            server.listen(port, "127.0.0.1");
        });
    }

    return (async () => {
        let port;
        try {
            port = await listen(preferredPort);
        } catch {
            port = await listen(0); // porta ocupada (outra instância/programa): usa uma livre
        }
        return {
            server,
            port,
            url: `http://127.0.0.1:${port}`,
            findLocal,
            download,
            remoteAllowed,
            registerFile(filePath) {
                const token = `${crypto.randomBytes(16).toString("hex")}${path.extname(filePath).toLowerCase()}`;
                openTokens.set(token, filePath);
                return `/__desktop/file/${token}`;
            },
            close: () => new Promise((resolve) => server.close(resolve))
        };
    })();
}

module.exports = { startServer, safeJoin, injectBoost };
