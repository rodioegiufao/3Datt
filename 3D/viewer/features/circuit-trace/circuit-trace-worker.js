// Monta a rede de caminhos fora da tela principal (pode levar alguns segundos em modelos grandes)
// e responde aos rastreios de circuito. A rede de cada modelo fica guardada.
import { buildRouteGraph, traceCircuit, traceCircuits } from "./circuit-trace-core.js";

const graphs = new Map();   // modelKey -> { graph, indexById }

self.onmessage = ({ data }) => {
    try {
        if (data.type === "build") {
            const started = performance.now();
            const elements = data.elements.map((element) => ({
                id: element.id,
                kind: element.kind,
                positions: element.positions,
                indices: element.indices
            }));
            const graph = buildRouteGraph(elements);
            const indexById = new Map(elements.map((element, index) => [element.id, index]));
            graphs.set(data.modelKey, { graph, indexById });
            let contacts = 0, gaps = 0;
            graph.links.forEach((links) => links.forEach((type) => { if (type === "gap") gaps++; else contacts++; }));
            self.postMessage({
                type: "built",
                requestId: data.requestId,
                stats: { elements: elements.length, contacts: contacts / 2, gaps: gaps / 2, seconds: (performance.now() - started) / 1000 }
            });
        } else if (data.type === "trace") {
            const entry = graphs.get(data.modelKey);
            if (!entry) throw new Error("Rede do modelo ainda não montada.");
            const { graph, indexById } = entry;
            const panelIndices = (data.panelIds || [data.panelId]).map((id) => indexById.get(id)).filter((index) => index !== undefined);
            if (!panelIndices.length) throw new Error("Quadro não encontrado na rede.");
            const pointIndices = data.pointIds.map((id) => indexById.get(id)).filter((index) => index !== undefined);
            const result = traceCircuit(graph, panelIndices, pointIndices);
            const idOf = (index) => graph.elements[index].id;
            self.postMessage({
                type: "traced",
                requestId: data.requestId,
                route: [...result.route].map(idOf),
                reached: result.reached.map(idOf),
                unreached: result.unreached.map(idOf),
                length: result.length,
                gaps: result.gaps
            });
        } else if (data.type === "traceMany") {
            // comprimento de vários circuitos do mesmo quadro/rack (ex.: verificação de 90 m)
            const entry = graphs.get(data.modelKey);
            if (!entry) throw new Error("Rede do modelo ainda não montada.");
            const { graph, indexById } = entry;
            const panelIndices = data.panelIds.map((id) => indexById.get(id)).filter((index) => index !== undefined);
            if (!panelIndices.length) throw new Error("Quadro não encontrado na rede.");
            const circuits = {};
            for (const [key, ids] of Object.entries(data.circuits)) {
                circuits[key] = ids.map((id) => indexById.get(id)).filter((index) => index !== undefined);
            }
            self.postMessage({ type: "tracedMany", requestId: data.requestId, results: traceCircuits(graph, panelIndices, circuits) });
        } else if (data.type === "forget") {
            graphs.delete(data.modelKey);
        }
    } catch (error) {
        self.postMessage({ type: "error", requestId: data.requestId, message: String(error?.message || error) });
    }
};
