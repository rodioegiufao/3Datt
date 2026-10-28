import { createOccupancyLimitAnnotationsController } from "./viewer/features/annotations.js";

export function setupEletrodutoAssociationExportShortcut({ viewer, setSearchStatus, requestRenderFrame, focusObjectById } = {}) {
    if (!viewer) {
        return;
    }

    const occupancyLimitAnnotationsController = createOccupancyLimitAnnotationsController({
        viewer,
        requestRenderFrame,
        focusObjectById
    });

    document.addEventListener("keydown", async (event) => {
        const isShortcut = isEletrodutoShortcut(event);

        if (!isShortcut || event.repeat || isEditableTarget(event.target)) {
            return;
        }

        event.preventDefault();

        try {
            const shouldDownload = await requestEletrodutoDownloadConfirmation();
            if (!shouldDownload) {
                notify(setSearchStatus, "Download do relatório de s cancelado.", false);
                return;
            }

            const rows = collectEletrodutoRows(viewer);
            if (!rows.length) {
                notify(setSearchStatus, "Nenhum eletroduto com palavras-chave (0,6/1kV, 1,8KV, 450/750V, UTP-5e) foi encontrado para exportação.", true);
                return;
            }

            const rowsAboveOccupancyLimit = rows.filter((row) => Number(row?.occupancyRate) > 0.4);
            storeOccupancyAnnotationState(rowsAboveOccupancyLimit);
            occupancyLimitAnnotationsController.syncAnnotations(rowsAboveOccupancyLimit);
            const buildingLoadRows = collectBuildingLoadRows(viewer);
            const quadroAnnotationRows = collectQuadroAnnotationRows(viewer, buildingLoadRows);
            downloadRowsAsExcel(rows, quadroAnnotationRows, buildingLoadRows);
            notify(setSearchStatus, `Relatório gerado com ${rows.length} eletroduto(s) e ${buildingLoadRows.length} carga(s).`, false);
        } catch (error) {
            console.error("Falha ao exportar relatório de eletrodutos:", error);
            notify(setSearchStatus, "Não foi possível gerar o relatório de eletrodutos.", true);
        }
    });
}

