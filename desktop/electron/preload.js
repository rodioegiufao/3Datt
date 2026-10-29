"use strict";
// Ponte segura entre as páginas e o processo principal (contextIsolation + sandbox).
const { contextBridge, ipcRenderer, webUtils } = require("electron");

let jobSeq = 0;

contextBridge.exposeInMainWorld("bimDesktop", {
    isDesktop: true,

    /** Caminho no disco de um File vindo de <input type=file> ou arrastar-e-soltar ("" se não houver). */
    pathForFile(file) {
        try { return webUtils.getPathForFile(file) || ""; } catch { return ""; }
    },

    /** Converte um IFC nativamente. Resolve { url, name, cached, seconds, ... }. */
    async convertIfc(filePath, onProgress) {
        const jobId = `job-${Date.now()}-${++jobSeq}`;
        const listener = (_event, payload) => {
            if (payload?.jobId === jobId && typeof onProgress === "function") onProgress(payload.progress);
        };
        ipcRenderer.on("ifc:progress", listener);
        try {
            return await ipcRenderer.invoke("ifc:convert", { filePath, jobId });
        } finally {
            ipcRenderer.removeListener("ifc:progress", listener);
        }
    },

    prewarmIfc(filePaths) { ipcRenderer.send("ifc:prewarm", filePaths); },
    openFileDialog() { return ipcRenderer.invoke("open:dialog"); },
    openPaths(filePaths) { return ipcRenderer.invoke("open:paths", filePaths); },
    takePendingOpens() { return ipcRenderer.invoke("open:take"); },
    action(name, arg) { return ipcRenderer.invoke("desktop:action", name, arg); },
    reportGpu(info) { ipcRenderer.send("gpu:report", info); },

    onConfig(callback) {
        ipcRenderer.on("desktop:config", (_e, config) => callback(config));
    },
    onEvent(callback) {
        ipcRenderer.on("desktop:event", (_e, event) => callback(event));
    }
});
