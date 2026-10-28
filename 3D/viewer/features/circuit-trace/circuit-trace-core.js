// Dedução do caminho de um circuito (quadro → pontos) pela geometria da infraestrutura.
//
// O IFC do QiBuilder só informa o circuito nos pontos (tomadas, luminárias…) e o quadro pelo nome.
// Eletrodutos, eletrocalhas, perfilados e conexões não dizem quais circuitos passam por eles.
// Então: 1) descobrimos quais peças se encostam; 2) montamos uma rede; 3) o caminho do circuito é o
// trajeto mais curto do quadro até cada ponto (é como a fiação é lançada no projeto).
// Sem dependência do xeokit: recebe arrays e devolve ids.

const DEFAULT_TOLERANCE = 0.03;   // 3 cm: peças "encostadas" (ligação real)
const DEFAULT_GAP_TOLERANCE = 0.15; // até 15 cm: folga de modelagem (eletroduto que para antes da caixa)
const GAP_PENALTY = 10;           // custo extra (m) de usar uma ligação por folga: só se não houver caminho real
const POINT_COST_FACTOR = 4;      // atravessar a caixa de outro ponto é permitido, mas desestimulado

/** AABB [minX,minY,minZ,maxX,maxY,maxZ] dos vértices. */
export function positionsAABB(positions) {
    const aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) {
        for (let k = 0; k < 3; k++) {
            const v = positions[i + k];
            if (v < aabb[k]) aabb[k] = v;
            if (v > aabb[k + 3]) aabb[k + 3] = v;
        }
    }
    return aabb;
}

function aabbsOverlap(a, b, tolerance) {
    return a[0] - tolerance <= b[3] && b[0] - tolerance <= a[3] &&
        a[1] - tolerance <= b[4] && b[1] - tolerance <= a[4] &&
        a[2] - tolerance <= b[5] && b[2] - tolerance <= a[5];
}

function insideAABB(x, y, z, b, tolerance) {
    return x >= b[0] - tolerance && x <= b[3] + tolerance &&
        y >= b[1] - tolerance && y <= b[4] + tolerance &&
        z >= b[2] - tolerance && z <= b[5] + tolerance;
}

/** Distância² do ponto P ao triângulo ABC (Ericson, Real-Time Collision Detection). */
function pointTriangleDistanceSq(px, py, pz, p, a, b, c) {
    const ax = p[a], ay = p[a + 1], az = p[a + 2];
    const abx = p[b] - ax, aby = p[b + 1] - ay, abz = p[b + 2] - az;
    const acx = p[c] - ax, acy = p[c + 1] - ay, acz = p[c + 2] - az;
    const apx = px - ax, apy = py - ay, apz = pz - az;
    const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
    let qx, qy, qz;
    if (d1 <= 0 && d2 <= 0) { qx = ax; qy = ay; qz = az; }
    else {
        const bpx = px - p[b], bpy = py - p[b + 1], bpz = pz - p[b + 2];
        const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
        const cpx = px - p[c], cpy = py - p[c + 1], cpz = pz - p[c + 2];
        const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
        const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
        if (d3 >= 0 && d4 <= d3) { qx = p[b]; qy = p[b + 1]; qz = p[b + 2]; }
        else if (d6 >= 0 && d5 <= d6) { qx = p[c]; qy = p[c + 1]; qz = p[c + 2]; }
        else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = ax + abx * v; qy = ay + aby * v; qz = az + abz * v; }
        else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = ax + acx * w; qy = ay + acy * w; qz = az + acz * w; }
        else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
            const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            qx = p[b] + (p[c] - p[b]) * w; qy = p[b + 1] + (p[c + 1] - p[b + 1]) * w; qz = p[b + 2] + (p[c + 2] - p[b + 2]) * w;
        } else {
            const denom = 1 / (va + vb + vc), v = vb * denom, w = vc * denom;
            qx = ax + abx * v + acx * w; qy = ay + aby * v + acy * w; qz = az + abz * v + acz * w;
        }
    }
    return (px - qx) ** 2 + (py - qy) ** 2 + (pz - qz) ** 2;
}

