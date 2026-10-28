// Núcleo de cálculo da cobertura Wi-Fi.
// Não depende do xeokit: recebe números e devolve números, para poder ser testado isoladamente.

// ---------------------------------------------------------------------------
// Catálogo de access points (dados do datasheet do fabricante)
// ---------------------------------------------------------------------------
export const AP_MODELS = Object.freeze({
    "U6-LR": Object.freeze({
        id: "U6-LR",
        label: "UniFi U6 Long-Range (U6-LR)",
        mounting: "Parede/teto",
        mimo: "4x4 (2,4 GHz) • 4x4 (5 GHz)",
        maxClients: "300+",
        standards: "Wi-Fi 4/5/6",
        bands: Object.freeze({
            "2.4": Object.freeze({ label: "2,4 GHz", freqMHz: 2437, txPowerDbm: 26, antennaGainDbi: 4, throughput: "600 Mbps" }),
            "5": Object.freeze({ label: "5 GHz", freqMHz: 5500, txPowerDbm: 26, antennaGainDbi: 5.5, throughput: "2400 Mbps" })
        })
    })
});

// Potência configurada no controlador (o datasheet informa a máxima).
export const TX_POWER_PRESETS = Object.freeze({
    high: Object.freeze({ label: "Alta (máxima)", offsetDb: 0 }),
    medium: Object.freeze({ label: "Média (−6 dB)", offsetDb: -6 }),
    low: Object.freeze({ label: "Baixa (−12 dB)", offsetDb: -12 })
});

// Itens do projeto que são classificados como access point.
export const ACCESS_POINT_RULES = Object.freeze([
    Object.freeze({ match: "Dispositivo de Cabeamento - embutir - S/ placa - 1 módulo -Repetidor", modelId: "U6-LR" }),
    Object.freeze({ match: "S.O.S EQUIPAMENTOS DE TELECOMUNICAÇÕES - CABEAMENTO WIFI - Repetidor", modelId: "U6-LR" })
]);

// Regra principal: "Nome" do conjunto "Identificação_Elemento" contendo "wifi"/"wi-fi".
export const ACCESS_POINT_NAME_RULE = Object.freeze({
    psetName: "Identificação_Elemento",
    propertyName: "Nome",
    keywords: Object.freeze(["wifi", "wi-fi", "access point"]),
    modelId: "U6-LR"
});

// ---------------------------------------------------------------------------
// Parâmetros de propagação (estimativas; ajuste aqui para calibrar com medições reais)
// ---------------------------------------------------------------------------
export const PROPAGATION = Object.freeze({
    receiverHeight: 1.2,      // altura do celular/notebook acima do piso (m)
    pathLossExponent: 2.3,    // ambiente interno com as paredes contadas à parte
    clientAntennaGainDbi: 0
});

// Tipos IFC que bloqueiam sinal e o tipo de obstáculo padrão de cada um.
export const OBSTACLE_IFC_TYPES = Object.freeze({
    IfcWall: "masonry",
    IfcWallStandardCase: "masonry",
    IfcWallElementedCase: "masonry",
    IfcCurtainWall: "glass",
    IfcWindow: "glass",
    IfcDoor: "door",
    IfcColumn: "concrete"
});

// Lajes usadas para recortar o mapa no piso (não atenuam dentro do mesmo pavimento).
export const FLOOR_IFC_TYPES = Object.freeze(["IfcSlab"]);

// Perda por obstáculo atravessado (dB). Valores típicos de literatura, aproximados.
export const OBSTACLE_LOSS_DB = Object.freeze({
    drywall: Object.freeze({ label: "Drywall/gesso", "2.4": 4, "5": 6 }),
    glass: Object.freeze({ label: "Vidro", "2.4": 3, "5": 5 }),
    door: Object.freeze({ label: "Porta", "2.4": 3, "5": 4 }),
    fence: Object.freeze({ label: "Gradil/grade", "2.4": 2, "5": 3 }),
    lining: Object.freeze({ label: "Revestimento", "2.4": 0, "5": 0 }),  // já contado na parede que reveste
    masonry: Object.freeze({ label: "Alvenaria", "2.4": 8, "5": 12 }),
    concrete: Object.freeze({ label: "Concreto", "2.4": 12, "5": 20 })
});

