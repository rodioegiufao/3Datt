/** Runs the CPU-heavy broad/narrow phases outside the render thread. */
export function runXktClashAnalysis({ objectsA, objectsB, mode = "intersection", epsilon = 0.001, clearance = 0.05, sameModel = false, signal, onProgress }) {
    const worker = new Worker(new URL("./xkt-clash-worker.js", import.meta.url), { type: "module" });
    return new Promise((resolve, reject) => {
        const abort = () => { worker.postMessage({ type: "cancel" }); worker.terminate(); reject(new DOMException("Análise cancelada", "AbortError")); };
        signal?.addEventListener("abort", abort, { once: true });
        worker.onerror = (event) => { worker.terminate(); reject(new Error(event.message || "Falha no worker geométrico.")); };
        worker.onmessage = ({ data }) => {
            if (data.type === "progress") onProgress?.(data);
            if (data.type === "cancelled") abort();
            if (data.type === "result") { signal?.removeEventListener("abort", abort); worker.terminate(); resolve(data); }
        };
        worker.postMessage({ type: "analyze", objectsA, objectsB, options: { mode, epsilon, clearance, sameModel } });
    });
}