/**
 * Menor distância² de um vértice de A até a superfície de B (só vértices dentro da AABB de B + limit).
 * Para assim que achar algo ≤ stopSq (ligação real confirmada).
 */
function triangleBounds(element) {
    if (element.triBounds) return element.triBounds;
    const p = element.positions, ib = element.indices;
    const bounds = new Float32Array((ib.length / 3) * 6);
    for (let t = 0, o = 0; t + 2 < ib.length; t += 3, o += 6) {
        const a = ib[t] * 3, b = ib[t + 1] * 3, c = ib[t + 2] * 3;
        for (let k = 0; k < 3; k++) {
            bounds[o + k] = Math.min(p[a + k], p[b + k], p[c + k]);
            bounds[o + 3 + k] = Math.max(p[a + k], p[b + k], p[c + k]);
        }
    }
    element.triBounds = bounds;
    return bounds;
}

function minVertexDistanceSq(A, B, limit, stopSq) {
    const pa = A.positions, pb = B.positions, ib = B.indices;
    const tb = triangleBounds(B);
    let best = Infinity;
    for (let i = 0; i < pa.length; i += 3) {
        const x = pa[i], y = pa[i + 1], z = pa[i + 2];
        if (!insideAABB(x, y, z, B.aabb, limit)) continue;
        // ponta de eletroduto DENTRO da caixa de um ponto/quadro = encostado
        if (B.isBox && insideAABB(x, y, z, B.aabb, 0)) return 0;
        for (let t = 0, o = 0; t + 2 < ib.length; t += 3, o += 6) {
            if (x < tb[o] - limit || x > tb[o + 3] + limit || y < tb[o + 1] - limit || y > tb[o + 4] + limit ||
                z < tb[o + 2] - limit || z > tb[o + 5] + limit) continue;
            const d = pointTriangleDistanceSq(x, y, z, pb, ib[t] * 3, ib[t + 1] * 3, ib[t + 2] * 3);
            if (d < best) {
                best = d;
                if (best <= stopSq) return best;
            }
        }
    }
    return best;
}

/** O segmento P0–P1 cruza a caixa (expandida por pad)? Teste de "slabs". */
function segmentHitsAABB(x0, y0, z0, x1, y1, z1, b, pad) {
    let t0 = 0, t1 = 1;
    const o = [x0, y0, z0], d = [x1 - x0, y1 - y0, z1 - z0];
    for (let k = 0; k < 3; k++) {
        const min = b[k] - pad, max = b[k + 3] + pad;
        if (Math.abs(d[k]) < 1e-12) {
            if (o[k] < min || o[k] > max) return false;
        } else {
            let ta = (min - o[k]) / d[k], tb = (max - o[k]) / d[k];
            if (ta > tb) [ta, tb] = [tb, ta];
            t0 = Math.max(t0, ta);
            t1 = Math.min(t1, tb);
            if (t0 > t1) return false;
        }
    }
    return true;
}

/**
 * Ligação entre uma peça de infraestrutura e a caixa de um ponto/quadro: alguma aresta da peça
 * entra na caixa (ponta dentro ou tubo atravessando). Devolve "contact", "gap" ou null.
 */
function boxLink(route, box, tolerance, gapTolerance) {
    const p = route.positions, ib = route.indices, tb = triangleBounds(route), b = box.aabb;
    let found = null;
    for (let t = 0, o = 0; t + 2 < ib.length; t += 3, o += 6) {
        if (tb[o] > b[3] + gapTolerance || tb[o + 3] < b[0] - gapTolerance ||
            tb[o + 1] > b[4] + gapTolerance || tb[o + 4] < b[1] - gapTolerance ||
            tb[o + 2] > b[5] + gapTolerance || tb[o + 5] < b[2] - gapTolerance) continue;
        const v = [ib[t] * 3, ib[t + 1] * 3, ib[t + 2] * 3];
        for (let e = 0; e < 3; e++) {
            const a = v[e], c = v[(e + 1) % 3];
            if (segmentHitsAABB(p[a], p[a + 1], p[a + 2], p[c], p[c + 1], p[c + 2], b, tolerance)) return "contact";
            if (!found && segmentHitsAABB(p[a], p[a + 1], p[a + 2], p[c], p[c + 1], p[c + 2], b, gapTolerance)) found = "gap";
        }
    }
    return found;
}