// Faixas de cor do mapa de calor (dBm).
export const SIGNAL_LEVELS = Object.freeze([
    Object.freeze({ min: -67, color: [34, 197, 94], label: "≥ −67 dBm • Ótimo (voz e vídeo)" }),
    Object.freeze({ min: -72, color: [250, 204, 21], label: "−67 a −72 dBm • Bom" }),
    Object.freeze({ min: -80, color: [245, 140, 30], label: "−72 a −80 dBm • Fraco" }),
    Object.freeze({ min: -85, color: [220, 38, 38], label: "−80 a −85 dBm • Muito fraco" })
]);
export const NO_SIGNAL_COLOR = Object.freeze([63, 63, 70]);
export const NO_SIGNAL_LABEL = "< −85 dBm • Sem cobertura";

// ---------------------------------------------------------------------------
// Identificação e classificação
// ---------------------------------------------------------------------------
export function normalizeItemLabel(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s*-\s*/g, "-")
        .replace(/\s+/g, " ")
        .trim();
}

/** Normalização tolerante: ignora pontuação no início (".S.O.S") e trata "º" como "°". */
export function normalizeLooseLabel(value) {
    return normalizeItemLabel(String(value ?? "").replace(/º/g, "°")).replace(/^[^a-z0-9]+/, "");
}

/** Verdadeiro se o conjunto/propriedade da regra contém alguma das palavras-chave. */
export function matchesNameRule(metaObject, rule) {
    const psetName = normalizeItemLabel(rule.psetName);
    const propertyName = normalizeItemLabel(rule.propertyName);
    for (const pset of metaObject?.propertySets || []) {
        if (normalizeItemLabel(pset?.name) !== psetName) continue;
        for (const prop of pset.properties || []) {
            if (normalizeItemLabel(prop?.name) !== propertyName) continue;
            const value = normalizeItemLabel(prop?.value);
            if (rule.keywords.some((keyword) => value.includes(keyword))) return true;
        }
    }
    return false;
}

const NORMALIZED_AP_RULES = ACCESS_POINT_RULES.map((rule) => ({ ...rule, normalized: normalizeLooseLabel(rule.match) }));

export function* iterateMetaObjectTexts(metaObject) {
    if (metaObject?.name) yield metaObject.name;
    for (const pset of metaObject?.propertySets || []) {
        for (const prop of pset?.properties || []) {
            if (prop?.name) yield prop.name;
            if (typeof prop?.value === "string") yield prop.value;
        }
    }
}

/** Retorna o id do modelo de AP quando o objeto é um access point, ou null. */
export function getAccessPointModelId(metaObject) {
    if (matchesNameRule(metaObject, ACCESS_POINT_NAME_RULE)) return ACCESS_POINT_NAME_RULE.modelId;
    for (const text of iterateMetaObjectTexts(metaObject)) {
        const normalized = normalizeLooseLabel(text);
        const rule = NORMALIZED_AP_RULES.find((candidate) => candidate.normalized === normalized);
        if (rule) return rule.modelId;
    }
    return null;
}

/** Define o tipo de obstáculo a partir do tipo IFC e, para paredes, do nome/propriedades. */
export function classifyObstacle(metaObject) {
    const base = OBSTACLE_IFC_TYPES[metaObject?.type];
    if (!base) return null;
    if (base !== "masonry" && base !== "door") return base;

    const text = normalizeItemLabel(Array.from(iterateMetaObjectTexts(metaObject)).join(" "));
    if (base === "door") {
        // porta de vidro (blindex/temperado) é transparente para câmera; portão costuma ser gradeado
        if (/vidro|glass|blindex|temperado/.test(text)) return "glass";
        if (/\bportao\b|\bgrade|gradil/.test(text)) return "fence";
        return "door";
    }
    // camada de revestimento sobre outra parede: não é uma parede a mais
    if (/revestimento|acabamento|reboco|ceramica|porcelanato|pastilha/.test(text)) return "lining";
    if (/\b(gradil|grade|gradeado|guarda-?corpo|alambrado|cerca)\b/.test(text)) return "fence";
    if (/drywall|dry wall|gesso acartonado|placa de gesso|placa cimenticia|cimenticia/.test(text)) return "drywall";
    if (/vidro|glass|cortina/.test(text)) return "glass";
    if (/concreto|concrete/.test(text)) return "concrete";
    return "masonry";
}

