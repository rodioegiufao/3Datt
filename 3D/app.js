// Bootstrap mínimo: valida o cookie HttpOnly antes de baixar o viewer autenticado.
import { getViewerSession } from "./viewer/core/auth-session.js";

function loadClassicScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = resolve;
        script.onerror = reject;
        document.head.append(script);
    });
}

async function start() {
    const user = await getViewerSession().catch((error) => {
        console.warn("Autenticação indisponível; iniciando visualização pública segura.", error);
        return null;
    });
    if (!user) {
        const { startPublicViewer } = await import("./viewer/viewer-public.js");
        startPublicViewer();
        return;
    }

    window.__VIEWER_AUTH_USER__ = user;
    await loadClassicScript("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");
    await import("./viewer/viewer-authenticated.js");
    loadClassicScript("/3D/user-badge.js");

    if (document.body?.dataset?.project === "ifc_upload") {
        await loadClassicScript("https://cdn.jsdelivr.net/pyodide/v0.28.0a3/full/pyodide.js");
        await import("./ifc_upload.js");
    }
}

start().catch(async (error) => {
    console.error("Falha ao iniciar o visualizador; usando modo público.", error);
    if (!window.__VIEWER_AUTH_USER__) {
        const { startPublicViewer } = await import("./viewer/viewer-public.js");
        startPublicViewer();
    }
});