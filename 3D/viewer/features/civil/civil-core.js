// Instalações civis: regras puras (sem tela), para poderem ser testadas sozinhas.
//
// 1) A REDE vem do nome do arquivo IFC/XKT, pela sigla da disciplina:
//    IFC-HID-IPER.ifc → Hidráulico, XKT_SAN_TCE.xkt → Sanitário, etc.
// 2) A SUB-REDE vem da propriedade "Rede" de cada peça (a aba "Redes" do Explorador):
//    Água fria, Alimentação, Esgoto, Ventilação, Preventivo, Hidrantes…
// 3) Com material + rede + sub-rede, a peça é procurada na base_de_dados_sic.xlsx
//    (aba "Associa": DESCRIÇÃO, UNIDADE, REDE, SUBREDE; aba "Descricao": CÓDIGO,
//    BASE, DESCRIÇÃO, UNIDADE, na mesma linha).

export const CIVIL_DISCIPLINES = Object.freeze([
    { code: "HID", network: "HIDRÁULICO", label: "Hidráulico" },
    { code: "IRRI", network: "IRRIGAÇÃO", label: "Irrigação" },
    { code: "GLP", network: "GÁS GLP", label: "Gás GLP" },
    { code: "PLU", network: "ÁGUAS PLUVIAIS", label: "Águas Pluviais" },
    { code: "SAN", network: "SANITÁRIO", label: "Sanitário" },
    { code: "INC", network: "INCÊNDIO", label: "Incêndio" }
]);