export function getEirpDbm(modelId, band, powerPreset = "high") {
    const bandData = AP_MODELS[modelId]?.bands?.[band];
    if (!bandData) return null;
    const offset = TX_POWER_PRESETS[powerPreset]?.offsetDb ?? 0;
    return bandData.txPowerDbm + offset + bandData.antennaGainDbi;
}

/** Perda em espaço livre a 1 m (dB) para a frequência em MHz. */
export function freeSpaceLossAt1m(freqMHz) {
    return 20 * Math.log10(freqMHz) - 27.55;
}

// ---------------------------------------------------------------------------
// Geometria: corte horizontal das paredes
// ---------------------------------------------------------------------------
/**
 * Corta os triângulos de cada obstáculo no plano horizontal Y = sliceY.
 * Retorna segmentos 2D no plano XZ: Float64Array [x1, z1, x2, z2, ...] e o índice do obstáculo de cada segmento.
 */
export function sliceObstacles(obstacles, sliceY) {
    const coords = [];
    const owners = [];

    obstacles.forEach((obstacle, obstacleIndex) => {
        const aabb = obstacle.aabb;
        if (aabb && (aabb[1] > sliceY || aabb[4] < sliceY)) return;

        const p = obstacle.positions;
        const idx = obstacle.indices;
        for (let t = 0; t + 2 < idx.length; t += 3) {
            const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
            const hits = [];
            for (const [i, j] of [[a, b], [b, c], [c, a]]) {
                const yi = p[i + 1] - sliceY;
                const yj = p[j + 1] - sliceY;
                if ((yi < 0) !== (yj < 0)) {
                    const k = yi / (yi - yj);
                    hits.push(p[i] + (p[j] - p[i]) * k, p[i + 2] + (p[j + 2] - p[i + 2]) * k);
                }
            }
            if (hits.length >= 4) {
                coords.push(hits[0], hits[1], hits[2], hits[3]);
                owners.push(obstacleIndex);
            }
        }
    });

    return { coords: Float64Array.from(coords), owners: Uint32Array.from(owners) };
}

export function segmentsBounds(coords) {
    const bounds = [Infinity, Infinity, -Infinity, -Infinity];
    for (let i = 0; i < coords.length; i += 2) {
        bounds[0] = Math.min(bounds[0], coords[i]);
        bounds[1] = Math.min(bounds[1], coords[i + 1]);
        bounds[2] = Math.max(bounds[2], coords[i]);
        bounds[3] = Math.max(bounds[3], coords[i + 1]);
    }
    return bounds;
}

