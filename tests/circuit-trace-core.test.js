// Traçado de circuitos: prioridade eletrocalha → perfilado → eletroduto e ligações só onde as peças se ligam de fato.
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

/** Caixa (8 vértices, 12 triângulos) — serve para peças, pontos e quadros. */
function caixa(x0, y0, z0, x1, y1, z1) {
    return {
        positions: Float32Array.from([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]),
        indices: Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 2, 6, 1, 6, 5])
    };
}
// eletroduto de 2 cm de lado ao longo de um eixo
const eletrodutoX = (x0, x1, y, z) => caixa(x0, y - 0.01, z - 0.01, x1, y + 0.01, z + 0.01);
const eletrodutoY = (y0, y1, x, z) => caixa(x - 0.01, y0, z - 0.01, x + 0.01, y1, z + 0.01);
const ponto = (x, y, z) => caixa(x - 0.05, y - 0.05, z - 0.05, x + 0.05, y + 0.05, z + 0.05);

(async () => {
    const core = await import(pathToFileURL(path.join(__dirname, "..", "3D/viewer/features/circuit-trace/circuit-trace-core.js")).href);
    const ids = (graph, result) => [...result.route].map((i) => graph.elements[i].id).sort();

    // 1) Eletroduto que apenas CRUZA outro no meio não forma caminho
    {
        const els = [
            { id: "QD", kind: "panel", ...ponto(0, 0, 0) },
            { id: "C1", kind: "route", routeType: "conduit", ...eletrodutoX(0.04, 10, 0, 0) },
            { id: "A", kind: "point", ...ponto(10.05, 0, 0) },
            // C2 atravessa C1 no meio (x = 5) e vai até o ponto B
            { id: "C2", kind: "route", routeType: "conduit", ...eletrodutoY(-3, 3, 5, 0) },
            { id: "B", kind: "point", ...ponto(5, 3.05, 0) }
        ];
        const graph = core.buildRouteGraph(els);
        const r = core.traceCircuit(graph, [0], [2, 4]);
        assert.deepStrictEqual(r.reached.map((i) => els[i].id), ["A"]);
        assert.deepStrictEqual(r.unreached.map((i) => els[i].id), ["B"], "cruzamento no meio do eletroduto não é ligação");
    }

    // 2) Prioridade: pela eletrocalha, mesmo que o eletroduto direto seja mais curto
    {
        const els = [
            { id: "QD", kind: "panel", ...ponto(0, 0, 0) },
            // eletrocalha de 10 m saindo do quadro
            { id: "EC", kind: "route", routeType: "tray", ...caixa(0.04, -0.05, -0.05, 10, 0.05, 0.05) },
            // descida curta da eletrocalha até o ponto
            { id: "C-desce", kind: "route", routeType: "conduit", ...eletrodutoY(-2, -0.04, 9, 0) },
            { id: "P", kind: "point", ...ponto(9, -2.05, 0) },
            // eletroduto direto do quadro ao ponto (mais curto, mas eletroduto)
            { id: "C-direto", kind: "route", routeType: "conduit", ...caixa(0, -2.06, -0.01, 8.96, -2.04, 0.01) }
        ];
        // C-direto encosta no quadro? deixa-o encostar na ponta, perto do quadro
        els[4] = { id: "C-direto", kind: "route", routeType: "conduit", ...caixa(-0.02, -2.06, -0.01, 8.96, -2.04, 0.01) };
        els.push({ id: "C-sobe", kind: "route", routeType: "conduit", ...eletrodutoY(-2.04, -0.04, -0.02, 0) });
        const graph = core.buildRouteGraph(els);
        const r = core.traceCircuit(graph, [0], [3]);
        assert.deepStrictEqual(r.reached.map((i) => els[i].id), ["P"]);
        assert.ok(ids(graph, r).includes("EC"), "o circuito deve seguir pela eletrocalha");
        assert.ok(!ids(graph, r).includes("C-direto"), "o eletroduto direto só seria usado sem eletrocalha");
        // percorre só o trecho usado da eletrocalha (até x = 9), e não a peça inteira
        assert.ok(r.length > 10 && r.length < 12, `comprimento ${r.length}`);
    }

    // 3) Perfilado antes de eletroduto
    {
        const els = [
            { id: "QD", kind: "panel", ...ponto(0, 0, 0) },
            { id: "PF", kind: "route", routeType: "perfilado", ...caixa(0.04, -0.02, -0.02, 6, 0.02, 0.02) },
            { id: "C-pf", kind: "route", routeType: "conduit", ...eletrodutoY(0.02, 1.5, 6, 0) },
            { id: "C-alt", kind: "route", routeType: "conduit", ...caixa(-0.02, 1.49, -0.01, 6.02, 1.51, 0.01) },
            { id: "C-alt-quadro", kind: "route", routeType: "conduit", ...eletrodutoY(0.04, 1.49, -0.02, 0) },
            { id: "P", kind: "point", ...ponto(6, 1.55, 0) }
        ];
        const graph = core.buildRouteGraph(els);
        const r = core.traceCircuit(graph, [0], [5]);
        assert.ok(ids(graph, r).includes("PF"), "deve ir pelo perfilado");
    }

    // 4) Eletroduto em "U" e malha em pedaços: as pontas são as extremidades reais
    {
        const pedacos = [eletrodutoY(0, 2, 0, 0), eletrodutoX(0, 1, 2, 0), eletrodutoY(0, 2, 1, 0)];
        const positions = [], indices = [];
        pedacos.forEach((m) => { const base = positions.length / 3; positions.push(...m.positions); indices.push(...Array.from(m.indices, (i) => i + base)); });
        const els = [
            { id: "QD", kind: "panel", ...ponto(0, -0.05, 0) },
            { id: "U", kind: "route", routeType: "conduit", positions: Float32Array.from(positions), indices: Uint32Array.from(indices) },
            { id: "P", kind: "point", ...ponto(1, -0.05, 0) }
        ];
        const graph = core.buildRouteGraph(els);
        const r = core.traceCircuit(graph, [0], [2]);
        assert.deepStrictEqual(r.reached.map((i) => els[i].id), ["P"], "as duas pernas do U são as pontas");
        assert.ok(r.length > 4, "comprimento ao longo do U, não a distância em linha reta");
    }

    // 5) Vários circuitos de uma vez
    {
        const els = [
            { id: "QD", kind: "panel", ...ponto(0, 0, 0) },
            { id: "C1", kind: "route", routeType: "conduit", ...eletrodutoX(0.04, 5, 0, 0) },
            { id: "A", kind: "point", ...ponto(5.05, 0, 0) }
        ];
        const graph = core.buildRouteGraph(els);
        const res = core.traceCircuits(graph, [0], { "1": [2] });
        assert.strictEqual(res["1"].reached, 1);
        assert.ok(Math.abs(res["1"].length - 4.96) < 0.2);
    }

    console.log("circuit-trace-core: ok");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
