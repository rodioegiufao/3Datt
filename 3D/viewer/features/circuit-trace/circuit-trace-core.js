// Dedução do caminho de um circuito (quadro → pontos) pela geometria da infraestrutura.
//
// O IFC do QiBuilder só informa o circuito nos pontos (tomadas, luminárias…) e o quadro pelo nome.
// Eletrodutos, eletrocalhas, perfilados e conexões não dizem quais circuitos passam por eles.
// Então: 1) descobrimos onde as peças se ligam de fato; 2) montamos uma rede cujos nós são esses
// pontos de ligação; 3) o circuito segue o trajeto de menor custo do quadro até cada ponto.
//
// Regras de projeto embutidas no custo e nas ligações:
// - a fiação é lançada preferencialmente pela eletrocalha, depois pelos perfilados e só então por
//   eletrodutos (custo por metro: eletrocalha 1, perfilado 1,5, eletroduto 3);
// - um eletroduto só se liga a outra peça pelas suas PONTAS: dois eletrodutos que se cruzam, ou um
//   eletroduto que passa encostado numa eletrocalha, não formam caminho;
// - percorrer um trecho de eletrocalha custa só a distância entre a entrada e a saída da fiação,
//   e não o comprimento da peça inteira.
// Sem dependência do xeokit: recebe arrays e devolve ids.

const DEFAULT_TOLERANCE = 0.03;   // 3 cm: peças "encostadas" (ligação real)
const DEFAULT_GAP_TOLERANCE = 0.15; // até 15 cm: folga de modelagem (eletroduto que para antes da caixa)
const GAP_PENALTY = 10;           // custo extra (m) de usar uma ligação por folga: só se não houver caminho real
const CHANNEL_GAP_PENALTY = 0.5;  // folga entre trechos de eletrocalha/perfilado (emendas): comum na modelagem
const CHANNEL_TYPES = new Set(["tray", "tray-fitting", "perfilado"]);
const POINT_COST_FACTOR = 4;      // atravessar a caixa de outro ponto é permitido, mas desestimulado
const END_ZONE = 0.12;            // região da ponta de um eletroduto (m, medida ao longo da superfície)

// custo por metro de cada tipo de infraestrutura (prioridade: eletrocalha → perfilado → eletroduto)
export const ROUTE_WEIGHTS = Object.freeze({ tray: 1, "tray-fitting": 1, perfilado: 1.5, conduit: 3, box: 1 });

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

// ---------------------------------------------------------------------------------------------
// Pontas dos eletrodutos
// ---------------------------------------------------------------------------------------------

/** Junta vértices repetidos (malhas com faces separadas) e devolve o vértice canônico de cada um. */
function weldVertices(positions, eps = 1e-4) {
    const map = new Map();
    const canon = new Int32Array(positions.length / 3);
    for (let v = 0; v < canon.length; v++) {
        const k = `${Math.round(positions[v * 3] / eps)},${Math.round(positions[v * 3 + 1] / eps)},${Math.round(positions[v * 3 + 2] / eps)}`;
        if (!map.has(k)) map.set(k, v);
        canon[v] = map.get(k);
    }
    return canon;
}

/** Distâncias geodésicas (pelas arestas da malha) a partir de um vértice. */
function geodesicFrom(start, adjacency, count) {
    const dist = new Float64Array(count).fill(Infinity);
    const heap = new MinHeap();
    dist[start] = 0;
    heap.push(0, start);
    while (heap.size) {
        const [d, v] = heap.pop();
        if (d > dist[v]) continue;
        for (const [w, len] of adjacency[v]) {
            const nd = d + len;
            if (nd < dist[w]) { dist[w] = nd; heap.push(nd, w); }
        }
    }
    return dist;
}

/**
 * Descobre as pontas de uma peça tubular (eletroduto reto ou curvo).
 * A malha pode vir em vários "pedaços" (o exportador gera cada trecho reto e cada curva separados):
 * em cada pedaço, as extremidades são os vértices mais distantes entre si medindo AO LONGO da
 * superfície (funciona em curvas em "U"); extremidades que coincidem com a de outro pedaço são
 * emendas internas, e as que sobram são as pontas reais do eletroduto.
 * Marca os vértices e triângulos das pontas e calcula o comprimento da peça.
 */