/** Parâmetro t (0–1) do ponto de cruzamento ao longo de AB, ou −1 se não cruzam. */
function segmentIntersectionT(ax, az, bx, bz, cx, cz, dx, dz) {
    const rX = bx - ax, rZ = bz - az, sX = dx - cx, sZ = dz - cz;
    const den = rX * sZ - rZ * sX;
    if (Math.abs(den) < 1e-12) return -1;
    const qX = cx - ax, qZ = cz - az;
    const t = (qX * sZ - qZ * sX) / den;
    const u = (qX * rZ - qZ * rX) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** Grade espacial 2D para testar só os segmentos próximos de cada raio. */
export class SegmentGrid {
    constructor({ coords, owners }, bounds, cellSize = 1) {
        this.coords = coords;
        this.owners = owners;
        this.minX = bounds[0];
        this.minZ = bounds[1];
        this.cellSize = cellSize;
        this.cols = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / cellSize));
        this.rows = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / cellSize));
        this.cells = new Array(this.cols * this.rows);
        this.segmentStamp = new Uint32Array(owners.length);
        let maxOwner = -1;
        for (let i = 0; i < owners.length; i++) if (owners[i] > maxOwner) maxOwner = owners[i];
        this.ownerStamp = new Uint32Array(maxOwner + 1);
        this.stamp = 0;

        for (let s = 0; s < owners.length; s++) {
            const o = s * 4;
            const c0 = this.#col(Math.min(coords[o], coords[o + 2]));
            const c1 = this.#col(Math.max(coords[o], coords[o + 2]));
            const r0 = this.#row(Math.min(coords[o + 1], coords[o + 3]));
            const r1 = this.#row(Math.max(coords[o + 1], coords[o + 3]));
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    const key = r * this.cols + c;
                    (this.cells[key] ||= []).push(s);
                }
            }
        }
    }

    #col(x) { return Math.min(this.cols - 1, Math.max(0, Math.floor((x - this.minX) / this.cellSize))); }
    #row(z) { return Math.min(this.rows - 1, Math.max(0, Math.floor((z - this.minZ) / this.cellSize))); }

    /**
     * Lista os obstáculos cruzados entre A e B (cada um uma vez), ordenados pela distância a A.
     * Retorna [{ owner, distance }]. Usado no diagnóstico.
     */
    obstaclesAlong(ax, az, bx, bz, ignoreNear = 0) {
        const length = Math.hypot(bx - ax, bz - az);
        const found = new Map();
        for (let s = 0; s < this.owners.length; s++) {
            const o = s * 4;
            const t = segmentIntersectionT(ax, az, bx, bz, this.coords[o], this.coords[o + 1], this.coords[o + 2], this.coords[o + 3]);
            if (t < 0 || t * length < ignoreNear) continue;
            const owner = this.owners[s];
            const distance = t * length;
            if (!found.has(owner) || found.get(owner) > distance) found.set(owner, distance);
        }
        return Array.from(found, ([owner, distance]) => ({ owner, distance })).sort((a, b) => a.distance - b.distance);
    }

    /**
     * Soma a perda dos obstáculos atravessados entre A e B (cada obstáculo conta uma vez).
     * ignoreNear: cruzamentos a menos dessa distância de A são ignorados
     * (dispositivo encostado ou embutido na própria parede/laje).
     */
    lossAlong(ax, az, bx, bz, ownerLoss, ignoreNear = 0) {
        this.stamp = (this.stamp + 1) >>> 0 || 1;
        const stamp = this.stamp;
        let loss = 0;

        let col = this.#col(ax), row = this.#row(az);
        const endCol = this.#col(bx), endRow = this.#row(bz);
        const dX = bx - ax, dZ = bz - az;
        const length = Math.hypot(dX, dZ);
        const minT = length > 0 ? ignoreNear / length : 0;
        const stepX = dX > 0 ? 1 : -1, stepZ = dZ > 0 ? 1 : -1;
        const tDeltaX = dX !== 0 ? this.cellSize / Math.abs(dX) : Infinity;
        const tDeltaZ = dZ !== 0 ? this.cellSize / Math.abs(dZ) : Infinity;
        let tMaxX = dX !== 0 ? ((this.minX + (col + (stepX > 0 ? 1 : 0)) * this.cellSize) - ax) / dX : Infinity;
        let tMaxZ = dZ !== 0 ? ((this.minZ + (row + (stepZ > 0 ? 1 : 0)) * this.cellSize) - az) / dZ : Infinity;
        const maxSteps = this.cols + this.rows + 2;

        for (let step = 0; step <= maxSteps; step++) {
            const segments = this.cells[row * this.cols + col];
            if (segments) {
                for (const s of segments) {
                    if (this.segmentStamp[s] === stamp) continue;
                    this.segmentStamp[s] = stamp;
                    const owner = this.owners[s];
                    if (this.ownerStamp[owner] === stamp || !ownerLoss[owner]) continue;
                    const o = s * 4;
                    const t = segmentIntersectionT(ax, az, bx, bz, this.coords[o], this.coords[o + 1], this.coords[o + 2], this.coords[o + 3]);
                    if (t >= 0 && t >= minT) {
                        this.ownerStamp[owner] = stamp;
                        loss += ownerLoss[owner];
                    }
                }
            }
            if (col === endCol && row === endRow) break;
            if (tMaxX < tMaxZ) { col += stepX; tMaxX += tDeltaX; } else { row += stepZ; tMaxZ += tDeltaZ; }
            if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) break;
        }
        return loss;
    }
}