function requestEletrodutoDownloadConfirmation() {
    return new Promise((resolve) => {
        const existingDialog = document.getElementById("eletroduto-download-confirmation");
        if (existingDialog) {
            existingDialog.remove();
        }

        const overlay = document.createElement("div");
        overlay.id = "eletroduto-download-confirmation";
        overlay.setAttribute("role", "dialog");
        overlay.setAttribute("aria-modal", "true");
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(7, 12, 25, 0.6);
            backdrop-filter: blur(2px);
            z-index: 10000;
            padding: 16px;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            width: min(420px, calc(100vw - 32px));
            background: rgba(20, 24, 39, 0.96);
            border: 1px solid rgba(148, 163, 184, 0.35);
            border-radius: 12px;
            box-shadow: 0 18px 44px rgba(0, 0, 0, 0.5);
            color: #f8fafc;
            padding: 20px;
            font-family: inherit;
        `;

        const title = document.createElement("h3");
        title.textContent = "Baixar análise completa";
        title.style.cssText = "margin: 0 0 10px; font-size: 1.05rem;";

        const message = document.createElement("p");
        message.textContent = "Deseja baixar uma análise completa dos eletrodutos?";
        message.style.cssText = "margin: 0; color: #dbe3f3; line-height: 1.45;";

        const actions = document.createElement("div");
        actions.style.cssText = "display: flex; gap: 10px; justify-content: flex-end; margin-top: 18px;";

        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancelar";
        cancelButton.style.cssText = `
            border: 1px solid rgba(148, 163, 184, 0.4);
            background: rgba(148, 163, 184, 0.18);
            color: #f8fafc;
            border-radius: 8px;
            padding: 8px 12px;
            cursor: pointer;
        `;

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.textContent = "Baixar";
        confirmButton.style.cssText = `
            border: 1px solid rgba(56, 189, 248, 0.45);
            background: linear-gradient(135deg, #2563eb, #0ea5e9);
            color: #f8fafc;
            border-radius: 8px;
            padding: 8px 12px;
            cursor: pointer;
            font-weight: 600;
        `;

        const closeDialog = (result) => {
            overlay.remove();
            document.removeEventListener("keydown", handleEscape);
            resolve(Boolean(result));
        };

        const handleEscape = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                closeDialog(false);
            }
        };

        cancelButton.addEventListener("click", () => closeDialog(false));
        confirmButton.addEventListener("click", () => closeDialog(true));
        overlay.addEventListener("click", (event) => {
            if (event.target === overlay) {
                closeDialog(false);
            }
        });

        document.addEventListener("keydown", handleEscape);

        actions.appendChild(cancelButton);
        actions.appendChild(confirmButton);
        panel.appendChild(title);
        panel.appendChild(message);
        panel.appendChild(actions);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        confirmButton.focus();
    });
}

function isEletrodutoShortcut(event) {
    const key = String(event?.key || "").toLowerCase();
    const code = String(event?.code || "").toLowerCase();

    return key === "8" ||
        code === "digit8" ||
        code === "numpad8";
}

function collectEletrodutoRows(viewer) {
    const metaObjects = Object.values(viewer?.metaScene?.metaObjects || {});
    const targetTypes = new Set(["ifccablecarriersegment", "ifcflowsegment"]);

    return metaObjects
        .filter((metaObject) => targetTypes.has(normalizeLabel(metaObject?.type)))
        .map((metaObject) => {
            const associatedItems = getAssociatedItemsText(metaObject);
            const infrastructureLength = getInfrastructureLength(metaObject);
            const {
                uniqueGauges,
                totalCableOccurrences,
                quantitiesByGauge
            } = extractCableGaugeQuantitiesByInfrastructureLength(associatedItems, infrastructureLength);
            const operatingVoltages = extractOperatingVoltages(associatedItems);
            const realCableQuantity = calculateRealCableQuantity(metaObject);
            const cableOccupancyAreaMm2 = calculateCableOccupancyAreaByEletroduto(associatedItems, infrastructureLength);
            const internalInfrastructureAreaMm2 = calculateInternalInfrastructureArea(metaObject, realCableQuantity);
            const occupancyRate = calculateOccupancyRate(cableOccupancyAreaMm2, internalInfrastructureAreaMm2);
            const { ifcCode, ifcName } = splitIfcCodeAndName(metaObject);
            const identificationClassOrType = getIdentificationElementClassOrType(metaObject);
            const isTubulacao = isTubulacaoType(identificationClassOrType);
            return {
                metaObjectId: metaObject?.id || "",
                sceneObjectId: metaObject?.sceneObjectId || metaObject?.id || "",
                ifcCode,
                ifcName,
                ifcType: String(metaObject?.type || "Sem tipo"),
                isTubulacao: isTubulacao ? "Sim" : "Não",
                associatedItems,
                cableGauges: uniqueGauges.join(" | "),
                cableGaugeCount: totalCableOccurrences,
                cableQuantitiesByGauge: quantitiesByGauge,
                realCableQuantity,
                operatingVoltages: operatingVoltages.join(" | "),
                cableOccupancyAreaMm2,
                internalInfrastructureAreaMm2,
                occupancyRate,
                status: associatedItems ? "OK" : "NÃO OK"
            };
        })
        .filter((row) => hasRequiredKeyword(row.associatedItems));
}

const REQUIRED_ASSOCIATED_ITEM_KEYWORDS = [
    "0,6/1kV",
    "1,8KV",
    "450/750V",
    "UTP-5e"
];

const CABLE_OUTER_DIAMETER_MM_BY_VOLTAGE_AND_GAUGE = {
    "0,6/1kv": {
        "1,5": 4.8,
        "2,5": 5.2,
        "4": 5.7,
        "6": 6.3,
        "10": 7.4,
        "16": 9,
        "25": 10.3,
        "35": 12.4,
        "50": 13.8,
        "70": 15.7,
        "95": 17.6,
        "120": 19.2,
        "150": 21.8,
        "185": 23.6,
        "240": 26.6,
        "300": 30.6
    },
    "450/750v": {
        "1,5": 2.9,
        "2,5": 3.5,
        "4": 4,
        "6": 4.6,
        "10": 5.9,
        "16": 7.5,
        "25": 8.6,
        "35": 10.6,
        "50": 12,
        "70": 13.7,
        "95": 15.8
    }
};

function hasRequiredKeyword(associatedItemsText) {
    const normalizedAssociatedItems = normalizeLabel(associatedItemsText);
    if (!normalizedAssociatedItems) {
        return false;
    }

    return REQUIRED_ASSOCIATED_ITEM_KEYWORDS.some((keyword) =>
        normalizedAssociatedItems.includes(normalizeLabel(keyword))
    );
}

function getAssociatedItemsText(metaObject) {
    const pset = getPropertySetByName(metaObject, "AltoQi_QiBuilder-Itens_Associados");
    if (!pset || !Array.isArray(pset.properties)) {
        return "";
    }

    const values = pset.properties
        .map((prop) => {
            const propName = String(prop?.name || prop?.id || "").trim();
            const propValue = formatIfcPropertyValue(prop?.value).trim();
            const combined = [propName, propValue].filter(Boolean).join(": ");
            return combined;
        })
        .filter(Boolean);

    return values.join(" | ");
}

function getIdentificationElementClassOrType(metaObject) {
    const identificationSetNames = [
        "Identificação_Elemento",
        "Identificacao_Elemento",
        "Identificação Elemento",
        "Identificacao Elemento"
    ];
    const propertySet = getPropertySetByNames(metaObject, identificationSetNames);
    if (!propertySet || !Array.isArray(propertySet.properties)) {
        return "";
    }

    const classeProperty = propertySet.properties.find((prop) => {
        const propName = normalizeLabel(prop?.name || prop?.id || "");
        return propName === "classe" || propName === "class";
    });

    if (classeProperty) {
        return normalizeLabel(formatIfcPropertyValue(classeProperty?.value));
    }

    const tipoProperty = propertySet.properties.find((prop) => {
        const propName = normalizeLabel(prop?.name || prop?.id || "");
        return propName === "tipo" || propName === "type";
    });

    return normalizeLabel(formatIfcPropertyValue(tipoProperty?.value));
}

const TUBULACAO_KEYWORDS = ["eletroduto", "perfilado", "eletrocalha"];
const INFRASTRUCTURE_ASSOCIATED_ITEM_PATTERNS = [
    "eletrocalha furada tipo u pre-galv. quen - eletrocalha perfurada tipo u",
    "eletroduto pvc flexivel - eletroduto leve",
    "perfilados perfurados - galvanizados a fogo",
    "sinapi - metros - eletroduto flexivel"
].map((pattern) => normalizeLabel(pattern));

function isTubulacaoType(identificationType) {
    const normalizedType = normalizeLabel(identificationType);
    if (!normalizedType) {
        return false;
    }

    return TUBULACAO_KEYWORDS.some((keyword) => normalizedType.includes(keyword));
}

function getPropertySetByName(metaObject, targetName) {
    if (!metaObject?.propertySets?.length) {
        return null;
    }

    const normalizedTarget = normalizeLabel(targetName);
    return (
        metaObject.propertySets.find((propertySet) => {
            const propertySetName = propertySet?.name || propertySet?.id || "";
            return normalizeLabel(propertySetName) === normalizedTarget;
        }) || null
    );
}

function getPropertySetByNames(metaObject, targetNames = []) {
    if (!Array.isArray(targetNames) || !targetNames.length) {
        return null;
    }

    for (const targetName of targetNames) {
        const propertySet = getPropertySetByName(metaObject, targetName);
        if (propertySet) {
            return propertySet;
        }
    }

    return null;
}

function getIndexedPropertySetsByPrefix(metaObject, targetPrefix) {
    if (!metaObject?.propertySets?.length) {
        return [];
    }

    const normalizedPrefix = normalizeLabel(targetPrefix);
    const escapedPrefix = normalizedPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const prefixPattern = new RegExp(`^${escapedPrefix}(\\d+)$`);

    return metaObject.propertySets
        .map((propertySet) => {
            const propertySetName = propertySet?.name || propertySet?.id || "";
            const match = normalizeLabel(propertySetName).match(prefixPattern);
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

function formatIfcPropertyValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => formatIfcPropertyValue(item)).filter(Boolean).join(", ");
    }

    if (typeof value === "object") {
        const candidates = [value.value, value.nominalValue, value.rawValue, value.label, value.name];
        for (const candidate of candidates) {
            const formatted = formatIfcPropertyValue(candidate);
            if (formatted) {
                return formatted;
            }
        }

        try {
            return JSON.stringify(value);
        } catch {
            return String(value);
        }
    }

    return String(value);
}

function normalizeLabel(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLowerCase();
}

function extractCableGauges(text) {
    const source = String(text || "");
    if (!source) {
        return [];
    }

    const matches = source.match(/\d+(?:[.,]\d+)?\s*mm(?:\^?2|²)/gi) || [];
    return matches.map((value) =>
        value
            .replace(/\s+/g, " ")
            .replace(/mm\^?2\b/gi, "mm²")
            .trim()
    );
}

function extractCableGaugeSummary(text) {
    const matches = extractCableGauges(text);
    const uniqueGauges = Array.from(new Set(matches));

    return {
        uniqueGauges,
        totalOccurrences: matches.length
   };
}

function extractCableGaugeQuantitiesByInfrastructureLength(associatedItemsText, infrastructureLength) {
    const source = String(associatedItemsText || "");
    if (!source) {
        return {
            uniqueGauges: [],
            totalCableOccurrences: 0,
            quantitiesByGauge: {}
        };
    }

    const quantitiesByGauge = {};
    const gaugeOrder = [];

    source
        .split("|")
        .map((chunk) => String(chunk || "").trim())
        .filter(Boolean)
        .forEach((chunk) => {
            const gauges = extractCableGauges(chunk);
            if (!gauges.length) {
                return;
            }

            const associatedLength = parseAssociatedLengthFromChunk(chunk);
            const cableQuantity = calculateCableQuantityByLength({
                associatedLength,
                infrastructureLength
            });

            gauges.forEach((gauge) => {
                if (!Object.prototype.hasOwnProperty.call(quantitiesByGauge, gauge)) {
                    quantitiesByGauge[gauge] = 0;
                    gaugeOrder.push(gauge);
                }
                quantitiesByGauge[gauge] += cableQuantity;
            });
        });

    const totalCableOccurrences = Object.values(quantitiesByGauge)
        .reduce((sum, quantity) => sum + quantity, 0);

    return {
        uniqueGauges: gaugeOrder,
        totalCableOccurrences,
        quantitiesByGauge
    };
}

function splitIfcCodeAndName(metaObject) {
    const rawName = String(metaObject?.name || "").trim();
    const fallbackName = String(metaObject?.name || metaObject?.id || "Sem nome");
    const explicitCode = getIfcCodeProperty(metaObject);

    if (explicitCode) {
        return {
            ifcCode: explicitCode,
            ifcName: rawName || fallbackName
        };
    }

    const match = rawName.match(/^(\d+(?:[.\-/]\d+)*)(?:\s*[-:|]\s*|\s+)(.+)$/);
    if (match) {
        return {
            ifcCode: match[1],
            ifcName: match[2].trim() || fallbackName
        };
    }

    return {
        ifcCode: String(metaObject?.id || "-"),
        ifcName: fallbackName
    };
}

function getIfcCodeProperty(metaObject) {
    const propertySets = Array.isArray(metaObject?.propertySets) ? metaObject.propertySets : [];
    for (const set of propertySets) {
        const props = Array.isArray(set?.properties) ? set.properties : [];
        for (const prop of props) {
            const propName = normalizeLabel(prop?.name || prop?.id || "");
            if (propName === "codigo" || propName === "code") {
                const value = formatIfcPropertyValue(prop?.value).trim();
                if (value) {
                    return value;
                }
            }
        }
    }

    return "";
}

function extractOperatingVoltages(text) {
    const normalizedText = normalizeLabel(text);
    if (!normalizedText) {
        return [];
    }

    return REQUIRED_ASSOCIATED_ITEM_KEYWORDS.filter((keyword) =>
        normalizedText.includes(normalizeLabel(keyword))
    );
}

function calculateCableOccupancyAreaByEletroduto(associatedItemsText, infrastructureLength) {
    const source = String(associatedItemsText || "");
    if (!source) {
        return 0;
    }

    const normalizedSource = normalizeLabel(source);
    const fallbackVoltageClass = getVoltageClassFromText(normalizedSource);
    const totalAreaByChunk = source
        .split("|")
        .map((chunk) => String(chunk || "").trim())
        .filter(Boolean)
        .reduce((sum, chunk) => {
            const chunkArea = calculateCableOccupancyAreaFromChunk({
                chunk,
                infrastructureLength,
                fallbackVoltageClass
            });
            return sum + chunkArea;
        }, 0);

    if (totalAreaByChunk > 0) {
        return roundToTwoDecimals(totalAreaByChunk);
    }

    if (!fallbackVoltageClass) {
        return 0;
    }

    const totalAreaByFallback = extractCableGauges(source).reduce((sum, gauge) => {
        const area = getCableAreaByGaugeAndVoltage(gauge, fallbackVoltageClass);
        return sum + area;
    }, 0);

    return roundToTwoDecimals(totalAreaByFallback);
}

function calculateInternalInfrastructureArea(metaObject, cableQuantity = 1) {
    const validCableQuantity = Number.isFinite(cableQuantity) && cableQuantity > 0
        ? cableQuantity
        : 1;
    const altoQiBuilderSet = getPropertySetByName(metaObject, "AltoQi_Builder");
    const internalDiameterProperty = findPropertyByNames(
        altoQiBuilderSet,
        ["Diâmetro interno", "Diametro interno", "Internal diameter"]
    );
    const internalDiameterValue = formatIfcPropertyValue(internalDiameterProperty?.value).trim();
    const internalDiameterMm = convertInternalDiameterToMillimeters({
        rawDiameterValue: internalDiameterValue,
        nominalDiameterValue: getNominalDiameterValue(altoQiBuilderSet)
    });

    if (Number.isFinite(internalDiameterMm) && internalDiameterMm > 0) {
        const internalAreaByCable = (Math.PI * internalDiameterMm * internalDiameterMm) / 4;
        return roundToTwoDecimals(internalAreaByCable * validCableQuantity);
    }

    const baseProperty = findPropertyByNames(altoQiBuilderSet, ["Base"]);
    const heightProperty = findPropertyByNames(altoQiBuilderSet, ["Altura", "Height"]);
    const baseCentimeters = parseLocalizedNumber(formatIfcPropertyValue(baseProperty?.value).trim());
    const heightCentimeters = parseLocalizedNumber(formatIfcPropertyValue(heightProperty?.value).trim());

    if (!Number.isFinite(baseCentimeters) || !Number.isFinite(heightCentimeters) || baseCentimeters <= 0 || heightCentimeters <= 0) {
        return 0;
    }

    const baseMillimeters = baseCentimeters * 10;
    const heightMillimeters = heightCentimeters * 10;
    return roundToTwoDecimals(baseMillimeters * heightMillimeters * validCableQuantity);
}

function getNominalDiameterValue(propertySet) {
    const nominalDiameterProperty = findPropertyByNames(
        propertySet,
        ["Diâmetro", "Diametro", "Nominal diameter"]
    );

    return formatIfcPropertyValue(nominalDiameterProperty?.value).trim();
}

function findPropertyByNames(propertySet, propertyNames = []) {
    if (!propertySet || !Array.isArray(propertySet.properties) || !propertyNames.length) {
        return null;
    }

    const normalizedPropertyNames = new Set(propertyNames.map((name) => normalizeLabel(name)));
    return propertySet.properties.find((property) =>
        normalizedPropertyNames.has(normalizeLabel(property?.name || property?.id || ""))
    ) || null;
}

function convertInternalDiameterToMillimeters({ rawDiameterValue, nominalDiameterValue }) {
    const normalizedRaw = normalizeLabel(rawDiameterValue);
    const numericDiameter = parseLocalizedNumber(rawDiameterValue);
    if (!Number.isFinite(numericDiameter)) {
        return 0;
    }

    if (normalizedRaw.includes("mm")) {
        return numericDiameter;
    }

    if (normalizedRaw.includes("cm")) {
        return numericDiameter * 10;
    }

    if (normalizedRaw.includes("\"") || normalizedRaw.includes("pol")) {
        return numericDiameter * 25.4;
    }

    if (normalizeLabel(nominalDiameterValue).includes("\"")) {
        return numericDiameter * 10;
    }

    if (numericDiameter > 50) {
        return numericDiameter;
    }

    return numericDiameter * 10;
}

function parseLocalizedNumber(value) {
    const source = String(value || "");
    const numericMatch = source.match(/-?\d+(?:[.,]\d+)?/);
    if (!numericMatch) {
        return Number.NaN;
    }

    const normalized = numericMatch[0].replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function calculateRealCableQuantity(metaObject) {
    const infrastructureLength = getInfrastructureLength(metaObject);
    if (!Number.isFinite(infrastructureLength) || infrastructureLength <= 0) {
        return 1;
    }

    const associatedItemsSet = getPropertySetByName(metaObject, "AltoQi_QiBuilder-Itens_Associados");
    if (!associatedItemsSet || !Array.isArray(associatedItemsSet.properties)) {
        return 1;
    }

    const validRatios = associatedItemsSet.properties
        .filter((property) => {
            const propertyName = normalizeLabel(property?.name || property?.id || "");
            return INFRASTRUCTURE_ASSOCIATED_ITEM_PATTERNS.some((pattern) => propertyName.includes(pattern));
        })
        .map((property) => parseLocalizedNumber(formatIfcPropertyValue(property?.value).trim()))
        .filter((value) => Number.isFinite(value) && value >= infrastructureLength)
        .map((associatedLength) => {
            if (Math.abs(associatedLength - infrastructureLength) < 1e-6) {
                return 1;
            }

            return associatedLength / infrastructureLength;
        });

    if (validRatios.length) {
        return roundToTwoDecimals(Math.max(...validRatios));
    }

    for (const property of associatedItemsSet.properties) {
        const propertyName = normalizeLabel(property?.name || property?.id || "");
        const hasTubulacaoKeyword = TUBULACAO_KEYWORDS.some((keyword) =>
            propertyName.includes(normalizeLabel(keyword))
        );

        if (!hasTubulacaoKeyword) {
            continue;
        }

        const associatedLength = parseLocalizedNumber(formatIfcPropertyValue(property?.value).trim());
        if (!Number.isFinite(associatedLength) || associatedLength <= infrastructureLength) {
            continue;
        }

        return roundToTwoDecimals(associatedLength / infrastructureLength);
    }

    return 1;
}

function getInfrastructureLength(metaObject) {
    const altoQiBuilderSet = getPropertySetByName(metaObject, "AltoQi_Builder");
    const lengthProperty = findPropertyByNames(
        altoQiBuilderSet,
        ["Comprimento", "Length"]
    );
    const parsedLength = parseLocalizedNumber(formatIfcPropertyValue(lengthProperty?.value).trim());
    return Number.isFinite(parsedLength) ? parsedLength : 0;
}

function hasLengthUnitInPropertyName(propertyName) {
    const normalizedName = normalizeLabel(propertyName);
    if (!normalizedName) {
        return false;
    }

    return /\bmetros?\b/.test(normalizedName) ||
        /\bmm\b/.test(normalizedName) ||
        /\bm\b/.test(normalizedName);
}

function calculateCableOccupancyAreaFromChunk({ chunk, infrastructureLength, fallbackVoltageClass = "" }) {
    const voltageClass = getVoltageClassFromText(chunk) || fallbackVoltageClass;
    if (!voltageClass) {
        return 0;
    }

    const associatedLength = parseAssociatedLengthFromChunk(chunk);
    const cableQuantity = calculateCableQuantityByLength({
        associatedLength,
        infrastructureLength
    });

    return extractCableGauges(chunk).reduce((sum, gauge) => {
        const cableArea = getCableAreaByGaugeAndVoltage(gauge, voltageClass);
        return sum + (cableArea * cableQuantity);
    }, 0);
}

function parseAssociatedLengthFromChunk(chunk) {
    const source = String(chunk || "");
    if (!source) {
        return Number.NaN;
    }

    const colonSections = source.split(":");
    if (colonSections.length > 1) {
        const trailingSection = colonSections[colonSections.length - 1];
        const parsedTrailing = parseLocalizedNumber(trailingSection);
        if (Number.isFinite(parsedTrailing)) {
            return parsedTrailing;
        }
    }

    const numericMatches = Array.from(source.matchAll(/-?\d+(?:[.,]\d+)?/g));
    if (!numericMatches.length) {
        return Number.NaN;
    }

    const lastNumericValue = numericMatches[numericMatches.length - 1]?.[0] || "";
    return parseLocalizedNumber(lastNumericValue);
}

function calculateCableQuantityByLength({ associatedLength, infrastructureLength, tolerance = 0.01 }) {
    if (!Number.isFinite(associatedLength) || associatedLength <= 0) {
        return 1;
    }

    if (!Number.isFinite(infrastructureLength) || infrastructureLength <= 0) {
        return 1;
    }

    const ratio = associatedLength / infrastructureLength;
    const nearestInteger = Math.round(ratio);
    if (nearestInteger >= 1 && Math.abs(ratio - nearestInteger) <= tolerance) {
        return nearestInteger;
    }

    return 1;
}

function getVoltageClassFromText(text) {
    const normalized = normalizeLabel(text);

    if (normalized.includes("0,6/1kv") || normalized.includes("0.6/1kv")) {
        return "0,6/1kv";
    }

    if (normalized.includes("450/750v")) {
        return "450/750v";
    }

    return "";
}

function getCableAreaByGaugeAndVoltage(gaugeLabel, voltageClass) {
    const normalizedGauge = normalizeGaugeKey(gaugeLabel);
    const outerDiameter = CABLE_OUTER_DIAMETER_MM_BY_VOLTAGE_AND_GAUGE?.[voltageClass]?.[normalizedGauge];
    if (!outerDiameter) {
        return 0;
    }

    return (Math.PI * outerDiameter * outerDiameter) / 4;
}

function normalizeGaugeKey(gaugeLabel) {
    const numericMatch = String(gaugeLabel || "").match(/\d+(?:[.,]\d+)?/);
    if (!numericMatch) {
        return "";
    }

    return numericMatch[0].replace(".", ",");
}

function roundToTwoDecimals(value) {
    return Number(value.toFixed(2));
}

function calculateOccupancyRate(cableOccupancyAreaMm2, internalInfrastructureAreaMm2) {
    if (!Number.isFinite(cableOccupancyAreaMm2) || cableOccupancyAreaMm2 <= 0) {
        return 0;
    }

    if (!Number.isFinite(internalInfrastructureAreaMm2) || internalInfrastructureAreaMm2 <= 0) {
        return 0;
    }

    return roundToFourDecimals(cableOccupancyAreaMm2 / internalInfrastructureAreaMm2);
}

function roundToFourDecimals(value) {
    return Number(value.toFixed(4));
}

function downloadRowsAsExcel(rows, quadroAnnotationRows = [], buildingLoadRows = []) {
    const excelRows = rows
        .map(
            (row) => `
        <Row ss:StyleID="${row.status === "OK" ? "OkRow" : "NotOkRow"}">
            <Cell><Data ss:Type="String">${escapeXml(row.ifcCode || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.ifcName)}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.ifcType)}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.isTubulacao)}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.associatedItems || "Sem itens associados")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.cableGauges || "-")}</Data></Cell>
            <Cell><Data ss:Type="Number">${row.cableGaugeCount || 0}</Data></Cell>
            <Cell><Data ss:Type="Number">${row.realCableQuantity || 0}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.operatingVoltages || "-")}</Data></Cell>
            <Cell><Data ss:Type="Number">${row.cableOccupancyAreaMm2 || 0}</Data></Cell>
            <Cell><Data ss:Type="Number">${row.internalInfrastructureAreaMm2 || 0}</Data></Cell>
            <Cell ss:StyleID="PercentageTwoDecimals"><Data ss:Type="Number">${row.occupancyRate || 0}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.status)}</Data></Cell>
        </Row>`
        )
        .join("");

    const quadroAnnotationExcelRows = quadroAnnotationRows
        .map(
            (row) => `
        <Row>
            <Cell><Data ss:Type="String">${escapeXml(row.id || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.modelo || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.nome || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.padraoProtecoes || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.esquema || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.tensao || "-")}</Data></Cell>
            <Cell><Data ss:Type="Number">${formatSpreadsheetNumber(row.cargaTotalW)}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.protecaoPeca || "-")}</Data></Cell>
            <Cell><Data ss:Type="Number">${row.espacosFaltantes || 0}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.tamanhoQuadro || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.dps || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.dr || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.barramentos || "-")}</Data></Cell>
        </Row>`
        )
        .join("");

    const visibleBuildingLoadRows = buildingLoadRows.filter((row) => formatSpreadsheetNumber(row.powerW) > 0);
    const buildingLoadExcelRows = visibleBuildingLoadRows
        .map(
            (row) => `
        <Row>
            <Cell><Data ss:Type="String">${escapeXml(row.id || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.pointName || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.circuito || "-")}</Data></Cell>
            <Cell><Data ss:Type="String">${escapeXml(row.quadro || "-")}</Data></Cell>
            <Cell><Data ss:Type="Number">${formatSpreadsheetNumber(row.powerW)}</Data></Cell>
            <Cell><Data ss:Type="Number">${formatSpreadsheetNumber(row.quantity)}</Data></Cell>
            <Cell><Data ss:Type="Number">${formatSpreadsheetNumber(row.totalPowerW)}</Data></Cell>
        </Row>`
        )
        .join("");

    const buildingLoadTotalPowerW = visibleBuildingLoadRows.reduce((sum, row) => sum + (Number(row.totalPowerW) || 0), 0);

    const spreadsheetXml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
    <Styles>
        <Style ss:ID="Header">
            <Font ss:Bold="1" />
            <Interior ss:Color="#D9E1F2" ss:Pattern="Solid" />
        </Style>
        <Style ss:ID="OkRow">
            <Interior ss:Color="#E2F0D9" ss:Pattern="Solid" />
        </Style>
        <Style ss:ID="NotOkRow">
            <Interior ss:Color="#FCE4D6" ss:Pattern="Solid" />
        </Style>
        <Style ss:ID="PercentageTwoDecimals">
            <NumberFormat ss:Format="0.00%" />
        </Style>
        <Style ss:ID="TotalRow">
            <Font ss:Bold="1" />
            <Interior ss:Color="#FFF2CC" ss:Pattern="Solid" />
        </Style>
    </Styles>
    <Worksheet ss:Name="Eletrodutos">
        <Table>
            <Row ss:StyleID="Header">
                <Cell><Data ss:Type="String">Código IFC</Data></Cell>
                <Cell><Data ss:Type="String">Nome IFC</Data></Cell>
                <Cell><Data ss:Type="String">Tipo IFC</Data></Cell>
                <Cell><Data ss:Type="String">Tubulação</Data></Cell>
                <Cell><Data ss:Type="String">AltoQi_QiBuilder-Itens_Associados</Data></Cell>
                <Cell><Data ss:Type="String">Bitola(s) dos cabos</Data></Cell>
                <Cell><Data ss:Type="String">Qtd. de ocorrências de bitola(s)</Data></Cell>
                <Cell><Data ss:Type="String">Qtd. de cabos</Data></Cell>
                <Cell><Data ss:Type="String">Tensão(ões) de trabalho</Data></Cell>
                <Cell><Data ss:Type="String">Área ocupada por cabos (mm²)</Data></Cell>
                <Cell><Data ss:Type="String">Área interna da infraestrutura (mm²)</Data></Cell>
                <Cell><Data ss:Type="String">Taxa de ocupação (%)</Data></Cell>
                <Cell><Data ss:Type="String">Status</Data></Cell>
            </Row>
            ${excelRows}
        </Table>
    </Worksheet>
    <Worksheet ss:Name="Anotacoes_Quadros">
        <Table>
            <Row ss:StyleID="Header">
                <Cell><Data ss:Type="String">ID</Data></Cell>
                <Cell><Data ss:Type="String">Modelo (XKT/IFC)</Data></Cell>
                <Cell><Data ss:Type="String">Nome</Data></Cell>
                <Cell><Data ss:Type="String">Padrão das proteções</Data></Cell>
                <Cell><Data ss:Type="String">Esquema</Data></Cell>
                <Cell><Data ss:Type="String">Tensão</Data></Cell>
                <Cell><Data ss:Type="String">Carga total (W)</Data></Cell>
                <Cell><Data ss:Type="String">Proteção - Peça</Data></Cell>
                <Cell><Data ss:Type="String">Espaço(s) faltante(s)</Data></Cell>
                <Cell><Data ss:Type="String">Tamanho do quadro</Data></Cell>
                <Cell><Data ss:Type="String">DPS</Data></Cell>
                <Cell><Data ss:Type="String">DR</Data></Cell>
                <Cell><Data ss:Type="String">Barramentos</Data></Cell>
            </Row>
            ${quadroAnnotationExcelRows}
        </Table>
    </Worksheet>
    <Worksheet ss:Name="Cargas_Predio">
        <Table>
            <Row ss:StyleID="Header">
                <Cell><Data ss:Type="String">ID</Data></Cell>
                <Cell><Data ss:Type="String">Ponto</Data></Cell>
                <Cell><Data ss:Type="String">Circuito</Data></Cell>
                <Cell><Data ss:Type="String">Quadro</Data></Cell>
                <Cell><Data ss:Type="String">Potência (W)</Data></Cell>
                <Cell><Data ss:Type="String">Quantidade</Data></Cell>
                <Cell><Data ss:Type="String">Carga total (W)</Data></Cell>
            </Row>
            ${buildingLoadExcelRows}
            <Row ss:StyleID="TotalRow">
                <Cell><Data ss:Type="String">TOTAL</Data></Cell>
                <Cell><Data ss:Type="String">-</Data></Cell>
                <Cell><Data ss:Type="String">-</Data></Cell>
                <Cell><Data ss:Type="String">-</Data></Cell>
                <Cell><Data ss:Type="String">-</Data></Cell>
                <Cell><Data ss:Type="String">-</Data></Cell>
                <Cell><Data ss:Type="Number">${formatSpreadsheetNumber(buildingLoadTotalPowerW)}</Data></Cell>
            </Row>
        </Table>
    </Worksheet>
</Workbook>`;

    const blob = new Blob([spreadsheetXml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    link.href = url;
    link.download = `eletrodutos_associados_${timestamp}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function collectBuildingLoadRows(viewer) {
    const metaObjects = Object.values(viewer?.metaScene?.metaObjects || {});

    return metaObjects.flatMap((metaObject) => {
        const pointSets = getIndexedPropertySetsByPrefix(metaObject, "AltoQi_Builder-Ponto");
        const circuitoSet = getPropertySetByName(metaObject, "Circuito");

        return pointSets
            .map(({ propertySet, name, index }) => {
                const powerW = getNumericPropertyValue(propertySet, ["Potência (W)", "Potencia (W)", "Potência", "Potencia"]);
                const quantity = getNumericPropertyValue(propertySet, ["Quantidade", "Quantity"]);
                const totalPowerW = Number.isFinite(powerW) && Number.isFinite(quantity)
                    ? roundToTwoDecimals(powerW * quantity)
                    : 0;

                return {
                    id: metaObject?.id || metaObject?.sceneObjectId || "-",
                    pointName: name || "-",
                    circuito: getTextPropertyValue(circuitoSet, [`Circuito_${index}`], "-"),
                    quadro: getTextPropertyValue(circuitoSet, [`Quadro_${index}`], "-"),
                    powerW: Number.isFinite(powerW) ? powerW : 0,
                    quantity: Number.isFinite(quantity) ? quantity : 0,
                    totalPowerW
                };
            });
    });
}

function getTextPropertyValue(propertySet, propertyNames = [], fallback = "") {
    const property = findPropertyByNames(propertySet, propertyNames);
    const value = formatIfcPropertyValue(property?.value).trim();
    return value || fallback;
}

function getNumericPropertyValue(propertySet, propertyNames = []) {
    const property = findPropertyByNames(propertySet, propertyNames);
    const value = parseLocalizedNumber(formatIfcPropertyValue(property?.value));
    return Number.isFinite(value) ? value : Number.NaN;
}

function formatSpreadsheetNumber(value) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function storeOccupancyAnnotationState(rowsAboveOccupancyLimit) {
    if (typeof window === "undefined") {
        return;
    }

    const rows = Array.isArray(rowsAboveOccupancyLimit) ? rowsAboveOccupancyLimit : [];
    window.annotationState = {
        ...(window.annotationState || {}),
        occupancy: rows
    };
    window.rowsComAnotacao = rows;
}

function collectQuadroAnnotationRows(viewer, buildingLoadRows = []) {
    const metaObjects = Object.values(viewer?.metaScene?.metaObjects || {});
    const buildingLoadTotalByQuadro = calculateBuildingLoadTotalByQuadro(buildingLoadRows);

    return metaObjects
        .filter((metaObject) => isQuadroAnnotationExportCandidate(metaObject))
        .map((metaObject) => {
            const nome = String(metaObject?.name || "").trim();
            const itensAssociados = getAssociatedItemsText(metaObject);
            const modelo = getMetaModelLabel(metaObject);
            const tamanhoQuadro = getNumeroPolos(metaObject);
            const disjuntores = countDisjuntores(metaObject, itensAssociados);
            const espacosFaltantes = Number.isFinite(tamanhoQuadro)
                ? Math.max(tamanhoQuadro - disjuntores, 0)
                : 0;
            return {
                id: metaObject?.id || metaObject?.sceneObjectId || "-",
                modelo,
                nome: nome || "-",
                padraoProtecoes: getAltoQiBuilderValue(metaObject, ["Padrão das proteções", "Padrao das protecoes"]),
                esquema: getAltoQiBuilderValue(metaObject, ["Esquema"]),
                tensao: getAltoQiBuilderValue(metaObject, ["Tensão", "Tensao"]),
                cargaTotalW: getBuildingLoadTotalForQuadro(buildingLoadTotalByQuadro, metaObject),
                protecaoPeca: getAltoQiBuilderValue(metaObject, ["Proteção - Peça", "Protecao - Peca"]),
                espacosFaltantes,
                tamanhoQuadro: Number.isFinite(tamanhoQuadro) ? `${tamanhoQuadro} polos` : "-",
                dps: hasKeywordInAssociatedItems(itensAssociados, "contra surto") ? "Tem DPS" : "Não tem DPS",
                dr: hasKeywordInAssociatedItems(itensAssociados, "interruptor") ? "Tem DR" : "Não tem DR",
                barramentos: getBarramentoAnnotation(metaObject)
            };
        });
}

function isQuadroAnnotationExportCandidate(metaObject) {
    const normalizedType = normalizeLabel(metaObject?.type);
    const isKnownQuadroType = ["ifcelectricdistributionboard", "ifcflowfitting"].includes(normalizedType);

    if (isKnownQuadroType && getPropertySetByName(metaObject, "Pset_ElectricalDeviceCommon-Ponto1")) {
        return true;
    }

    const isGenericProxy = normalizedType === "ifcbuildingelementproxy";
    const protecaoPeca = getAltoQiBuilderValue(metaObject, ["Proteção - Peça", "Protecao - Peca"]);
    return isGenericProxy && protecaoPeca !== "-";
}

function calculateBuildingLoadTotalByQuadro(buildingLoadRows = []) {
    return buildingLoadRows.reduce((totalsByQuadro, row) => {
        const quadroKey = normalizeQuadroReference(row?.quadro);
        const totalPowerW = formatSpreadsheetNumber(row?.totalPowerW);

        if (quadroKey && totalPowerW > 0) {
            totalsByQuadro.set(quadroKey, (totalsByQuadro.get(quadroKey) || 0) + totalPowerW);
        }

        return totalsByQuadro;
    }, new Map());
}

function getBuildingLoadTotalForQuadro(buildingLoadTotalByQuadro, metaObject) {
    const keys = [
        metaObject?.name,
        getAltoQiBuilderValue(metaObject, ["Quadro"]),
        metaObject?.id,
        metaObject?.sceneObjectId
    ].map(normalizeQuadroReference).filter(Boolean);

    const matchingKey = keys.find((key) => buildingLoadTotalByQuadro.has(key));
    if (!matchingKey) {
        return 0;
    }

    return roundToTwoDecimals(buildingLoadTotalByQuadro.get(matchingKey) || 0);
}

function normalizeQuadroReference(value) {
    const normalized = normalizeLabel(value)
        .replace(/\s+/g, " ")
        .replace(/\s*[-–—:]\s*/g, "-")
        .trim();

    return normalized === "-" ? "" : normalized;
}
function getAltoQiBuilderValue(metaObject, names = []) {
    const altoQiBuilderSet = getPropertySetByName(metaObject, "AltoQi_Builder");
    const property = findPropertyByNames(altoQiBuilderSet, names);
    const value = formatIfcPropertyValue(property?.value).trim();
    return value || "-";
}

function getNumeroPolos(metaObject) {
    const altoQiBuilderSet = getPropertySetByName(metaObject, "AltoQi_Builder");
    const numeroPolosProperty = findPropertyByNames(altoQiBuilderSet, ["Número de polos", "Numero de polos"]);
    const numeroPolos = parseLocalizedNumber(formatIfcPropertyValue(numeroPolosProperty?.value));
    return Number.isFinite(numeroPolos) ? numeroPolos : null;
}

function countDisjuntores(metaObject, fallbackText = "") {
    const usedPoles = getQuadroUsedPolesFromAssociatedItems(metaObject);
    if (Number.isFinite(usedPoles)) {
        return usedPoles;
    }

    const normalized = normalizeLabel(fallbackText);
    if (!normalized) {
        return 0;
    }

    const matches = normalized.match(/disjuntor|interruptor|unipolar|bipolar|tripolar|tetrapolar/g);
    return Array.isArray(matches) ? matches.length : 0;
}

function getQuadroUsedPolesFromAssociatedItems(metaObject) {
    const itensAssociadosSet = getPropertySetByName(metaObject, "AltoQi_QiBuilder-Itens_Associados");
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
        const normalizedText = normalizeLabel(text);
        const matched = keywordMultipliers.find(({ keyword }) => normalizedText.includes(keyword));
        return matched ? matched.multiplier : null;
    };

    const extractQuantityFromText = (text) => {
        const match = String(text || "").match(/(\d+(?:[.,]\d+)?)/);
        if (!match) {
            return null;
        }
        return parseLocalizedNumber(match[1]);
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

        const normalizedPropName = normalizeLabel(propName);
        const isQuantityField =
            normalizedPropName.includes("qtd") ||
            normalizedPropName.includes("qtde") ||
            normalizedPropName.includes("quant");

        if (isQuantityField) {
            const parsedQuantity = parseLocalizedNumber(formatIfcPropertyValue(prop?.value));
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

        const quantity =
            parseLocalizedNumber(formatIfcPropertyValue(prop?.value)) ||
            extractQuantityFromText(combinedText) ||
            1;
        return total + (quantity * multiplier);
    }, 0);

    if (fallbackTotal > 0) {
        return fallbackTotal;
    }

    return 0;
}

function hasKeywordInAssociatedItems(text, keyword) {
    return normalizeLabel(text).includes(normalizeLabel(keyword));
}

function getBarramentoAnnotation(metaObject) {
    const pontoSet = getPropertySetByName(metaObject, "Pset_ElectricalDeviceCommon-Ponto1");
    const identificacaoSet = getPropertySetByName(metaObject, "Identificação_Elemento");
    const nominalCurrentProperty = findPropertyByNames(pontoSet, ["NominalCurrent"]);
    const nomeProperty = findPropertyByNames(identificacaoSet, ["Nome"]);
    const nominalCurrent = parseLocalizedNumber(formatIfcPropertyValue(nominalCurrentProperty?.value));
    const nome = formatIfcPropertyValue(nomeProperty?.value);

    if (!Number.isFinite(nominalCurrent)) {
        return "-";
    }
    if (nominalCurrent <= 100) {
        return "Correto";
    }
    const capacidadeBarramento = extractBusbarCapacityFromName(nome);
    if (!Number.isFinite(capacidadeBarramento)) {
        return "-";
    }
    return nominalCurrent > capacidadeBarramento ? "Errado" : "Correto";
}

function getMetaModelLabel(metaObject) {
    const directLabel = [
        metaObject?.metaModel?.name,
        metaObject?.metaModel?.id,
        metaObject?.modelId,
        metaObject?.metaModelId
    ].find((value) => String(value || "").trim());

    if (directLabel) {
        return String(directLabel).trim();
    }

    const sourceMetaObject = metaObject?.metaScene?.metaObjects?.[metaObject?.sceneObjectId];
    const sourceLabel = [
        sourceMetaObject?.metaModel?.name,
        sourceMetaObject?.metaModel?.id,
        sourceMetaObject?.modelId,
        sourceMetaObject?.metaModelId
    ].find((value) => String(value || "").trim());

    return sourceLabel ? String(sourceLabel).trim() : "-";
}

function extractBusbarCapacityFromName(nameText) {
    const text = String(nameText || "");
    if (!text) {
        return null;
    }
    const inBarramentoMatch = text.match(/(?:in|i)\s*barr\.?\s*(\d+(?:[.,]\d+)?)/i);
    if (inBarramentoMatch) {
        return parseLocalizedNumber(inBarramentoMatch[1]);
    }
    const barramentoMatch = text.match(/barr(?:amento)?[^0-9]*(\d+(?:[.,]\d+)?)/i);
    if (barramentoMatch) {
        return parseLocalizedNumber(barramentoMatch[1]);
    }
    return null;
}

function escapeXml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function isEditableTarget(target) {
    return target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
}

function notify(setSearchStatus, message, isError) {
    if (typeof setSearchStatus === "function") {
        setSearchStatus(message, Boolean(isError));
        return;
    }

    if (isError) {
        console.warn(message);
    } else {
        console.info(message);
    }
}
