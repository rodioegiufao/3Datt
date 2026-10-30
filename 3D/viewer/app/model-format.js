// Formatos de modelo aceitos nas páginas de projeto: XKT, GLB e glTF.
// .glb/.gltf vão direto para o carregador glTF. Para .xkt ou endereço sem extensão
// (ex.: links assinados do Supabase), os primeiros bytes do arquivo decidem:
//   "glTF" → GLB, "{" → glTF (JSON), qualquer outra coisa → XKT.
import { GLTFLoaderPlugin } from "https://cdn.jsdelivr.net/npm/@xeokit/xeokit-sdk@2.6.107/dist/xeokit-sdk.min.es.js";

const GLB_MAGIC = 0x46546c67; // "glTF" em little-endian

/** Extensão do arquivo, ignorando ?query e #hash. */
export function detectModelFormatFromUrl(src) {
    const path = String(src || "").split(/[?#]/)[0].toLowerCase();
    if (path.endsWith(".xkt")) return "xkt";
    if (path.endsWith(".glb")) return "glb";
    if (path.endsWith(".gltf")) return "gltf";
    return null;
}

/** Formato pelos primeiros bytes do arquivo. */
export function sniffModelFormat(arrayBuffer) {
    if (!arrayBuffer || arrayBuffer.byteLength < 4) return "xkt";
    const view = new DataView(arrayBuffer);
    if (view.getUint32(0, true) === GLB_MAGIC) return "glb";
    const first = new Uint8Array(arrayBuffer, 0, Math.min(16, arrayBuffer.byteLength));
    const firstChar = [...first].map((b) => String.fromCharCode(b)).join("").trimStart()[0];
    if (firstChar === "{") return "gltf";
    return "xkt";
}

const cleanUrl = (src) => (typeof src === "string" && src.startsWith("blob:") ? src.split("?")[0] : src);

async function fetchArrayBuffer(url) {
    const response = await fetch(cleanUrl(url));
    if (!response.ok) throw new Error(`Falha HTTP ${response.status} ao baixar ${url}`);
    return response.arrayBuffer();
}

/**
 * Carregador único: escolhe XKT ou glTF/GLB sozinho.
 * @param {Viewer} viewer
 * @param {XKTLoaderPlugin} xktLoader carregador XKT já configurado
 */
export function createModelLoader(viewer, xktLoader) {
    // O glTF do xeokit decide se é GLB pela extensão do "src"; usamos um endereço
    // interno terminado em .glb/.gltf e guardamos aqui o endereço real ou os bytes já baixados.
    const sources = new Map();
    let sequence = 0;
    let gltfLoader = null;

    const resolveSource = async (key) => {
        const source = sources.get(key);
        if (!source) throw new Error(`Fonte glTF desconhecida: ${key}`);
        if (source.buffer) return source.buffer;
        source.buffer = await fetchArrayBuffer(source.url);
        return source.buffer;
    };

    function getGltfLoader() {
        gltfLoader ||= new GLTFLoaderPlugin(viewer, {
            dataSource: {
                cacheBuster: false,
                getGLB(src, ok, error) {
                    resolveSource(src).then(ok, (e) => error(e?.message || e));
                },
                getGLTF(src, ok, error) {
                    resolveSource(src)
                        .then((buffer) => ok(JSON.parse(new TextDecoder().decode(buffer))))
                        .catch((e) => error(e?.message || e));
                },
                // Anexos (.bin, texturas) de um .gltf: relativos ao endereço real
                getArrayBuffer(gltfSrc, binarySrc, ok, error) {
                    const base = sources.get(gltfSrc)?.url;
                    if (String(binarySrc).startsWith("data:")) {
                        fetch(binarySrc).then((r) => r.arrayBuffer()).then(ok, (e) => error(e?.message || e));
                        return;
                    }
                    const url = base ? new URL(binarySrc, new URL(cleanUrl(base), window.location.href)).href : binarySrc;
                    fetchArrayBuffer(url).then(ok, (e) => error(e?.message || e));
                },
                getMetaModel(src, ok, error) {
                    fetch(src).then((r) => r.json()).then(ok, (e) => error(e?.message || e));
                }
            }
        });
        return gltfLoader;
    }

    function loadGltf({ id, src, buffer, format, edges, saoEnabled }) {
        sequence += 1;
        const key = `model-source-${sequence}.${format === "gltf" ? "gltf" : "glb"}`;
        sources.set(key, { url: src, buffer });
        const model = getGltfLoader().load({
            id,
            src: key,
            globalizeObjectIds: true,
            autoMetaModel: true,       // aparece no Explorador como um modelo
            edges,
            saoEnabled
        });
        const release = () => sources.delete(key);
        model.on("loaded", release);
        model.on("error", release);
        return model;
    }

    /** Baixa o arquivo, descobre o formato pelos bytes e carrega. */
    function loadBySniffing({ id, src, xktOptions = {}, edges = true, saoEnabled = true }) {
        return fetchArrayBuffer(src).then((buffer) => {
            const sniffed = sniffModelFormat(buffer);
            if (sniffed === "xkt") {
                const { src: _ignored, ...rest } = xktOptions;
                return xktLoader.load({ id, xkt: buffer, ...rest });
            }
            return loadGltf({ id, src, buffer, format: sniffed, edges, saoEnabled });
        });
    }

    /**
     * Carrega um modelo de qualquer formato aceito.
     * Retorna o modelo na hora quando a extensão é conhecida, ou uma Promise com o modelo
     * quando é preciso baixar o início do arquivo para descobrir o formato.
     */
    function load({ id, src, xktOptions = {}, edges = true, saoEnabled = true }) {
        const format = detectModelFormatFromUrl(src);
        if (format === "glb" || format === "gltf") {
            return loadGltf({ id, src, format, edges, saoEnabled });
        }
        // .xkt ou sem extensão: baixa o arquivo (o XKTLoader baixaria do mesmo jeito), confere os
        // primeiros bytes e entrega os mesmos bytes ao carregador certo. Assim um GLB salvo com
        // nome .xkt também abre, em vez de travar com "Unsupported .XKT file version".
        return loadBySniffing({ id, src, xktOptions, edges, saoEnabled });
    }

    return { load, loadBySniffing };
}