/** Caixa (12 triângulos) a partir da AABB: pontos e quadros só precisam do volume envolvente. */
export function boxGeometry(aabb) {
    const [x0, y0, z0, x1, y1, z1] = aabb;
    return {
        positions: Float32Array.from([x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]),
        indices: Uint32Array.from([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 2, 6, 1, 6, 5])
    };
}

/**
 * Monta a rede: lista de vizinhos de cada elemento.
 * elements: [{ id, kind: "route" | "point" | "panel", positions, indices, aabb? }]
 */
export function buildRouteGraph(elements, { tolerance = DEFAULT_TOLERANCE, gapTolerance = DEFAULT_GAP_TOLERANCE, cellSize = 2 } = {}) {
    const reach = Math.max(tolerance, gapTolerance);
    elements.forEach((element) => {
        element.aabb ||= positionsAABB(element.positions);
        // pontos e quadros: o volume envolvente basta (luminárias/quadros têm milhares de triângulos)
        if (element.kind !== "route") Object.assign(element, boxGeometry(element.aabb), { isBox: true });
    });
    const tightSq = tolerance * tolerance, gapSq = gapTolerance * gapTolerance;
    const grid = new Map();
    const key = (x, y, z) => `${x},${y},${z}`;
    elements.forEach((element, index) => {
        const a = element.aabb;
        for (let x = Math.floor((a[0] - reach) / cellSize); x <= Math.floor((a[3] + reach) / cellSize); x++)
            for (let y = Math.floor((a[1] - reach) / cellSize); y <= Math.floor((a[4] + reach) / cellSize); y++)
                for (let z = Math.floor((a[2] - reach) / cellSize); z <= Math.floor((a[5] + reach) / cellSize); z++) {
                    const k = key(x, y, z);
                    (grid.get(k) || grid.set(k, []).get(k)).push(index);
                }
    });

    const neighbors = elements.map(() => new Map());   // vizinho -> "contact" | "gap"
    const tested = new Set();
    for (const cell of grid.values()) {
        for (let i = 0; i < cell.length; i++) {
            for (let j = i + 1; j < cell.length; j++) {
                const a = cell[i], b = cell[j];
                const pairKey = a < b ? a * 1e6 + b : b * 1e6 + a;
                if (tested.has(pairKey)) continue;
                tested.add(pairKey);
                const A = elements[a], B = elements[b];
                // pontos e quadros não se ligam entre si diretamente (só pela infraestrutura)
                if (A.kind !== "route" && B.kind !== "route") continue;
                if (!aabbsOverlap(A.aabb, B.aabb, reach)) continue;
                let link;
                if (A.isBox || B.isBox) {
                    link = A.isBox ? boxLink(B, A, tolerance, gapTolerance) : boxLink(A, B, tolerance, gapTolerance);
                } else {
                    let d = minVertexDistanceSq(A, B, reach, tightSq);
                    if (d > tightSq) d = Math.min(d, minVertexDistanceSq(B, A, reach, tightSq));
                    link = d <= tightSq ? "contact" : (d <= gapSq ? "gap" : null);
                }
                if (link) {
                    neighbors[a].set(b, link);
                    neighbors[b].set(a, link);
                }
            }
        }
    }
    return {
        elements,
        neighbors: neighbors.map((map) => [...map.keys()]),
        links: neighbors.map((map) => map)
    };
}

function elementLength(element) {
    const a = element.aabb;
    return Math.max(0.05, Math.hypot(a[3] - a[0], a[4] - a[1], a[5] - a[2]));
}

