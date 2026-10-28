import { analyzeXktObjects, broadPhase } from "./xkt-clash-core.js";

let cancelled = false;
self.onmessage = ({ data }) => {
    if (data?.type === "cancel") { cancelled = true; return; }
    if (data?.type !== "analyze") return;
    cancelled = false;
    const { objectsA, objectsB, options } = data;
    const candidates = broadPhase(objectsA, objectsB, { padding: options.mode === "clearance" ? options.clearance : 0, sameModel: options.sameModel });
    self.postMessage({ type: "progress", phase: "broad", candidates: candidates.length });
    const clashes = [];
    for (let index = 0; index < candidates.length; index++) {
        if (cancelled) { self.postMessage({ type: "cancelled" }); return; }
        const result = analyzeXktObjects([candidates[index][0]], [candidates[index][1]], options).clashes[0];
        if (result) clashes.push(result);
        if (index % 10 === 0 || index + 1 === candidates.length) self.postMessage({ type: "progress", phase: "narrow", current: index + 1, total: candidates.length });
    }
    self.postMessage({ type: "result", candidates: candidates.length, clashes });
};