// ---------------------------------------------------------------------------
// Mapa de sinal
// ---------------------------------------------------------------------------
/**
 * Calcula o melhor RSSI (dBm) de cada célula da grade.
 * accessPoints: [{ x, y, z }] em coordenadas do mundo (Y para cima).
 * Retorna Float32Array com rows*cols valores (linha 0 = minZ).
 */
export async function computeSignalGrid({
    accessPoints,
    obstacleSlice,
    obstacleKinds,
    band,
    eirpDbm,
    freqMHz,
    bounds,
    cellSize,
    receiverY,
    shouldCancel = () => false,
    onProgress = () => {},
    yieldEveryMs = 30
}) {
    const cols = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / cellSize));
    const rows = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / cellSize));
    const grid = new Float32Array(cols * rows).fill(-Infinity);
    const segmentGrid = new SegmentGrid(obstacleSlice, bounds, 1);
    const ownerLoss = Float32Array.from(obstacleKinds, (kind) => OBSTACLE_LOSS_DB[kind]?.[band] ?? OBSTACLE_LOSS_DB.masonry[band]);
    const fspl1m = freeSpaceLossAt1m(freqMHz);
    const n10 = 10 * PROPAGATION.pathLossExponent;
    const budget = eirpDbm + PROPAGATION.clientAntennaGainDbi - fspl1m;

    let lastYield = performance.now();
    for (let row = 0; row < rows; row++) {
        const z = bounds[1] + (row + 0.5) * cellSize;
        for (let col = 0; col < cols; col++) {
            const x = bounds[0] + (col + 0.5) * cellSize;
            let best = -Infinity;
            for (const ap of accessPoints) {
                const dx = x - ap.x, dz = z - ap.z, dy = ap.y - receiverY;
                const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
                const free = budget - n10 * Math.log10(distance);
                if (free <= best) continue; // nem sem paredes superaria o melhor AP atual
                const rssi = free - segmentGrid.lossAlong(ap.x, ap.z, x, z, ownerLoss);
                if (rssi > best) best = rssi;
            }
            grid[row * cols + col] = best;
        }

        if (performance.now() - lastYield > yieldEveryMs) {
            if (shouldCancel()) return null;
            onProgress((row + 1) / rows);
            await new Promise((resolve) => setTimeout(resolve, 0));
            lastYield = performance.now();
        }
    }
    onProgress(1);
    return { grid, cols, rows };
}

export function colorForSignal(rssi) {
    for (const level of SIGNAL_LEVELS) {
        if (rssi >= level.min) return level.color;
    }
    return NO_SIGNAL_COLOR;
}

/**
 * Resumo: percentual das células com nível ≥ −67 e ≥ −72.
 * Com máscara, conta só as células que estão sobre o piso.
 */
export function summarizeSignalGrid(grid, mask = null) {
    let good = 0, fair = 0, total = 0;
    for (let i = 0; i < grid.length; i++) {
        if (mask && !mask[i]) continue;
        total++;
        if (grid[i] >= -67) good++;
        if (grid[i] >= -72) fair++;
    }
    const divisor = total || 1;
    return { goodPercent: (good / divisor) * 100, fairPercent: (fair / divisor) * 100, cellCount: total };
}

// ---------------------------------------------------------------------------
// Piso: projeção das lajes na grade
// ---------------------------------------------------------------------------
/**
 * Marca as células da grade que estão sobre uma laje do pavimento.
 * Considera só faces horizontais com altura entre floorY − below e floorY + above.
 * Retorna { mask, count, topY } — topY é a face superior do piso encontrada (ou null).
 */