/** Dijkstra a partir de um conjunto de nós, pelo comprimento das peças. */
function shortestPaths(graph, sources) {
    const { elements, neighbors } = graph;
    const dist = new Float64Array(elements.length).fill(Infinity);
    const prev = new Int32Array(elements.length).fill(-1);
    const heap = [];
    const push = (node, d) => {
        heap.push([d, node]);
        let i = heap.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
    };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === i) break;
                [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
            }
        }
        return top;
    };
    const sourceSet = new Set(sources);
    for (const s of sources) { dist[s] = 0; push(s, 0); }
    while (heap.length) {
        const [d, node] = pop();
        if (d > dist[node]) continue;
        // não atravessa outro quadro
        if (elements[node].kind === "panel" && !sourceSet.has(node)) continue;
        for (const next of neighbors[node]) {
            const element = elements[next];
            const gap = graph.links?.[node]?.get(next) === "gap";
            const cost = elementLength(element) * (element.kind === "point" ? POINT_COST_FACTOR : 1) + (gap ? GAP_PENALTY : 0);
            const nd = d + cost;
            if (nd < dist[next]) { dist[next] = nd; prev[next] = node; push(next, nd); }
        }
    }
    return { dist, prev };
}

function collectRoute(graph, prev, pointIndices, dist) {
    const route = new Set();
    const reached = [], unreached = [];
    const gapLinks = new Set();
    for (const point of pointIndices) {
        if (!Number.isFinite(dist[point])) { unreached.push(point); continue; }
        reached.push(point);
        for (let node = point; node !== -1; node = prev[node]) {
            route.add(node);
            const from = prev[node];
            if (from !== -1 && graph.links?.[from]?.get(node) === "gap") gapLinks.add(from < node ? `${from}-${node}` : `${node}-${from}`);
        }
    }
    let length = 0;
    for (const node of route) if (graph.elements[node].kind === "route") length += elementLength(graph.elements[node]);
    // gaps: quantas folgas de modelagem (3–15 cm) o caminho precisou "pular"
    return { route, reached, unreached, length, gaps: gapLinks.size };
}

const asArray = (value) => (Array.isArray(value) ? value : [value]);

/**
 * Caminho do circuito: união dos trajetos mais curtos do quadro até cada ponto.
 * panels: índice do quadro, ou lista de índices (vários quadros/racks com o mesmo nome:
 * cada ponto liga-se ao mais próximo pela infraestrutura).
 * Retorna { route: Set(índices), reached, unreached, length, gaps }.
 */
export function traceCircuit(graph, panels, pointIndices) {
    const sources = asArray(panels);
    const { dist, prev } = shortestPaths(graph, sources);
    const result = collectRoute(graph, prev, pointIndices, dist);
    if (!result.route.size && sources.length) result.route.add(sources[0]);
    return result;
}

/**
 * Vários circuitos do mesmo quadro de uma vez (um só cálculo de caminhos).
 * circuits: Map/objeto chave -> [índices dos pontos]. Retorna objeto chave -> { length, reached, unreached, gaps }.
 */
export function traceCircuits(graph, panels, circuits) {
    const sources = asArray(panels);
    const { dist, prev } = shortestPaths(graph, sources);
    const result = {};
    for (const [key, pointIndices] of (circuits instanceof Map ? circuits : Object.entries(circuits))) {
        const { reached, unreached, length, gaps } = collectRoute(graph, prev, pointIndices, dist);
        result[key] = { length, reached: reached.length, unreached: unreached.length, gaps };
    }
    return result;
}

/** Grupos de peças ligadas entre si (para diagnóstico). */
export function connectedComponents(graph) {
    const component = new Int32Array(graph.elements.length).fill(-1);
    let count = 0;
    for (let start = 0; start < graph.elements.length; start++) {
        if (component[start] !== -1) continue;
        const stack = [start];
        component[start] = count;
        while (stack.length) {
            const node = stack.pop();
            for (const next of graph.neighbors[node]) if (component[next] === -1) { component[next] = count; stack.push(next); }
        }
        count++;
    }
    return { component, count };
}