function analyzeTube(element) {
    const p = element.positions, ib = element.indices;
    const count = p.length / 3;
    if (!count || ib.length < 3) return null;
    const canon = weldVertices(p);
    const adjacency = Array.from({ length: count }, () => []);
    const parent = Int32Array.from({ length: count }, (_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const addEdge = (a, b) => {
        if (a === b) return;
        const len = Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
        adjacency[a].push([b, len]);
        adjacency[b].push([a, len]);
        parent[find(a)] = find(b);
    };
    for (let t = 0; t + 2 < ib.length; t += 3) {
        const a = canon[ib[t]], b = canon[ib[t + 1]], c = canon[ib[t + 2]];
        addEdge(a, b); addEdge(b, c); addEdge(c, a);
    }
    // pedaços da malha
    const pieces = new Map();
    for (let v = 0; v < count; v++) if (canon[v] === v) {
        const root = find(v);
        (pieces.get(root) || pieces.set(root, []).get(root)).push(v);
    }
    const ends = [];          // { vertex, dist (geodésica a partir dele), piece }
    let length = 0;
    for (const vertices of pieces.values()) {
        if (vertices.length < 3) continue;
        const farthest = (dist) => vertices.reduce((best, v) => (Number.isFinite(dist[v]) && dist[v] > (best < 0 ? -1 : dist[best]) ? v : best), -1);
        const endA = farthest(geodesicFrom(vertices[0], adjacency, count));
        const distA = geodesicFrom(endA, adjacency, count);
        const endB = farthest(distA);
        const distB = geodesicFrom(endB, adjacency, count);
        if (!(distA[endB] > 0)) continue;
        length += distA[endB];
        ends.push({ vertex: endA, dist: distA, size: distA[endB] }, { vertex: endB, dist: distB, size: distA[endB] });
    }
    if (!ends.length) return null;   // malha quebrada: trata como peça comum
    const pos = (v) => [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
    // extremidades de pedaços diferentes que se encontram = emenda interna (não é ponta)
    // (pedaços minúsculos, como anéis e tampas, não "apagam" a ponta de ninguém)
    const JOIN = 0.06;
    const real = ends.filter((e, i) => !ends.some((o, k) => k !== i && k !== (i ^ 1) && o.size > 2 * JOIN &&
        distance(pos(e.vertex), pos(o.vertex)) <= JOIN));
    let tips = real;
    if (tips.length < 2) {
        // não deu para separar emendas de pontas: usa as duas extremidades mais afastadas entre si
        let best = [0, 1], bestD = -1;
        for (let i = 0; i < ends.length; i++) for (let k = i + 1; k < ends.length; k++) {
            const d = distance(pos(ends[i].vertex), pos(ends[k].vertex));
            if (d > bestD) { bestD = d; best = [i, k]; }
        }
        tips = ends.length >= 2 ? best.map((i) => ends[i]) : ends;
    }
    // peças curtas (luvas, ajustes, descidas curtas) são inteiras "ponta"
    const endOf = new Int8Array(count).fill(-1);   // índice da ponta ou -1 (meio)
    for (let v = 0; v < count; v++) {
        const c = canon[v];
        let best = -1, bestD = Infinity;
        tips.forEach((tip, k) => { if (tip.dist[c] < bestD) { bestD = tip.dist[c]; best = k; } });
        if (best < 0) continue;
        const zone = tips[best].size < 0.5 ? Infinity : Math.min(END_ZONE, tips[best].size * 0.3);
        if (bestD <= zone) endOf[v] = best;
    }
    const centroid = (which) => {
        let x = 0, y = 0, z = 0, n = 0;
        for (let v = 0; v < count; v++) if (endOf[v] === which) { x += p[v * 3]; y += p[v * 3 + 1]; z += p[v * 3 + 2]; n++; }
        return n ? [x / n, y / n, z / n] : pos(tips[which].vertex);
    };
    const endTriangles = [];
    for (let t = 0; t + 2 < ib.length; t += 3) {
        if (endOf[ib[t]] >= 0 || endOf[ib[t + 1]] >= 0 || endOf[ib[t + 2]] >= 0) endTriangles.push(t);
    }
    return { endOf, ends: tips.map((_, k) => centroid(k)), endTriangles, length: Math.max(0.05, length) };
}

// ---------------------------------------------------------------------------------------------
// Ligações entre peças (com o ponto onde a ligação acontece)
// ---------------------------------------------------------------------------------------------

/**
 * Menor distância de um vértice de A (só das pontas, se A for eletroduto) até a superfície de B
 * (só triângulos das pontas, se B for eletroduto). Devolve { d2, x, y, z } ou null.
 */
function closestContact(A, B, limit, stopSq) {
    const pa = A.positions, pb = B.positions, ib = B.indices;
    const tb = triangleBounds(B);
    const triangles = B.tube ? B.tube.endTriangles : null;
    let best = null;
    for (let i = 0, v = 0; i < pa.length; i += 3, v++) {
        if (A.tube && A.tube.endOf[v] < 0) continue;
        const x = pa[i], y = pa[i + 1], z = pa[i + 2];
        if (!insideAABB(x, y, z, B.aabb, limit)) continue;
        const nTri = triangles ? triangles.length : ib.length / 3;
        for (let k = 0; k < nTri; k++) {
            const t = triangles ? triangles[k] : k * 3, o = (t / 3) * 6;
            if (x < tb[o] - limit || x > tb[o + 3] + limit || y < tb[o + 1] - limit || y > tb[o + 4] + limit ||
                z < tb[o + 2] - limit || z > tb[o + 5] + limit) continue;
            const d = pointTriangleDistanceSq(x, y, z, pb, ib[t] * 3, ib[t + 1] * 3, ib[t + 2] * 3);
            if (!best || d < best.d2) {
                best = { d2: d, x, y, z };
                if (d <= stopSq) return best;
            }
        }
    }
    return best;
}

/**
 * Ligação entre uma peça de infraestrutura e a caixa de um ponto/quadro: alguma aresta da peça
 * (das pontas, se for eletroduto) entra na caixa. Devolve { type: "contact"|"gap", x, y, z } ou null.
 */
function boxContact(route, box, tolerance, gapTolerance) {
    const p = route.positions, ib = route.indices, tb = triangleBounds(route), b = box.aabb;
    const cx = (b[0] + b[3]) / 2, cy = (b[1] + b[4]) / 2, cz = (b[2] + b[5]) / 2;
    const triangles = route.tube ? route.tube.endTriangles : null;
    const nTri = triangles ? triangles.length : ib.length / 3;
    let found = null;
    for (let k = 0; k < nTri; k++) {
        const t = triangles ? triangles[k] : k * 3, o = (t / 3) * 6;
        if (tb[o] > b[3] + gapTolerance || tb[o + 3] < b[0] - gapTolerance ||
            tb[o + 1] > b[4] + gapTolerance || tb[o + 4] < b[1] - gapTolerance ||
            tb[o + 2] > b[5] + gapTolerance || tb[o + 5] < b[2] - gapTolerance) continue;
        const v = [ib[t] * 3, ib[t + 1] * 3, ib[t + 2] * 3];
        for (let e = 0; e < 3; e++) {
            const a = v[e], c = v[(e + 1) % 3];
            const tight = segmentHitsAABB(p[a], p[a + 1], p[a + 2], p[c], p[c + 1], p[c + 2], b, tolerance);
            const loose = tight || segmentHitsAABB(p[a], p[a + 1], p[a + 2], p[c], p[c + 1], p[c + 2], b, gapTolerance);
            if (!loose) continue;
            // ponto da ligação: o vértice da aresta mais próximo do centro da caixa
            const da = (p[a] - cx) ** 2 + (p[a + 1] - cy) ** 2 + (p[a + 2] - cz) ** 2;
            const dc = (p[c] - cx) ** 2 + (p[c + 1] - cy) ** 2 + (p[c + 2] - cz) ** 2;
            const q = da <= dc ? a : c;
            const candidate = { type: tight ? "contact" : "gap", x: p[q], y: p[q + 1], z: p[q + 2] };
            if (tight) return candidate;
            found ||= candidate;
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

class MinHeap {
    constructor() { this.items = []; }
    get size() { return this.items.length; }
    push(priority, value) {
        const h = this.items;
        h.push([priority, value]);
        let i = h.length - 1;
        while (i > 0) { const p = (i - 1) >> 1; if (h[p][0] <= h[i][0]) break; [h[p], h[i]] = [h[i], h[p]]; i = p; }
    }
    pop() {
        const h = this.items, top = h[0], last = h.pop();
        if (h.length) {
            h[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = l + 1;
                let m = i;
                if (l < h.length && h[l][0] < h[m][0]) m = l;
                if (r < h.length && h[r][0] < h[m][0]) m = r;
                if (m === i) break;
                [h[m], h[i]] = [h[i], h[m]]; i = m;
            }
        }
        return top;
    }
}

function routeTypeOf(element) {
    if (element.kind !== "route") return "box";
    return ROUTE_WEIGHTS[element.routeType] !== undefined ? element.routeType : "tray";
}

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Monta a rede. elements: [{ id, kind: "route" | "point" | "panel", routeType?, positions, indices }]
 * routeType (só para "route"): "tray" (eletrocalha/leito), "tray-fitting" (conexões de eletrocalha),
 * "perfilado", "conduit" (eletroduto) ou "box" (caixa de passagem). Sem routeType = "tray".
 */
export function buildRouteGraph(elements, { tolerance = DEFAULT_TOLERANCE, gapTolerance = DEFAULT_GAP_TOLERANCE, cellSize = 2 } = {}) {
    const reach = Math.max(tolerance, gapTolerance);
    elements.forEach((element) => {
        element.aabb ||= positionsAABB(element.positions);
        // pontos e quadros: o volume envolvente basta (luminárias/quadros têm milhares de triângulos)
        if (element.kind !== "route") Object.assign(element, boxGeometry(element.aabb), { isBox: true });
        element.type = routeTypeOf(element);
        element.tube = element.type === "conduit" ? analyzeTube(element) : null;
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

    const links = elements.map(() => new Map());   // vizinho -> "contact" | "gap"
    const junctions = [];                           // { a, b, pos, gap }
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
                let link = null;
                if (A.isBox || B.isBox) {
                    const hit = A.isBox ? boxContact(B, A, tolerance, gapTolerance) : boxContact(A, B, tolerance, gapTolerance);
                    if (hit) link = { type: hit.type, pos: [hit.x, hit.y, hit.z] };
                } else {
                    let hit = closestContact(A, B, reach, tightSq);
                    if (!hit || hit.d2 > tightSq) {
                        const other = closestContact(B, A, reach, tightSq);
                        if (other && (!hit || other.d2 < hit.d2)) hit = other;
                    }
                    if (hit && hit.d2 <= gapSq) link = { type: hit.d2 <= tightSq ? "contact" : "gap", pos: [hit.x, hit.y, hit.z] };
                }
                if (link) {
                    links[a].set(b, link.type);
                    links[b].set(a, link.type);
                    const gap = link.type === "gap";
                    // folga entre dois trechos de eletrocalha/perfilado é emenda de modelagem (penalidade leve);
                    // folga envolvendo eletroduto ou caixa só é usada se não houver outro caminho
                    const channel = CHANNEL_TYPES.has(A.type) && CHANNEL_TYPES.has(B.type);
                    junctions.push({ a, b, pos: link.pos, gap, penalty: gap ? (channel ? CHANNEL_GAP_PENALTY : GAP_PENALTY) : 0, weakGap: gap && channel });
                }
            }
        }
    }

    // nós da rede = pontos de ligação; arestas = trechos percorridos DENTRO de cada peça
    const junctionsOf = elements.map(() => []);
    junctions.forEach((junction, index) => {
        junctionsOf[junction.a].push(index);
        junctionsOf[junction.b].push(index);
    });
    const edges = junctions.map(() => []);   // [vizinho, custo, comprimento, elemento]
    const addEdge = (j1, j2, length, element) => {
        const cost = length * (element.kind === "point" ? POINT_COST_FACTOR : ROUTE_WEIGHTS[element.type] ?? 1);
        edges[j1].push([j2, cost, length, element.index]);
        edges[j2].push([j1, cost, length, element.index]);
    };
    elements.forEach((element, index) => {
        element.index = index;
        const list = junctionsOf[index];
        if (list.length < 2) return;
        if (element.tube) {
            // eletroduto: de uma ponta à outra custa o comprimento da peça
            const ends = element.tube.ends;
            const sideOf = (j) => ends.reduce((best, end, k) => (distance(junctions[j].pos, end) < distance(junctions[j].pos, ends[best]) ? k : best), 0);
            // só se atravessa um eletroduto de uma ponta à outra: entrar e sair pela mesma ponta
            // usaria o eletroduto como "ponte" entre duas peças que apenas encostam nele
            for (let x = 0; x < list.length; x++)
                for (let y = x + 1; y < list.length; y++) {
                    const j1 = list[x], j2 = list[y];
                    if (sideOf(j1) !== sideOf(j2)) addEdge(j1, j2, element.tube.length, element);
                }
            return;
        }
        if (element.kind === "point") {
            // atravessar a caixa de outro ponto (luminária → luminária) é possível, mas tem custo
            for (let x = 0; x < list.length; x++)
                for (let y = x + 1; y < list.length; y++)
                    addEdge(list[x], list[y], Math.max(0.3, distance(junctions[list[x]].pos, junctions[list[y]].pos)), element);
            return;
        }
        if (element.kind === "panel") return;   // quadros: tratados como origem, nunca atravessados
        if (list.length <= 6) {
            for (let x = 0; x < list.length; x++)
                for (let y = x + 1; y < list.length; y++)
                    addEdge(list[x], list[y], Math.max(0.02, distance(junctions[list[x]].pos, junctions[list[y]].pos)), element);
            return;
        }
        // eletrocalha/perfilado longo com muitas derivações: liga as derivações em sequência ao longo da peça
        const a = element.aabb;
        const axis = [a[3] - a[0], a[4] - a[1], a[5] - a[2]].reduce((best, value, k, arr) => (value > arr[best] ? k : best), 0);
        const sorted = [...list].sort((j1, j2) => junctions[j1].pos[axis] - junctions[j2].pos[axis]);
        for (let k = 0; k + 1 < sorted.length; k++) {
            addEdge(sorted[k], sorted[k + 1], Math.max(0.02, distance(junctions[sorted[k]].pos, junctions[sorted[k + 1]].pos)), element);
        }
    });

    return {
        elements,
        neighbors: links.map((map) => [...map.keys()]),
        links,
        junctions,
        junctionsOf,
        edges
    };
}

/** Dijkstra pelos pontos de ligação, a partir de todos os pontos de ligação dos quadros de origem. */
function shortestPaths(graph, sources) {
    const { junctions, junctionsOf, edges } = graph;
    const dist = new Float64Array(junctions.length).fill(Infinity);
    const prev = new Int32Array(junctions.length).fill(-1);
    const via = new Int32Array(junctions.length).fill(-1);        // peça percorrida para chegar
    const viaLength = new Float64Array(junctions.length);
    const origin = new Int32Array(junctions.length).fill(-1);     // quadro de onde saiu
    const heap = new MinHeap();
    for (const s of sources) {
        for (const j of junctionsOf[s] || []) {
            const start = junctions[j].penalty;
            if (start < dist[j]) { dist[j] = start; origin[j] = s; heap.push(start, j); }
        }
    }
    while (heap.size) {
        const [d, j] = heap.pop();
        if (d > dist[j]) continue;
        for (const [next, cost, length, element] of edges[j]) {
            const nd = d + cost + junctions[next].penalty;
            if (nd < dist[next]) {
                dist[next] = nd; prev[next] = j; via[next] = element; viaLength[next] = length; origin[next] = origin[j];
                heap.push(nd, next);
            }
        }
    }
    return { dist, prev, via, viaLength, origin };
}

function collectRoute(graph, paths, pointIndices) {
    const { junctions, junctionsOf, elements } = graph;
    const { dist, prev, via, viaLength, origin } = paths;
    const route = new Set();
    const reached = [], unreached = [];
    const usedEdges = new Set(), usedGaps = new Set();
    let length = 0;
    for (const point of pointIndices) {
        // o ponto é alcançado no seu ponto de ligação mais barato
        let best = -1;
        for (const j of junctionsOf[point] || []) if (Number.isFinite(dist[j]) && (best < 0 || dist[j] < dist[best])) best = j;
        if (best < 0) { unreached.push(point); continue; }
        reached.push(point);
        route.add(point);
        for (let j = best; j !== -1; j = prev[j]) {
            if (junctions[j].gap && !junctions[j].weakGap) usedGaps.add(j);
            if (prev[j] === -1) { route.add(origin[j]); break; }
            route.add(via[j]);
            const edgeKey = `${prev[j]}>${j}`;
            if (!usedEdges.has(edgeKey) && elements[via[j]].kind === "route") { usedEdges.add(edgeKey); length += viaLength[j]; }
        }
    }
    return { route, reached, unreached, length, gaps: usedGaps.size };
}

const asArray = (value) => (Array.isArray(value) ? value : [value]);

/**
 * Caminho do circuito: união dos trajetos de menor custo do quadro até cada ponto.
 * panels: índice do quadro, ou lista de índices (vários quadros/racks com o mesmo nome:
 * cada ponto liga-se ao mais próximo pela infraestrutura).
 * Retorna { route: Set(índices), reached, unreached, length, gaps }.
 */
export function traceCircuit(graph, panels, pointIndices) {
    const sources = asArray(panels);
    const result = collectRoute(graph, shortestPaths(graph, sources), pointIndices);
    if (!result.route.size && sources.length) result.route.add(sources[0]);
    return result;
}

/**
 * Vários circuitos do mesmo quadro de uma vez (um só cálculo de caminhos).
 * circuits: Map/objeto chave -> [índices dos pontos]. Retorna objeto chave -> { length, reached, unreached, gaps }.
 */
export function traceCircuits(graph, panels, circuits) {
    const paths = shortestPaths(graph, asArray(panels));
    const result = {};
    for (const [key, pointIndices] of (circuits instanceof Map ? circuits : Object.entries(circuits))) {
        const { reached, unreached, length, gaps } = collectRoute(graph, paths, pointIndices);
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
