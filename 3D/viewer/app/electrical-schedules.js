// Módulo "electrical-schedules" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { RACK_LENGTH_LIMIT_M, viewer } from "../viewer-authenticated.js";
import { quadroFeatureAllowed } from "./access.js";
import { formatIfcPropertyValue, getMetaObjectPropertyValue } from "./ifc-meta.js";
import { extractNumericPropertyValue } from "./materials.js";


export function closePropertyPanel() {
    const painel = document.getElementById("propertyPanel");
    if (painel) {
        painel.remove();
    }
}

export function normalizeIfcPropertyLabel(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

export function isQuadroName(value) {
    // Aceita QD ou QGBT no início, com ou sem número na frente
    // (QD1, QD-T-3, 1QDL-T, 2 QD1, 10-QGBT, QGBT 220V...)
    return /^\d*[\s._-]*(QD|QGBT)/i.test(String(value || "").trim());
}

export function getMetaObjectPropertySetByName(metaObject, targetName) {
    if (!metaObject?.propertySets?.length) {
        return null;
    }

    const normalizedTarget = normalizeIfcPropertyLabel(targetName);

    return metaObject.propertySets.find((pset) => {
        const psetName = pset?.name || pset?.id || "";
        return normalizeIfcPropertyLabel(psetName) === normalizedTarget;
    }) || null;
}

export function getMetaObjectIndexedPropertySetsByPrefix(metaObject, targetPrefix) {
    if (!metaObject?.propertySets?.length) {
        return [];
    }

    const normalizedPrefix = normalizeIfcPropertyLabel(targetPrefix);
    const escapedPrefix = normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefixPattern = new RegExp(`^${escapedPrefix}(\\d+)$`);

    return metaObject.propertySets
        .map((propertySet) => {
            const propertySetName = propertySet?.name || propertySet?.id || "";
            const match = normalizeIfcPropertyLabel(propertySetName).match(prefixPattern);
            return match
                ? {
                    propertySet,
                    index: Number(match[1]),
                    name: propertySetName
                }
                : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.index - b.index);
}

export function getPropertyFromSet(pset, propertyName) {
    if (!pset?.properties?.length) {
        return null;
    }

    return pset.properties.find((prop) => String(prop?.name || prop?.id || "").trim() === propertyName) || null;
}

export function getPropertyValueFromSet(pset, propertyName) {
    const property = getPropertyFromSet(pset, propertyName);
    return property ? property.value : null;
}

export function getPropertyTextValue(pset, propertyName, fallback = "") {
    const value = getPropertyValueFromSet(pset, propertyName);
    if (value === null || value === undefined) {
        return fallback;
    }

    if (typeof value === "string") {
        return value.trim();
    }

    if (typeof value === "object") {
        const candidates = [value.value, value.nominalValue, value.rawValue, value.label, value.name];
        for (const candidate of candidates) {
            if (candidate !== null && candidate !== undefined) {
                return String(candidate).trim();
            }
        }
    }

    return String(value).trim();
}

export function getQuadroPolosAnnotation(metaObject) {
    if (!metaObject) {
        return "";
    }

    if (!isSupportedQuadroAnnotationType(metaObject)) {
        return "";
    }

    const numeroPolos = getMetaObjectPropertyValue(metaObject, ["Número de polos", "Numero de polos"], {
        propertySetNames: ["AltoQi_Builder"]
    });

    const numeroPolosValue = extractNumericPropertyValue(numeroPolos);
    if (!Number.isFinite(numeroPolosValue)) {
        return "";
    }

    const polosUtilizados = getQuadroUsedPolesFromAssociatedItems(metaObject);
    if (!Number.isFinite(polosUtilizados)) {
        return "";
    }

    const espacosFaltantes = Math.max(0, numeroPolosValue - polosUtilizados);
    return `Espaço(s) faltante(s): ${espacosFaltantes}`;
}

export function isSupportedQuadroAnnotationType(metaObject) {
    const supportedTypes = ["ifcelectricdistributionboard", "ifcflowfitting"];
    const normalizedType = normalizeIfcPropertyLabel(metaObject?.type || "");
    if (supportedTypes.includes(normalizedType)) {
        return true;
    }

    return normalizedType === "ifcbuildingelementproxy" && hasQuadroProtectionPiece(metaObject);
}

export function hasElectricalDevicePonto1(metaObject) {
    return Boolean(getMetaObjectPropertySetByName(metaObject, "Pset_ElectricalDeviceCommon-Ponto1"));
}

export function hasQuadroProtectionPiece(metaObject) {
    const protectionPiece = getMetaObjectPropertyValue(metaObject, ["Proteção - Peça", "Protecao - Peca"], {
        propertySetNames: ["AltoQi_Builder"]
    });

    return String(protectionPiece || "").trim() !== "";
}

export function isQuadroAnnotationCandidate(metaObject) {
    const normalizedType = normalizeIfcPropertyLabel(metaObject?.type || "");

    if (["ifcelectricdistributionboard", "ifcflowfitting"].includes(normalizedType)) {
        return hasElectricalDevicePonto1(metaObject);
    }

    return normalizedType === "ifcbuildingelementproxy" && hasQuadroProtectionPiece(metaObject);
}

export function getQuadroAnnotations(metaObject) {
    if (!isQuadroAnnotationCandidate(metaObject)) {
        return [];
    }
    const annotations = [];
    const polosAnnotation = getQuadroPolosAnnotation(metaObject);
    const dpsAnnotation = getQuadroDpsAnnotation(metaObject);
    const drAnnotation = getQuadroDrAnnotation(metaObject);
    const barramentoAnnotation = getQuadroBarramentoAnnotation(metaObject);

    if (polosAnnotation) {
        annotations.push(polosAnnotation);
    }

    if (dpsAnnotation) {
        annotations.push(dpsAnnotation);
    }

    if (drAnnotation) {
        annotations.push(drAnnotation);
    }

    if (barramentoAnnotation) {
        annotations.push(barramentoAnnotation);
    }

    return annotations;
}

export function getQuadroBarramentoAnnotation(metaObject) {
    if (!isSupportedQuadroAnnotationType(metaObject)) {
        return "";
    }
    if (!metaObject?.propertySets?.length) {
        return "";
    }

    const pontoSet = getMetaObjectPropertySetByName(metaObject, "Pset_ElectricalDeviceCommon-Ponto1");
    const identificacaoSet = getMetaObjectPropertySetByName(metaObject, "Identificação_Elemento");

    if (!pontoSet || !identificacaoSet) {
        return "";
    }

    const nominalCurrent = extractNumericPropertyValue(getPropertyValueFromSet(pontoSet, "NominalCurrent"));
    const nome = getPropertyTextValue(identificacaoSet, "Nome", "");
    if (!Number.isFinite(nominalCurrent)) {
        return "";
    }

    if (nominalCurrent <= 100) {
        return "Barramento: Correto";
    }

    const capacidadeBarramento = extractBusbarCapacityFromName(nome);
    if (!Number.isFinite(capacidadeBarramento)) {
        return "";
    }

    return nominalCurrent > capacidadeBarramento
        ? "Barramento: Errado"
        : "Barramento: Correto";
}

export function extractBusbarCapacityFromName(nameText) {
    const text = String(nameText || "");
    if (!text) {
        return null;
    }

    const inBarramentoMatch = text.match(/(?:in|i)\s*barr\.?\s*(\d+(?:[.,]\d+)?)/i);
    if (inBarramentoMatch) {
        return extractNumericPropertyValue(inBarramentoMatch[1]);
    }

    const barramentoMatch = text.match(/barr(?:amento)?[^0-9]*(\d+(?:[.,]\d+)?)/i);
    if (barramentoMatch) {
        return extractNumericPropertyValue(barramentoMatch[1]);
    }

    return null;
}

export function getQuadroDpsAnnotation(metaObject) {
    if (!isSupportedQuadroAnnotationType(metaObject)) {
        return "";
    }
    if (!metaObject?.propertySets?.length) {
        return "";
    }

    const itensAssociadosSet = getMetaObjectPropertySetByName(metaObject, "AltoQi_QiBuilder-Itens_Associados");
    if (!itensAssociadosSet || !Array.isArray(itensAssociadosSet.properties)) {
        return "";
    }

    const hasDps = itensAssociadosSet.properties.some((prop) => {
        const propName = normalizeIfcPropertyLabel(prop?.name || prop?.id || "");
        const propValue = normalizeIfcPropertyLabel(formatIfcPropertyValue(prop?.value));
        return propName.includes("contra surto") || propValue.includes("contra surto");
    });

    return hasDps ? "DPS: Tem DPS" : "DPS: Não tem DPS";
}

export function getQuadroDrAnnotation(metaObject) {
    if (!isSupportedQuadroAnnotationType(metaObject)) {
        return "";
    }
    
    if (!metaObject?.propertySets?.length) {
        return "";
    }

    const itensAssociadosSet = getMetaObjectPropertySetByName(metaObject, "AltoQi_QiBuilder-Itens_Associados");
    if (!itensAssociadosSet || !Array.isArray(itensAssociadosSet.properties)) {
        return "";
    }

    const hasDr = itensAssociadosSet.properties.some((prop) => {
        const propName = normalizeIfcPropertyLabel(prop?.name || prop?.id || "");
        const propValue = normalizeIfcPropertyLabel(formatIfcPropertyValue(prop?.value));
        return propName.includes("interruptor") || propValue.includes("interruptor");
    });

    return hasDr ? "DR: Tem DR" : "DR: Não tem DR";
}

export function getQuadroUsedPolesFromAssociatedItems(metaObject) {
    if (!metaObject?.propertySets?.length) {
        return null;
    }

    const itensAssociadosSet = getMetaObjectPropertySetByName(metaObject, "AltoQi_QiBuilder-Itens_Associados");
    if (!itensAssociadosSet || !Array.isArray(itensAssociadosSet.properties)) {
        return null;
    }

    const keywordMultipliers = [
        { keyword: "contra surto", multiplier: 1 },
        { keyword: "tetrapolar", multiplier: 4 },
        { keyword: "tripolar", multiplier: 3 },
        { keyword: "bipolar", multiplier: 2 },
        { keyword: "unipolar", multiplier: 1 }
    ];

    const detectMultiplier = (text) => {
        const normalizedText = normalizeIfcPropertyLabel(text);
        const matched = keywordMultipliers.find(({ keyword }) => normalizedText.includes(keyword));
        return matched ? matched.multiplier : null;
    };

    const extractQuantityFromText = (text) => {
        const match = String(text || "").match(/(\d+(?:[.,]\d+)?)/);
        if (!match) {
            return null;
        }
        const parsed = Number.parseFloat(match[1].replace(",", "."));
        return Number.isFinite(parsed) ? parsed : null;
    };

    const indexedItems = new Map();

    for (const prop of itensAssociadosSet.properties) {
        const propName = String(prop?.name || prop?.id || "");
        const propValueText = formatIfcPropertyValue(prop?.value);
        const suffixMatch = propName.match(/_(\d+)$/);

        if (!suffixMatch) {
            continue;
        }

        const index = Number(suffixMatch[1]);
        const current = indexedItems.get(index) || {
            textFragments: [],
            quantity: null
        };

        current.textFragments.push(propName, propValueText);

        const normalizedPropName = normalizeIfcPropertyLabel(propName);
        const isQuantityField = normalizedPropName.includes("qtd") || normalizedPropName.includes("qtde") || normalizedPropName.includes("quant");

        if (isQuantityField) {
            const parsedQuantity = extractNumericPropertyValue(prop?.value);
            if (Number.isFinite(parsedQuantity)) {
                current.quantity = parsedQuantity;
            }
        }

        indexedItems.set(index, current);
    }

    const indexedTotal = Array.from(indexedItems.values()).reduce((total, item) => {
        const text = item.textFragments.join(" ");
        const multiplier = detectMultiplier(text);
        if (!Number.isFinite(multiplier)) {
            return total;
        }

        const quantity = Number.isFinite(item.quantity) ? item.quantity : extractQuantityFromText(text) || 1;
        return total + (quantity * multiplier);
    }, 0);

    if (indexedTotal > 0) {
        return indexedTotal;
    }

    const fallbackTotal = itensAssociadosSet.properties.reduce((total, prop) => {
        const propName = String(prop?.name || prop?.id || "");
        const propValueText = formatIfcPropertyValue(prop?.value);
        const combinedText = `${propName} ${propValueText}`;
        const multiplier = detectMultiplier(combinedText);
        if (!Number.isFinite(multiplier)) {
            return total;
        }

        const quantity = extractNumericPropertyValue(prop?.value) || extractQuantityFromText(combinedText) || 1;
        return total + (quantity * multiplier);
    }, 0);

    if (fallbackTotal > 0) {
        return fallbackTotal;
    }

    return 0;
}

export function extractElectricalPointEntries(metaObject) {
    if (!metaObject) {
        return [];
    }

    const pointSets = getMetaObjectIndexedPropertySetsByPrefix(metaObject, "AltoQi_Builder-Ponto");
    const circuitoSet = getMetaObjectPropertySetByName(metaObject, "Circuito");

    if (!pointSets.length || !circuitoSet) {
        return [];
    }

    const validPoints = pointSets
        .map(({ propertySet, index }) => {
            const potencia = extractNumericPropertyValue(getPropertyValueFromSet(propertySet, "Potência (W)"));
            const rendimento = extractNumericPropertyValue(getPropertyValueFromSet(propertySet, "Rendimento (%)"));
            const fatorPotencia = extractNumericPropertyValue(getPropertyValueFromSet(propertySet, "Fator de potência (%)"));
            const quantidade = extractNumericPropertyValue(getPropertyValueFromSet(propertySet, "Quantidade")) ?? 1;

    if (!Number.isFinite(potencia) || !Number.isFinite(rendimento) || !Number.isFinite(fatorPotencia) || fatorPotencia === 0) {
                return null;
            }

            return { index, potencia, rendimento, fatorPotencia, quantidade };
        })
        .filter(Boolean);

    if (!validPoints.length) {
        return [];
    }

    const properties = Array.isArray(circuitoSet.properties) ? circuitoSet.properties : [];
    const indexes = new Set();

    properties.forEach((prop) => {
        const propName = String(prop?.name || prop?.id || "").trim();
        const match = propName.match(/_(\d+)$/);
        if (match) {
            indexes.add(Number(match[1]));
        }
    });

    const totalIndexes = indexes.size || 1;
    const entries = [];

    indexes.forEach((index) => {
        const quadro = getPropertyTextValue(circuitoSet, `Quadro_${index}`, "");
        const pavimento = getPropertyTextValue(circuitoSet, `Pavimento_do_circuito_${index}`, "");
        const circuito = getPropertyTextValue(circuitoSet, `Circuito_${index}`, "");

        if (!quadro || !circuito) {
            return;
        }

        const pointsForCircuit = totalIndexes === 1
            ? validPoints
            : validPoints.filter((point) => point.index === index);

        pointsForCircuit.forEach(({ potencia, rendimento, fatorPotencia, quantidade }) => {
            const multiplicadorQuantidade = totalIndexes === 1 ? quantidade : 1;
            const potenciaCalculada = potencia * multiplicadorQuantidade * (rendimento / 100) / (fatorPotencia / 100);
            entries.push({
                quadro: quadro.trim(),
                pavimento: pavimento.trim(),
                circuito: circuito.trim(),
                potenciaCalculadaW: potenciaCalculada
            });
        });
    });

    return entries;
}

export function generatePanelScheduleForQuadro(quadroName, electricalConfig = null) {
    const normalizedQuadro = String(quadroName || "").trim().toUpperCase();
    const groupedByCircuit = new Map();
    const allMetaObjects = viewer.metaScene?.metaObjects || {};

    for (const metaObject of Object.values(allMetaObjects)) {
        const entries = extractElectricalPointEntries(metaObject);
        entries.forEach((entry) => {
            if (String(entry.quadro || "").trim().toUpperCase() !== normalizedQuadro) {
                return;
            }

            const key = `${entry.quadro}__${entry.pavimento}__${entry.circuito}`;
            const current = groupedByCircuit.get(key) || {
                quadro: entry.quadro,
                pavimento: entry.pavimento,
                circuito: entry.circuito,
                potenciaTotalW: 0,
                correnteA: null
            };

            current.potenciaTotalW += entry.potenciaCalculadaW;
            if (electricalConfig?.divisorCorrente) {
                current.correnteA = current.potenciaTotalW / electricalConfig.divisorCorrente;
            }
            groupedByCircuit.set(key, current);
        });
    }

    const rows = Array.from(groupedByCircuit.values()).sort((a, b) => {
        const pavCompare = String(a.pavimento || "").localeCompare(String(b.pavimento || ""), "pt-BR");
        if (pavCompare !== 0) {
            return pavCompare;
        }
        return String(a.circuito || "").localeCompare(String(b.circuito || ""), "pt-BR", { numeric: true });
    });

    return {
        quadro: normalizedQuadro,
        rows,
        electricalConfig
    };
}

export function formatPowerWatts(value) {
    return `${Number(value || 0).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })} VA`;
}

export function formatCurrentAmpere(value) {
    if (!Number.isFinite(value)) {
        return "-";
    }

    return `${Number(value).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })} A`;
}

export function normalizeElectricalLabel(text) {
    return String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, "")
        .toUpperCase();
}

export function resolveCurrentDivisor(esquema, tensao) {
    const normalizedEsquema = normalizeElectricalLabel(esquema);
    const normalizedTensao = normalizeElectricalLabel(tensao);

    if (!normalizedEsquema || !normalizedTensao) {
        return null;
    }

    const tensionMatch = normalizedTensao.match(/^(\d+)\//);
    const tensaoLinha = tensionMatch ? Number(tensionMatch[1]) : null;
    if (!Number.isFinite(tensaoLinha) || tensaoLinha <= 0) {
        return null;
    }

    if (normalizedEsquema === "F+N") {
        return tensaoLinha / Math.sqrt(3);
    }

    if (normalizedEsquema === "2F+N") {
        return tensaoLinha;
    }

    if (normalizedEsquema === "3F+N") {
        return tensaoLinha * Math.sqrt(3);
    }

    return null;
}

export function getQuadroElectricalConfig(metaObject) {
    const altoQiBuilderSet = getMetaObjectPropertySetByName(metaObject, "AltoQi_Builder");
    if (!altoQiBuilderSet) {
        return null;
    }

    const esquema = getPropertyTextValue(altoQiBuilderSet, "Esquema", "");
    const tensao = getPropertyTextValue(altoQiBuilderSet, "Tensão", "");
    const divisorCorrente = resolveCurrentDivisor(esquema, tensao);

    if (!divisorCorrente) {
        return null;
    }

    return {
        esquema,
        tensao,
        divisorCorrente
    };
}   // NBR 14565 / TIA-568: enlace permanente até 90 m

export function normalizeRackText(value) {
    return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function isRackMetaObject(metaObject) {
    const identification = getMetaObjectPropertySetByName(metaObject, "Identificação_Elemento");
    return normalizeRackText(getPropertyValueFromSet(identification, "Aplicação")) === "rack";
}

// Peças de infraestrutura: mesmo quando levam o circuito nas propriedades, não são pontos
export const RACK_ROUTE_APPLICATIONS = new Set(["circular", "retangular aberto", "retangular", "conexao"]);

/** Nome do pavimento (IfcBuildingStorey) onde o objeto está no IFC. */
export function getStoreyNameOf(metaObject) {
    for (let current = metaObject?.parent; current; current = current.parent) {
        if (current.type === "IfcBuildingStorey") return current.name || "";
    }
    return "";
}

/** "PAV. TÉRREO", "Pav Terreo" e "TERREO" são o mesmo pavimento. */
export function normalizeStoreyLabel(value) {
    return normalizeRackText(value).replace(/\bpav(imento)?\b\.?/g, "").replace(/[^a-z0-9]+/g, "");
}

export function sameStorey(a, b) {
    const x = normalizeStoreyLabel(a), y = normalizeStoreyLabel(b);
    return Boolean(x && y) && (x === y || x.includes(y) || y.includes(x));
}

/**
 * Lista de pontos do rack: um item por circuito (PT-TE-31, CFTV-1…), a partir de Quadro_N/Circuito_N.
 * Quando há vários racks com o mesmo nome (ex.: um "FD1" por pavimento), mostra só os pontos
 * do pavimento do rack clicado.
 */
export function generateRackSchedule(rackName, rackMetaObject = null) {
    const wantedRack = normalizeRackText(rackName);
    const allMetaObjects = Object.values(viewer.metaScene?.metaObjects || {});
    const rows = new Map();
    for (const metaObject of allMetaObjects) {
        const circuitSet = getMetaObjectPropertySetByName(metaObject, "Circuito");
        if (!circuitSet) continue;
        const identification = getMetaObjectPropertySetByName(metaObject, "Identificação_Elemento");
        if (RACK_ROUTE_APPLICATIONS.has(normalizeRackText(getPropertyValueFromSet(identification, "Aplicação")))) continue;
        const network = String(getPropertyValueFromSet(identification, "Rede") || "");
        const type = network.replace(/^.*\(([^)]*)\).*$/, "$1").trim() || network || "-";
        for (let i = 1; i <= 40; i++) {
            const circuito = getPropertyValueFromSet(circuitSet, `Circuito_${i}`);
            if (!circuito) continue;
            if (normalizeRackText(getPropertyValueFromSet(circuitSet, `Quadro_${i}`)) !== wantedRack) continue;
            const label = String(circuito).replace(/[\s-]+$/, "").trim();
            const pavimento = getPropertyValueFromSet(circuitSet, `Pavimento_do_circuito_${i}`) || "-";
            // o mesmo rótulo pode existir em pavimentos diferentes (um FD1 por andar)
            const key = `${normalizeRackText(pavimento)}|${normalizeRackText(label)}`;
            const row = rows.get(key) || {
                rack: rackName,
                pavimento,
                circuito: label,
                tipo: type,
                descricao: getPropertyValueFromSet(identification, "Descrição") || "",
                pontos: 0,
                pointIds: [],
                pointStoreys: new Set(),
                comprimento: null
            };
            row.pontos++;
            if (!row.pointIds.includes(metaObject.id)) row.pointIds.push(metaObject.id);
            row.pointStoreys.add(getStoreyNameOf(metaObject));
            rows.set(key, row);
        }
    }

    // Vários racks com o mesmo nome: fica só o pavimento do rack clicado
    let allRows = [...rows.values()];
    let filterNote = "";
    const sameNameRacks = allMetaObjects.filter((metaObject) =>
        normalizeRackText(metaObject.name) === wantedRack && isRackMetaObject(metaObject));
    const rackStorey = getStoreyNameOf(rackMetaObject);
    if (sameNameRacks.length > 1 && rackStorey) {
        let filtered = allRows.filter((row) => sameStorey(row.pavimento, rackStorey));
        if (!filtered.length) filtered = allRows.filter((row) => [...row.pointStoreys].some((storey) => sameStorey(storey, rackStorey)));
        if (filtered.length) {
            filterNote = `Há ${sameNameRacks.length} racks “${rackName}”: mostrando só o pavimento ${rackStorey}.`;
            allRows = filtered;
        } else {
            filterNote = `Há ${sameNameRacks.length} racks “${rackName}”, mas não foi possível separar por pavimento: mostrando todos.`;
        }
    }
    const sorted = allRows.sort((a, b) =>
        String(a.pavimento).localeCompare(String(b.pavimento), "pt-BR") ||
        String(a.tipo).localeCompare(String(b.tipo), "pt-BR") ||
        a.circuito.localeCompare(b.circuito, "pt-BR", { numeric: true }));
    return { rack: rackName, rows: sorted, filterNote, storey: rackStorey };
}

export function formatRackLength(row) {
    if (row.comprimento === null || row.comprimento === undefined) return "—";
    if (row.semCaminho) return "sem caminho";
    return `~${Math.round(row.comprimento).toLocaleString("pt-BR")} m`;
}

export function createRackSummaryHtml(result) {
    if (!result?.rows?.length) {
        return `<div class="property-panel-empty">Nenhum ponto vinculado ao rack ${result?.rack || ""} foi encontrado.</div>`;
    }
    const byType = result.rows.reduce((acc, row) => ((acc[row.tipo] = (acc[row.tipo] || 0) + 1), acc), {});
    const typeText = Object.entries(byType).map(([type, count]) => `${count} ${type}`).join(" • ");
    const measured = result.rows.some((row) => row.comprimento !== null && row.comprimento !== undefined);
    const over = result.rows.filter((row) => row.comprimento > RACK_LENGTH_LIMIT_M).length;
    const lengthSummary = measured
        ? `<div class="quadro-summary-total" style="color:${over ? "#fca5a5" : "#86efac"}">${over
            ? `⚠ ${over} ponto(s) acima de ${RACK_LENGTH_LIMIT_M} m`
            : `✓ Todos os pontos até ${RACK_LENGTH_LIMIT_M} m`} (comprimento estimado pela infraestrutura)</div>`
        : "";
    return `
        <div class="property-panel-section">
            <div class="property-panel-section-title">Pontos do rack ${result.rack}</div>
            <div class="quadro-summary-total">${result.rows.length} ponto(s) • ${typeText}</div>
            ${result.filterNote ? `<div class="quadro-summary-hint">${result.filterNote}</div>` : ""}
            ${lengthSummary}
            <div class="quadro-summary-hint">Clique em um ponto para ver o caminho dele no 3D.</div>
            <table class="property-panel-table quadro-summary-table">
                <thead>
                    <tr><th>Pavimento</th><th>Ponto</th><th>Tipo</th><th>Comprimento</th></tr>
                </thead>
                <tbody>
                    ${result.rows.map((row, index) => `
                        <tr data-circuit-index="${index}" title="Ver o caminho do ponto no 3D">
                            <td>${row.pavimento}</td>
                            <td>${row.circuito}</td>
                            <td>${row.tipo}</td>
                            <td style="${row.comprimento > RACK_LENGTH_LIMIT_M ? "color:#fca5a5;font-weight:bold" : ""}">${formatRackLength(row)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}

export function downloadRackScheduleAsExcel(result) {
    if (!result?.rows?.length) return;
    const cell = (value, type = "String") => `<Cell><Data ss:Type="${type}">${escapeQuadroXml(value)}</Data></Cell>`;
    const rowsXml = result.rows.map((row) => `
            <Row>${cell(row.rack)}${cell(row.pavimento)}${cell(row.circuito)}${cell(row.tipo)}${cell(row.descricao)}${
                Number.isFinite(row.comprimento) && !row.semCaminho ? cell(Math.round(row.comprimento), "Number") : cell("-")}${
                cell(row.comprimento > RACK_LENGTH_LIMIT_M ? `ACIMA DE ${RACK_LENGTH_LIMIT_M} m` : (Number.isFinite(row.comprimento) ? "OK" : "-"))}</Row>`).join("");
    const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/></Style></Styles>
    <Worksheet ss:Name="Pontos do rack">
        <Table>
            <Row>${["Rack", "Pavimento", "Ponto", "Tipo", "Descrição", "Comprimento estimado (m)", `Limite ${RACK_LENGTH_LIMIT_M} m`]
                .map((title) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${title}</Data></Cell>`).join("")}</Row>${rowsXml}
        </Table>
    </Worksheet>
</Workbook>`;
    const url = URL.createObjectURL(new Blob([xml], { type: "application/vnd.ms-excel" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `rack_${String(result.rack || "rack").replace(/[^\w-]+/g, "_")}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

export function createQuadroSummaryHtml(result) {
    if (!result?.rows?.length) {
        return `<div class="property-panel-empty">Nenhum ponto vinculado ao quadro ${result?.quadro || ""} foi encontrado.</div>`;
    }

    const totalGeral = result.rows.reduce((sum, row) => sum + row.potenciaTotalW, 0);
    const correnteTotal = result?.electricalConfig?.divisorCorrente
        ? totalGeral / result.electricalConfig.divisorCorrente
        : null;
    const subtitleCurrent = Number.isFinite(correnteTotal)
        ? ` • ${formatCurrentAmpere(correnteTotal)}`
        : "";

    return `
        <div class="property-panel-section">
            <div class="property-panel-section-title">Resumo do quadro ${result.quadro}</div>
            <div class="quadro-summary-total">${result.rows.length} circuito(s) • ${formatPowerWatts(totalGeral)}${subtitleCurrent}</div>
            <div class="quadro-summary-hint">Clique em um circuito para ver o caminho dele no 3D.</div>
            <table class="property-panel-table quadro-summary-table">
                 <thead>
                    <tr>
                        <th>Quadro</th>
                        <th>Pavimento</th>
                        <th>Circuito</th>
                        <th>Potência total</th>
                    </tr>
                </thead>
                <tbody>
                    ${result.rows.map((row, index) => `
                        <tr data-circuit-index="${index}" title="Ver o caminho do circuito no 3D">
                            <td>${row.quadro}</td>
                            <td>${row.pavimento || "-"}</td>
                            <td>${row.circuito}</td>
                            <td>${formatPowerWatts(row.potenciaTotalW)}</td>
                        </tr>
                    `).join("")}
                </tbody>
            </table>
        </div>
    `;
}
export function escapeQuadroXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/^[=+\-@]/, "'$&");
}

export function downloadQuadroScheduleAsExcel(result) {
    if (!quadroFeatureAllowed || !result?.rows?.length) {
        return;
    }

    const divisor = result.electricalConfig?.divisorCorrente;
    const numberCell = (value) => Number.isFinite(value)
        ? `<Cell ss:StyleID="Num"><Data ss:Type="Number">${value.toFixed(2)}</Data></Cell>`
        : `<Cell><Data ss:Type="String">-</Data></Cell>`;

    const rowsXml = result.rows.map((row) => `
            <Row>
                <Cell><Data ss:Type="String">${escapeQuadroXml(row.quadro)}</Data></Cell>
                <Cell><Data ss:Type="String">${escapeQuadroXml(row.pavimento || "-")}</Data></Cell>
                <Cell><Data ss:Type="String">${escapeQuadroXml(row.circuito)}</Data></Cell>
                ${numberCell(row.potenciaTotalW)}
                ${numberCell(divisor ? row.potenciaTotalW / divisor : null)}
            </Row>`).join("");

    const totalW = result.rows.reduce((sum, row) => sum + row.potenciaTotalW, 0);

    const spreadsheetXml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
    <Styles>
        <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9E1F2" ss:Pattern="Solid"/></Style>
        <Style ss:ID="Num"><NumberFormat ss:Format="#,##0.00"/></Style>
        <Style ss:ID="Total"><Font ss:Bold="1"/><NumberFormat ss:Format="#,##0.00"/></Style>
    </Styles>
    <Worksheet ss:Name="Quadro">
        <Table>
            <Row>
                <Cell ss:StyleID="Header"><Data ss:Type="String">Quadro</Data></Cell>
                <Cell ss:StyleID="Header"><Data ss:Type="String">Pavimento</Data></Cell>
                <Cell ss:StyleID="Header"><Data ss:Type="String">Circuito</Data></Cell>
                <Cell ss:StyleID="Header"><Data ss:Type="String">Potência total (VA)</Data></Cell>
                <Cell ss:StyleID="Header"><Data ss:Type="String">Corrente (A)</Data></Cell>
            </Row>${rowsXml}
            <Row>
                <Cell ss:StyleID="Total"><Data ss:Type="String">Total</Data></Cell>
                <Cell/><Cell/>
                <Cell ss:StyleID="Total"><Data ss:Type="Number">${totalW.toFixed(2)}</Data></Cell>
                ${divisor
                    ? `<Cell ss:StyleID="Total"><Data ss:Type="Number">${(totalW / divisor).toFixed(2)}</Data></Cell>`
                    : "<Cell/>"}
            </Row>
        </Table>
    </Worksheet>
</Workbook>`;

    const blob = new Blob([spreadsheetXml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = String(result.quadro || "quadro").replace(/[^\w-]+/g, "_");
    link.href = url;
    link.download = `quadro_${safeName}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}