export function buildFloorMask(slabs, { bounds, cellSize, cols, rows, floorY, below = 0.5, above = 0.6 }) {
    const mask = new Uint8Array(cols * rows);
    const minX = bounds[0], minZ = bounds[1];
    let topY = -Infinity;

    for (const slab of slabs) {
        const aabb = slab.aabb;
        if (aabb && (aabb[4] < floorY - below || aabb[1] > floorY + above)) continue;

        const p = slab.positions, idx = slab.indices;
        for (let t = 0; t + 2 < idx.length; t += 3) {
            const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
            const ax = p[a], ay = p[a + 1], az = p[a + 2];
            const bx = p[b], by = p[b + 1], bz = p[b + 2];
            const cx = p[c], cy = p[c + 1], cz = p[c + 2];

            // só faces horizontais (normal quase vertical)
            const ux = bx - ax, uy = by - ay, uz = bz - az;
            const vx = cx - ax, vy = cy - ay, vz = cz - az;
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const length = Math.hypot(nx, ny, nz);
            if (!length || Math.abs(ny) / length < 0.9) continue;

            const faceY = (ay + by + cy) / 3;
            if (faceY < floorY - below || faceY > floorY + above) continue;
            if (faceY > topY) topY = faceY;

            // células cujo centro cai dentro do triângulo (projeção XZ)
            const c0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - minX) / cellSize - 0.5));
            const c1 = Math.min(cols - 1, Math.floor((Math.max(ax, bx, cx) - minX) / cellSize - 0.5));
            const r0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - minZ) / cellSize - 0.5));
            const r1 = Math.min(rows - 1, Math.floor((Math.max(az, bz, cz) - minZ) / cellSize - 0.5));
            const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
            if (Math.abs(area) < 1e-9) continue;
            const sign = area > 0 ? 1 : -1;
            const eps = -1e-9;

            for (let r = r0; r <= r1; r++) {
                const z = minZ + (r + 0.5) * cellSize;
                for (let col = c0; col <= c1; col++) {
                    const key = r * cols + col;
                    if (mask[key]) continue;
                    const x = minX + (col + 0.5) * cellSize;
                    const w0 = sign * ((bx - ax) * (z - az) - (bz - az) * (x - ax));
                    const w1 = sign * ((cx - bx) * (z - bz) - (cz - bz) * (x - bx));
                    const w2 = sign * ((ax - cx) * (z - cz) - (az - cz) * (x - cx));
                    if (w0 >= eps && w1 >= eps && w2 >= eps) mask[key] = 1;
                }
            }
        }
    }

    let count = 0;
    for (const value of mask) count += value;
    return { mask, count, topY: Number.isFinite(topY) ? topY : null };
}


// ---------------------------------------------------------------------------
// Renderização em alta qualidade
// ---------------------------------------------------------------------------
const FLOOR_DBM = -130;            // valor usado no lugar de "sem sinal" para interpolar

export function getSignalBandIndex(value, levels = SIGNAL_LEVELS) {
    for (let i = 0; i < levels.length; i++) {
        if (value >= levels[i].min) return i;
    }
    return levels.length;
}

/** Suavização gaussiana 3×3 (remove o serrilhado causado pela grade de raios). */
export function smoothGrid(grid, cols, rows, passes = 1) {
    let source = Float32Array.from(grid, (value) => (Number.isFinite(value) ? value : FLOOR_DBM));
    const kernel = [1, 2, 1];
    for (let pass = 0; pass < passes; pass++) {
        const output = new Float32Array(source.length);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                let sum = 0, weight = 0;
                for (let dr = -1; dr <= 1; dr++) {
                    const r = row + dr;
                    if (r < 0 || r >= rows) continue;
                    for (let dc = -1; dc <= 1; dc++) {
                        const c = col + dc;
                        if (c < 0 || c >= cols) continue;
                        const w = kernel[dr + 1] * kernel[dc + 1];
                        sum += source[r * cols + c] * w;
                        weight += w;
                    }
                }
                output[row * cols + col] = sum / weight;
            }
        }
        source = output;
    }
    return source;
}