/** Texto para comparação: sem acentos, minúsculo, espaços e símbolos padronizados. */
export function normalizeCivilText(value) {
    return String(value ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[º°ª]/g, "")
        .replace(/[´`‘’]/g, "'")
        .replace(/[“”]/g, '"')
        .replace(/\s*-\s*/g, " - ")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Descobre a disciplina pela sigla no nome do arquivo/modelo.
 * Aceita a sigla separada por traço, sublinhado, ponto, espaço ou barra:
 * "IFC-HID-IPER", "IFC_HID", "XKT SAN TCE", "modelos/PLU-v2.xkt".
 */
export function detectCivilDiscipline(...names) {
    for (const raw of names) {
        const text = String(raw ?? "").toUpperCase();
        if (!text) continue;
        const tokens = text.split(/[^A-Z0-9]+/).filter(Boolean);
        for (const discipline of CIVIL_DISCIPLINES) {
            if (tokens.includes(discipline.code)) return discipline;
        }
    }
    return null;
}

/**
 * Monta o índice da base a partir das linhas das duas abas (mesma ordem).
 * associaRows: [{ DESCRIÇÃO, UNIDADE, REDE, SUBREDE }]
 * descricaoRows: [{ CÓDIGO, BASE, DESCRIÇÃO, UNIDADE }]
 */
export function buildCivilDatabase(associaRows, descricaoRows) {
    const pick = (row, names) => {
        if (!row) return "";
        const keys = Object.keys(row);
        for (const name of names) {
            const key = keys.find((k) => normalizeCivilText(k) === normalizeCivilText(name));
            if (key !== undefined && row[key] !== undefined && row[key] !== null) return row[key];
        }
        return "";
    };

    const byMaterial = new Map();  // material normalizado -> [entradas]
    const entries = [];
    associaRows.forEach((row, index) => {
        const material = String(pick(row, ["DESCRIÇÃO", "DESCRICAO", "Descrição"]) || "").trim();
        if (!material) return;
        const detail = descricaoRows[index] || {};
        const entry = {
            row: index + 2, // linha da planilha (cabeçalho na linha 1)
            material,
            materialUnit: String(pick(row, ["UNIDADE", "Unidade"]) || "").trim(),
            network: String(pick(row, ["REDE", "Rede"]) || "").trim(),
            subnetwork: String(pick(row, ["SUBREDE", "SUB-REDE", "Sub-rede", "Subrede"]) || "").trim(),
            code: String(pick(detail, ["CÓDIGO", "CODIGO", "Código"]) || "").trim(),
            base: String(pick(detail, ["BASE", "Base"]) || "").trim(),
            description: String(pick(detail, ["DESCRIÇÃO", "DESCRICAO", "Descrição"]) || "").trim(),
            unit: String(pick(detail, ["UNIDADE", "Unidade"]) || "").trim()
        };
        entry.networkKey = normalizeCivilText(entry.network);
        entry.subnetworkKey = normalizeCivilText(entry.subnetwork);
        entries.push(entry);
        const key = normalizeCivilText(material);
        if (!byMaterial.has(key)) byMaterial.set(key, []);
        byMaterial.get(key).push(entry);
    });
    return { entries, byMaterial };
}

/**
 * Escolhe a composição de uma peça.
 * Retorna { status: "ok", entry } quando acha a combinação material + rede + sub-rede
 * (ou material + rede, quando a base não separa sub-rede para aquela rede);
 * { status: "subrede", suggestions } quando o material existe na rede, mas em outra sub-rede;
 * { status: "ausente", otherNetworks } quando não existe para aquela rede.
 */
export function resolveCivilItem(database, { material, network, subnetwork }) {
    const candidates = database.byMaterial.get(normalizeCivilText(material)) || [];
    const networkKey = normalizeCivilText(network);
    const subnetworkKey = normalizeCivilText(subnetwork);
    const sameNetwork = candidates.filter((entry) => entry.networkKey === networkKey);

    const exact = sameNetwork.find((entry) => entry.subnetworkKey && entry.subnetworkKey === subnetworkKey);
    if (exact) return { status: "ok", entry: exact };

    const anySubnetwork = sameNetwork.find((entry) => !entry.subnetworkKey);
    if (anySubnetwork) return { status: "ok", entry: anySubnetwork };

    if (sameNetwork.length) {
        return { status: "subrede", suggestions: [...new Set(sameNetwork.map((entry) => entry.subnetwork))] };
    }
    return { status: "ausente", otherNetworks: [...new Set(candidates.map((entry) => entry.network))] };
}

/**
 * Agrupa as peças lidas do modelo.
 * pieces: [{ objectId, modelId, discipline, subnetwork, material, quantity, unitLabel }]
 */
export function aggregateCivilPieces(database, pieces) {
    const matched = new Map();
    const pending = new Map();

    for (const piece of pieces) {
        const network = piece.discipline.network;
        const result = resolveCivilItem(database, { material: piece.material, network, subnetwork: piece.subnetwork });

        if (result.status === "ok") {
            const entry = result.entry;
            // Rede sem sub-rede na base (Irrigação, Pluviais, GLP): soma tudo junto
            const subnetwork = entry.subnetworkKey ? piece.subnetwork : "";
            const key = [network, normalizeCivilText(subnetwork), entry.code || entry.material, entry.description].join("|");
            const item = matched.get(key) || {
                discipline: piece.discipline,
                subnetwork,
                code: entry.code,
                base: entry.base,
                description: entry.description || entry.material,
                unit: entry.unit || entry.materialUnit,
                quantity: 0,
                materials: new Set(),
                objectIds: new Set(),
                databaseRows: new Set()
            };
            item.quantity += piece.quantity;
            item.materials.add(piece.material);
            item.objectIds.add(piece.objectId);
            item.databaseRows.add(entry.row);
            matched.set(key, item);
        } else {
            const key = [network, normalizeCivilText(piece.subnetwork), normalizeCivilText(piece.material)].join("|");
            const item = pending.get(key) || {
                discipline: piece.discipline,
                subnetwork: piece.subnetwork,
                material: piece.material,
                unitLabel: piece.unitLabel,
                quantity: 0,
                status: result.status,
                suggestions: result.suggestions || [],
                otherNetworks: result.otherNetworks || [],
                objectIds: new Set()
            };
            item.quantity += piece.quantity;
            item.objectIds.add(piece.objectId);
            pending.set(key, item);
        }
    }

    const order = (a, b) =>
        CIVIL_DISCIPLINES.indexOf(a.discipline) - CIVIL_DISCIPLINES.indexOf(b.discipline) ||
        String(a.subnetwork).localeCompare(String(b.subnetwork), "pt-BR") ||
        String(a.description || a.material).localeCompare(String(b.description || b.material), "pt-BR");

    return {
        matched: [...matched.values()].sort(order),
        pending: [...pending.values()].sort(order)
    };
}

/** Texto do motivo de uma pendência. */
export function describeCivilPending(item) {
    if (item.status === "subrede") {
        return `Na base existe só para a sub-rede ${item.suggestions.join(", ")}`;
    }
    if (item.otherNetworks.length) {
        return `Na base existe só para ${item.otherNetworks.join(", ")}`;
    }
    return "Material não cadastrado na base";
}
