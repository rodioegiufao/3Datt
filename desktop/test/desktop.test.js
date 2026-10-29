"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startServer, safeJoin } = require("../electron/server");
const { PATCHES, applyOne } = require("../electron/patches");
const { parseNpmPath, rewriteCdnUrls } = require("../electron/vendor");
const { IfcConverter } = require("../electron/ifc-converter");
const { loadCatalog } = require("../electron/projects");

const ROOT = path.resolve(__dirname, "..");
const SITE = path.resolve(ROOT, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bimd-"));

async function withServer(options, fn) {
    const local = await startServer({
        siteDir: SITE,
        rendererDir: path.join(ROOT, "renderer"),
        nodeModulesDirs: [path.join(ROOT, "node_modules")],
        remoteCacheDir: path.join(tmp, "remote"),
        conversionCacheDir: path.join(tmp, "conv"),
        getPrefs: () => ({ profile: "admin", remoteEnabled: false }),
        getBoostConfig: () => ({ quality: "max" }),
        ...options
    });
    try { await fn(local); } finally { await local.close(); }
}

test("todos os ajustes encontram o trecho exato no código atual do site", () => {
    for (const patch of PATCHES) {
        const source = fs.readFileSync(path.join(SITE, patch.file), "utf8");
        const result = applyOne(source, patch);
        assert.notEqual(result, null, `ajuste ${patch.id} não se aplica a ${patch.file}`);
    }
});

test("arquivos ajustados continuam com sintaxe válida", async () => {
    const files = [...new Set(PATCHES.map((p) => p.file))];
    for (const file of files) {
        let text = fs.readFileSync(path.join(SITE, file), "utf8");
        for (const p of PATCHES.filter((x) => x.file === file)) text = applyOne(text, p);
        const out = path.join(tmp, `check-${path.basename(file, ".js")}.mjs`);
        // troca imports por nada para checar só a sintaxe do módulo
        fs.writeFileSync(out, text);
        const { execFileSync } = require("node:child_process");
        execFileSync(process.execPath, ["--check", out]);
    }
});

test("bloqueia path traversal", () => {
    assert.equal(safeJoin("/tmp/base", "/../etc/passwd"), null);
});

test("URLs do CDN viram locais e versões empacotadas são servidas", async () => {
    assert.equal(rewriteCdnUrls('import x from "https://cdn.jsdelivr.net/npm/a@1/b.js"'), 'import x from "/__cdn/npm/a@1/b.js"');
    assert.deepEqual(parseNpmPath("/__cdn/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js"),
        { name: "@xeokit/xeokit-sdk", version: "2.6.107", file: "dist/xeokit-sdk.min.es.js", esm: false });
    await withServer({}, async ({ url }) => {
        let r = await fetch(`${url}/__cdn/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js`);
        assert.equal(r.status, 200);
        assert.ok((await r.text()).length > 1_000_000);
        r = await fetch(`${url}/__cdn/npm/jspdf@2.5.1/dist/jspdf.umd.min.js`);
        assert.equal(r.status, 200);
        r = await fetch(`${url}/__cdn/npm/xlsx@0.18.5/dist/xlsx.full.min.js`);
        assert.equal(r.status, 200);
        r = await fetch(`${url}/__cdn/npm/qrcode-generator@1.4.4/+esm`);
        assert.equal(r.status, 200);
        assert.match(await r.text(), /export default module\.exports/);
        r = await fetch(`${url}/__cdn/npm/web-ifc@0.0.57/web-ifc.wasm`, { redirect: "manual" });
        assert.equal(r.status, 302, "versão não empacotada vai para o CDN");
        r = await fetch(`${url}/__cdn/pyodide/v0.28.0a3/full/pyodide.js`);
        assert.match(await r.text(), /Pyodide desativado/);
    });
});

test("página de projeto, sessão local e arquivos ajustados", async () => {
    await withServer({}, async ({ url }) => {
        let r = await fetch(`${url}/`);
        assert.match(await r.text(), /BIM Viewer Desktop/);
        r = await fetch(`${url}/3D/TCE`);
        const html = await r.text();
        assert.match(html, /\/__desktop\/boost\.js/);
        assert.match(html, /data-project="tce"/);
        assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
        r = await fetch(`${url}/3D/tce`, { redirect: "manual" });
        assert.equal(r.status, 302);
        r = await fetch(`${url}/3D/ifc_upload`);
        assert.match(await r.text(), /boost\.js[\s\S]*ifcUploadInput/);
        r = await fetch(`${url}/api/auth`);
        assert.equal((await r.json()).user.perfil, "admin");
        r = await fetch(`${url}/3D/viewer/viewer-authenticated.js`);
        const js = await r.text();
        assert.match(js, /__BIM_DESKTOP__\?\.onViewer/);
        assert.match(js, /from "\/__cdn\/npm\/@xeokit/);
        r = await fetch(`${url}/3D/app.js`);
        assert.match(await r.text(), /if \(!window\.__BIM_DESKTOP__\) await loadClassicScript\("\/__cdn\/pyodide/);
        r = await fetch(`${url}/__desktop/boost.js`);
        assert.match(await r.text(), /__BIM_DESKTOP_CONFIG__ = \{"quality":"max"\}/);
        r = await fetch(`${url}/api/qualquer`);
        assert.equal(r.status, 503);
        r = await fetch(`${url}/3D/drogaria/modelo-01.xkt`);
        assert.equal(r.status, 200);
        const etag = r.headers.get("etag");
        r = await fetch(`${url}/3D/drogaria/modelo-01.xkt`, { headers: { "If-None-Match": etag } });
        assert.equal(r.status, 304);
    });
});

test("pasta de modelos do usuário tem prioridade e aceita arquivos soltos", async () => {
    const dir = path.join(tmp, "models");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "XKT-ARQ-TCE.xkt"), "x");
    await withServer({ getModelsDirs: () => [dir] }, async ({ url }) => {
        const r = await fetch(`${url}/3D/TCE/XKT-ARQ-TCE.xkt`);
        assert.equal(r.status, 200);
        assert.equal(await r.text(), "x");
    });
});

test("modelo ausente é baixado do site e fica em cache para uso offline", async () => {
    let calls = 0;
    const fakeFetch = async (u, init = {}) => {
        calls++;
        assert.equal(u, "https://exemplo.test/3D/TCE/XKT-EMT-TCE-FUNDA%C3%87%C3%83O.xkt");
        if (init.method === "HEAD") return new Response(null, { status: 200, headers: { etag: "a" } });
        return new Response("geometria", { status: 200, headers: { etag: "a", "content-type": "application/octet-stream" } });
    };
    await withServer({ fetchImpl: fakeFetch, getPrefs: () => ({ remoteEnabled: true, remoteOrigin: "https://exemplo.test" }) }, async ({ url }) => {
        const target = `${url}/3D/TCE/${encodeURIComponent("XKT-EMT-TCE-FUNDAÇÃO.xkt")}`;
        let r = await fetch(target);
        assert.equal(await r.text(), "geometria");
        r = await fetch(target);
        assert.equal(await r.text(), "geometria");
        assert.ok(fs.existsSync(path.join(tmp, "remote", "3D", "TCE", "XKT-EMT-TCE-FUNDAÇÃO.xkt")));
        assert.equal(calls, 2, "1 download + 1 verificação em segundo plano");
    });
});

test("catálogo de projetos é lido do site", async () => {
    const catalog = await loadCatalog(SITE);
    const tce = catalog.find((p) => p.slug === "TCE");
    assert.ok(tce && tce.srcs.length > 10);
});

test("converte IFC em XKT num processo separado e reaproveita o cache", { timeout: 120000 }, async () => {
    const ifc = path.join(__dirname, "fixtures", "example.ifc");
    if (!fs.existsSync(ifc)) return;
    const converter = new IfcConverter({ cacheDir: path.join(tmp, "conv") });
    const stages = [];
    const first = await converter.convert(ifc, (p) => stages.push(p.stage));
    assert.equal(first.cached, false);
    assert.ok(first.objects > 0);
    assert.ok(fs.statSync(first.file).size > 1000);
    assert.ok(stages.length >= 3, `etapas: ${stages.join(" | ")}`);
    const second = await converter.convert(ifc);
    assert.equal(second.cached, true);
    assert.equal(second.file, first.file);
    // XKT lido pelo mesmo xeokit do visualizador
    const head = new DataView(fs.readFileSync(first.file).buffer);
    assert.ok([10, 11, 12].includes(head.getUint32(0, true) & 0x7fffffff), "versão XKT suportada pelo xeokit 2.6");
});