/**
 * Gera a imagem RGBA do mapa: interpolação bilinear entre células, faixas de cor
 * e uma linha fina de contorno na troca de faixa (como no UniFi Design Center).
 * Opções:
 *  - levels: faixas { min, color } em ordem decrescente (valor maior = melhor)
 *  - noneColor: cor abaixo da última faixa
 *  - visibility: Uint8Array 0/1 por célula; onde é 0 o pixel fica transparente
 * Linha 0 da imagem = minZ.
 */
export function renderHeatmapPixels(grid, cols, rows, {
    scale = 8,
    maxSize = 4096,
    maxPixels = 8_000_000,
    levels = SIGNAL_LEVELS,
    noneColor = NO_SIGNAL_COLOR,
    visibility = null,
    shadeRange = 15
} = {}) {
    const pixelScale = Math.max(1, Math.min(
        scale,
        Math.floor(maxSize / Math.max(cols, rows)),
        Math.floor(Math.sqrt(maxPixels / (cols * rows)))
    ));
    const width = cols * pixelScale;
    const height = rows * pixelScale;
    const values = new Float32Array(width * height);
    const bands = new Uint8Array(width * height);
    const visible = visibility ? new Uint8Array(width * height) : null;

    for (let py = 0; py < height; py++) {
        const gy = Math.min(rows - 1, Math.max(0, (py + 0.5) / pixelScale - 0.5));
        const r0 = Math.floor(gy), r1 = Math.min(rows - 1, r0 + 1), fy = gy - r0;
        for (let px = 0; px < width; px++) {
            const gx = Math.min(cols - 1, Math.max(0, (px + 0.5) / pixelScale - 0.5));
            const c0 = Math.floor(gx), c1 = Math.min(cols - 1, c0 + 1), fx = gx - c0;
            const i00 = r0 * cols + c0, i01 = r0 * cols + c1, i10 = r1 * cols + c0, i11 = r1 * cols + c1;
            const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
            const value = grid[i00] * w00 + grid[i01] * w01 + grid[i10] * w10 + grid[i11] * w11;
            const index = py * width + px;
            values[index] = value;
            bands[index] = getSignalBandIndex(value, levels);
            if (visible) {
                const v = visibility[i00] * w00 + visibility[i01] * w01 + visibility[i10] * w10 + visibility[i11] * w11;
                visible[index] = v >= 0.5 ? 1 : 0;
            }
        }
    }

    const data = new Uint8ClampedArray(width * height * 4);
    const lastColor = levels[levels.length - 1]?.color || noneColor;
    for (let py = 0; py < height; py++) {
        for (let px = 0; px < width; px++) {
            const index = py * width + px;
            if (visible && !visible[index]) {
                // transparente; a cor evita borda escura na filtragem da textura
                data[index * 4] = lastColor[0];
                data[index * 4 + 1] = lastColor[1];
                data[index * 4 + 2] = lastColor[2];
                data[index * 4 + 3] = 0;
                continue;
            }
            const band = bands[index];
            const color = band < levels.length ? levels[band].color : noneColor;

            // leve variação de tom dentro da faixa: mais claro perto do limite superior
            let shade = 1;
            if (band < levels.length) {
                const upper = band === 0 ? levels[0].min + shadeRange : levels[band - 1].min;
                const lower = levels[band].min;
                const t = Math.min(1, Math.max(0, (values[index] - lower) / (upper - lower)));
                shade = 0.88 + 0.12 * t;
            }

            const differs = (other) => bands[other] !== band || (visible && !visible[other]);
            const isEdge =
                (px + 1 < width && differs(index + 1)) ||
                (py + 1 < height && differs(index + width)) ||
                (px > 0 && visible && !visible[index - 1]) ||
                (py > 0 && visible && !visible[index - width]);
            const factor = isEdge ? 0.55 : shade;

            data[index * 4] = color[0] * factor;
            data[index * 4 + 1] = color[1] * factor;
            data[index * 4 + 2] = color[2] * factor;
            data[index * 4 + 3] = 255;
        }
    }
    return { data, width, height, pixelScale };
}

/**
 * Faces superiores das lajes do pavimento, com a altura real de cada uma
 * (triângulos: x,y,z, x,y,z, x,y,z). O mapa é "estendido" sobre elas, então
 * pisos em cotas diferentes (paver, calçada, cerâmica) ficam todos cobertos.
 */
export function collectFloorFaces(slabs, { floorY, below = 0.5, above = 0.6 }) {
    const faces = [];
    for (const slab of slabs) {
        const aabb = slab.aabb;
        if (aabb && (aabb[4] < floorY - below || aabb[1] > floorY + above)) continue;
        const p = slab.positions, idx = slab.indices;
        const horizontal = [];
        let slabTop = -Infinity;
        for (let t = 0; t + 2 < idx.length; t += 3) {
            const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
            const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
            const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            const length = Math.hypot(nx, ny, nz);
            if (!length || Math.abs(ny) / length < 0.9) continue;
            const faceY = (p[a + 1] + p[b + 1] + p[c + 1]) / 3;
            if (faceY < floorY - below || faceY > floorY + above) continue;
            horizontal.push([a, b, c, faceY]);
            if (faceY > slabTop) slabTop = faceY;
        }
        // só a face de cima de cada laje (evita sobrepor a face de baixo)
        for (const [a, b, c, faceY] of horizontal) {
            if (faceY < slabTop - 0.02) continue;
            faces.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
        }
    }
    return Float64Array.from(faces);
}


/**
 * Altura do piso onde as pessoas pisam: entre as faces superiores das lajes do pavimento,
 * a cota que aparece em mais área vista de cima (a laje de cima esconde a de baixo).
 * Retorna null se não houver laje.
 */
export function dominantFloorY(slabs, floorY, { below = 0.5, above = 0.6, cellSize = 0.5 } = {}) {
    const faces = collectFloorFaces(slabs, { floorY, below, above });
    if (!faces.length) return null;
    const top = new Map();   // célula -> maior cota
    for (let i = 0; i < faces.length; i += 9) {
        const ax = faces[i], ay = faces[i + 1], az = faces[i + 2];
        const bx = faces[i + 3], by = faces[i + 4], bz = faces[i + 5];
        const cx = faces[i + 6], cy = faces[i + 7], cz = faces[i + 8];
        const faceY = (ay + by + cy) / 3;
        const area = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        if (Math.abs(area) < 1e-9) continue;
        const sign = area > 0 ? 1 : -1;
        const c0 = Math.ceil(Math.min(ax, bx, cx) / cellSize - 0.5), c1 = Math.floor(Math.max(ax, bx, cx) / cellSize - 0.5);
        const r0 = Math.ceil(Math.min(az, bz, cz) / cellSize - 0.5), r1 = Math.floor(Math.max(az, bz, cz) / cellSize - 0.5);
        for (let r = r0; r <= r1; r++) {
            const z = (r + 0.5) * cellSize;
            for (let col = c0; col <= c1; col++) {
                const x = (col + 0.5) * cellSize;
                const w0 = sign * ((bx - ax) * (z - az) - (bz - az) * (x - ax));
                const w1 = sign * ((cx - bx) * (z - bz) - (cz - bz) * (x - bx));
                const w2 = sign * ((ax - cx) * (z - cz) - (az - cz) * (x - cx));
                if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
                const key = `${col},${r}`;
                if (!top.has(key) || top.get(key) < faceY) top.set(key, faceY);
            }
        }
    }
    const histogram = new Map();
    for (const y of top.values()) {
        const key = Math.round(y * 100);
        histogram.set(key, (histogram.get(key) || 0) + 1);
    }
    let bestKey = null, bestCount = 0;
    for (const [key, count] of histogram) {
        if (count > bestCount) { bestKey = key; bestCount = count; }
    }
    return bestKey === null ? null : bestKey / 100;
}
