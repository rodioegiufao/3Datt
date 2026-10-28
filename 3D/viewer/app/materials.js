// Módulo "materials" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { CAIXA_GORDURA_VALOR_MATERIAL_MAP, activeMaterialFilter, activeWebBudgetSelection, clearMaterialIsolation, generateMaterialsButton, materialsResultsList, materialsSearchInput, materialsSummary, renderMaterialsResults, viewer } from "../viewer-authenticated.js";
import { materialsFeatureAllowed } from "./access.js";
import { getMetaObjectPropertySetByName } from "./electrical-schedules.js";
import { loadAssociaUnitsFromExcel } from "./excel.js";
import { formatIfcPropertyValue, getMetaObjectPropertyValue, normalizeIfcPropertyKey, resolveMetaObject, resolveSceneObjectId } from "./ifc-meta.js";
import { requestRenderFrame } from "./performance.js";
import { ensureBudgetAssociationsLoaded, getAssociatedMaterialsByBudgetReference } from "./project-budget.js";
import { getAllObjectIds, getObjectMetaModelId, mergeAABBs } from "./scene-objects.js";
import { toArraySafe } from "./snapshots.js";
import { modelIsolateController } from "./treeview-section.js";

export let explicitLinearMaterials = new Set();
export let explicitLinearMaterialsLoadPromise = null;
export let materialsGenerationPromise = null;
export let materialsAllResults = [];
export let materialsSearchQuery = "";

export function buildIfcPropertiesLines(doc, objectId, maxWidth) {
    const metaObject = resolveMetaObject(objectId);
    if (!metaObject) {
        return ["Propriedades IFC: metadados não encontrados para este objeto."];
    }

    const { propertySets } = metaObject;
    if (!propertySets?.length) {
        return ["Propriedades IFC: nenhum conjunto de propriedades disponível."];
    }

    const lines = ["Propriedades IFC:"];

    propertySets.forEach((pset) => {
        const setName = pset.name || pset.id || "Conjunto sem nome";
        lines.push(`- ${setName}`);

        if (pset.properties?.length) {
            pset.properties.forEach((prop) => {
                const key = prop.name || prop.id || "Propriedade";
                const value = formatIfcPropertyValue(prop.value);
                const propertyText = `  • ${key}: ${value}`;
                const wrappedLines = doc.splitTextToSize(propertyText, maxWidth);
                lines.push(...wrappedLines);
            });
        } else {
            lines.push("  • Nenhuma propriedade listada.");
        }
    });

    return lines;
}

export function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}

export function parseIfcMeasureLiteral(value) {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    const match = normalized.match(/^([A-Z0-9_]+)\s*\(([-+]?\d+(?:[.,]\d+)?)\)$/i);
    if (!match) {
        return null;
    }

    const parsedValue = Number.parseFloat(match[2].replace(",", "."));
    if (!Number.isFinite(parsedValue)) {
        return null;
    }

    return {
        type: match[1].toUpperCase(),
        value: parsedValue
    };
}

export function extractNumericPropertyValue(value) {
    if (isFiniteNumber(value)) {
        return value;
    }

    if (typeof value === "string") {
        const parsedMeasure = parseIfcMeasureLiteral(value);
        if (parsedMeasure) {
            return parsedMeasure.value;
        }

        const normalized = value.replace(",", ".").trim();
        const parsed = Number.parseFloat(normalized);
        if (Number.isFinite(parsed)) {
            return parsed;
        }

        const firstNumberMatch = normalized.match(/[-+]?\d+(?:\.\d+)?/);
        if (firstNumberMatch) {
            const firstNumber = Number.parseFloat(firstNumberMatch[0]);
            if (Number.isFinite(firstNumber)) {
                return firstNumber;
            }
        }

        return null;
    }

    if (value && typeof value === "object") {
        const candidates = [value.value, value.amount, value.nominalValue, value.rawValue];
        for (const candidate of candidates) {
            if (isFiniteNumber(candidate)) {
                return candidate;
            }
            if (typeof candidate === "string") {
                const parsedMeasure = parseIfcMeasureLiteral(candidate);
                if (parsedMeasure) {
                    return parsedMeasure.value;
                }

                const parsed = Number.parseFloat(candidate.replace(",", ".").trim());
                if (Number.isFinite(parsed)) {
                    return parsed;
                }
            }
        }
    }

    return null;
}

export function isIfcLengthMeasure(value) {
    if (!value) {
        return false;
    }

    if (typeof value === "string") {
        const parsedMeasure = parseIfcMeasureLiteral(value);
        return parsedMeasure ? parsedMeasure.type === "IFCLENGTHMEASURE" : value.toUpperCase().includes("IFCLENGTHMEASURE");
    }

    if (typeof value === "object") {
        const nestedValues = [value.value, value.amount, value.nominalValue, value.rawValue];
        for (const nestedValue of nestedValues) {
            if (typeof nestedValue === "string") {
                const parsedMeasure = parseIfcMeasureLiteral(nestedValue);
                if (parsedMeasure?.type === "IFCLENGTHMEASURE") {
                    return true;
                }
            }
        }

        const typeCandidates = [value.type, value.valueType, value.dataType, value.constructor?.name];
        return typeCandidates.some((candidate) =>
            typeof candidate === "string" && candidate.toUpperCase().includes("IFCLENGTHMEASURE")
        );
    }

    return false;
}

export function normalizeMaterialDescription(value) {
    return (value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
}

export function loadExplicitLinearMaterialsFromExcel() {
    if (explicitLinearMaterialsLoadPromise) {
        return explicitLinearMaterialsLoadPromise;
    }

    const currentLoadPromise = (async () => {
        const associaRows = await loadAssociaUnitsFromExcel({ excelPath: "./base_de_dados.xlsx" });
        const linearDescriptions = associaRows
            .filter((row) => String(row.unidade || "").trim().toLowerCase() === "m")
            .map((row) => normalizeMaterialDescription(row.descricao));
        explicitLinearMaterials = new Set(linearDescriptions);
    })();
    explicitLinearMaterialsLoadPromise = currentLoadPromise;

    return currentLoadPromise.catch((error) => {
        // Uma falha não deve bloquear o visualizador nem impedir uma nova tentativa futura.
        if (explicitLinearMaterialsLoadPromise === currentLoadPromise) {
            explicitLinearMaterialsLoadPromise = null;
        }
        console.warn("Não foi possível carregar as unidades do Excel.", error);
    });
}

export async function ensureMaterialsClassificationReady() {
    await loadExplicitLinearMaterialsFromExcel();
}

export function normalizeQuantityByIfcType(prop, numericValue) {
    if (numericValue === null) {
        return { quantity: null, unitLabel: "item(ns)" };
    }

    const normalizedName = normalizeMaterialDescription(prop?.name || prop?.id || "");

    const compactName = normalizedName.replace(/[^a-z0-9]/g, "");

    const linearMaterialKeywords = ["utp"];

    const linearMaterialCompactKeywords = ["cfoi"];

    const isLinearMaterial = linearMaterialKeywords
        .some((keyword) => normalizedName.includes(keyword));

    const isStructuredCableCategory = linearMaterialCompactKeywords
        .some((keyword) => compactName.includes(keyword));

    const isExplicitLinearMaterial = explicitLinearMaterials.has(normalizedName);

    if (isIfcLengthMeasure(prop?.value) || isLinearMaterial || isStructuredCableCategory || isExplicitLinearMaterial) {
        return {
            quantity: numericValue / 100, // converte de cm para metros
            unitLabel: "metro(s)"
        };
    }

    return {
        quantity: numericValue,
        unitLabel: "item(ns)"
    };
}

export function formatMaterialQuantity(quantity) {
    if (!Number.isFinite(quantity)) {
        return "0";
    }

    if (Math.abs(quantity - Math.round(quantity)) < 1e-9) {
        return String(Math.round(quantity));
    }

    return quantity.toFixed(2).replace(/\.00$/, "");
}

export function normalizeMaterialName(name) {
    return (name || "").trim().toLowerCase();
}

export function normalizeNumericComparisonValue(value) {
    const normalized = String(value ?? "")
        .trim()
        .replace(",", ".");
    const parsed = Number.parseFloat(normalized);
    if (!Number.isFinite(parsed)) {
        return "";
    }

    return parsed.toFixed(6);
}

export function getUnidadeTratamentoConcretoValue(metaObject) {
    if (!metaObject?.propertySets?.length) {
        return "";
    }

    const targetPropNames = [
        "unidades de tratamento - concreto - concreto",
        "unidades de tratamento- concreto - concreto",
        "unidades de tratamento - concreto- concreto",
        "concreto - concreto"
    ].map((name) => normalizeIfcPropertyKey(name));

    for (const pset of metaObject.propertySets) {
        for (const prop of pset.properties || []) {
            const propName = normalizeIfcPropertyKey(prop?.name || prop?.id || "");
            if (!targetPropNames.includes(propName)) {
                continue;
            }

            const normalizedValue = normalizeNumericComparisonValue(formatIfcPropertyValue(prop?.value));
            if (normalizedValue) {
                return normalizedValue;
            }
        }
    }

    return "";
}

export function getAltoQiBuilderPropertyValue(metaObject, propertyNames = []) {
    const altoQiBuilderSet = getMetaObjectPropertySetByName(metaObject, "AltoQi_Builder");
    if (!altoQiBuilderSet || !Array.isArray(altoQiBuilderSet.properties)) {
        return "";
    }

    const normalizedPropertyNames = propertyNames.map((name) => normalizeIfcPropertyKey(name));
    const matchedProperty = altoQiBuilderSet.properties.find((prop) => {
        const propName = String(prop?.name || prop?.id || "");
        return normalizedPropertyNames.includes(normalizeIfcPropertyKey(propName));
    });

    if (!matchedProperty) {
        return "";
    }

    return normalizeSearchText(formatIfcPropertyValue(matchedProperty.value));
}

export function getAltoQiBuilderTipoCaixa(metaObject) {
    return getAltoQiBuilderPropertyValue(metaObject, ["Tipo de caixa"]);
}

export function isEsgotoNetworkObject(metaObject) {
    const network = normalizeSearchText(getMetaObjectPropertyValue(metaObject, ["Rede", "Network"]));
    return network === "esgoto";
}

export function resolveCaixaGorduraMaterialName(metaObject, rawMaterialName) {
    const normalizedMaterialName = normalizeMaterialName(rawMaterialName);
    if (normalizedMaterialName !== "cgd") {
        return rawMaterialName;
    }

    if (!isEsgotoNetworkObject(metaObject)) {
        return rawMaterialName;
    }

    const concretoValue = getUnidadeTratamentoConcretoValue(metaObject);
    return CAIXA_GORDURA_VALOR_MATERIAL_MAP[concretoValue] || rawMaterialName;
}

export function normalizeMaterialComparisonText(value) {
    return normalizeSearchText(value).replace(/\s+/g, " ").trim();
}

export function normalizeMaterialCompactText(value) {
    return normalizeMaterialComparisonText(value).replace(/[^a-z0-9]/g, "");
}

export function materialNamesMatch(referenceName, candidateName) {
    const normalizedReference = normalizeMaterialComparisonText(referenceName);
    const normalizedCandidate = normalizeMaterialComparisonText(candidateName);

    if (!normalizedReference || !normalizedCandidate) {
        return false;
    }

    if (normalizedReference === normalizedCandidate) {
        return true;
    }

    const compactReference = normalizeMaterialCompactText(normalizedReference);
    const compactCandidate = normalizeMaterialCompactText(normalizedCandidate);

    if (compactReference && compactReference === compactCandidate) {
        return true;
    }

    if (compactReference.length >= 10 && compactCandidate.includes(compactReference)) {
        return true;
    }

    if (compactCandidate.length >= 10 && compactReference.includes(compactCandidate)) {
        return true;
    }

    return false;
}

export function normalizeSearchText(value) {
    return (value || "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}

export function isMaterialPropertySet(pset) {
    const normalizedSetName = normalizeSearchText(pset?.name || pset?.id || "");
    if (!normalizedSetName) {
        return false;
    }

    return [
        "itens_associados",
        "itens associados",
        "associated items",
        "materiais",
        "materials",
        "material"
    ].some((token) => normalizedSetName.includes(token));
}

export function normalizeMaterialToken(value) {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string") {
        return normalizeMaterialName(value);
    }

    if (typeof value === "object") {
        const candidates = [value.value, value.amount, value.nominalValue, value.rawValue, value.label, value.name];
        for (const candidate of candidates) {
            if (typeof candidate === "string") {
                return normalizeMaterialName(candidate);
            }
        }
    }

    return "";
}

// ---- Lista de materiais com corte ativo — NOVO
/** Planos de corte ativos (o xeokit esconde o ponto P quando dot(−dir, P − pos) > 0). */
// Todos os cortes ativos: plano horizontal e as seis faces da caixa de corte
export function getActiveSectionPlanes() {
    return Object.values(viewer.scene?.sectionPlanes || {})
        .filter((plane) => plane && typeof plane === "object" && plane.active && plane.pos && plane.dir);
}

/**
 * Quanto do objeto fica à vista com os cortes ativos, pela caixa envolvente:
 * 0 = cortado por inteiro, 1 = inteiro à vista, entre 0 e 1 = atravessado pelo plano.
 */
export function getSectionVisibleFraction(objectId, planes = getActiveSectionPlanes()) {
    if (!planes.length) {
        return 1;
    }
    const entity = viewer.scene.objects?.[objectId] || viewer.scene.objects?.[resolveSceneObjectId(objectId)];
    if (!entity?.aabb || entity.clippable === false) {
        return 1;
    }
    const a = entity.aabb;
    let fraction = 1;
    for (const plane of planes) {
        const pos = plane.pos, dir = plane.dir;
        let min = Infinity, max = -Infinity;
        for (const x of [a[0], a[3]]) {
            for (const y of [a[1], a[4]]) {
                for (const z of [a[2], a[5]]) {
                    // > 0: lado escondido pelo corte
                    const d = -(dir[0] * (x - pos[0]) + dir[1] * (y - pos[1]) + dir[2] * (z - pos[2]));
                    if (d < min) min = d;
                    if (d > max) max = d;
                }
            }
        }
        if (min > 0) {
            return 0;               // todo do lado cortado
        }
        if (max > 0) {
            fraction *= max - min > 1e-9 ? -min / (max - min) : 1;   // atravessado: parte à vista
        }
    }
    return Math.max(0, Math.min(1, fraction));
}

export function getActiveObjectIdSet() {
    const scene = viewer?.scene;
    const visibleIds = toArraySafe(scene?.visibleObjectIds);
    const ids = visibleIds.length ? visibleIds : getAllObjectIds();
    // NOVO: com o corte ativo, tira o que ficou inteiro do lado cortado
    const planes = getActiveSectionPlanes();
    if (!planes.length) {
        return new Set(ids);
    }
    return new Set(ids.filter((id) => getSectionVisibleFraction(id, planes) > 0));
}

export function findMaterialObjectIds(materialName, { activeOnly = true } = {}) {
    const targetName = normalizeMaterialName(materialName);
    if (!targetName) {
        return [];
    }

    const allMetaObjects = viewer.metaScene?.metaObjects || {};
    const ids = [];
    const activeIds = activeOnly ? getActiveObjectIdSet() : null;

    for (const metaObject of Object.values(allMetaObjects)) {
        if (activeIds && metaObject?.id && !activeIds.has(metaObject.id)) {
            continue;
        }
        const propertySets = metaObject?.propertySets;
        if (!Array.isArray(propertySets)) {
            continue;
        }

        let hasMaterial = false;
        for (const pset of propertySets) {
            if (!Array.isArray(pset?.properties)) {
                continue;
            }

            if (!isMaterialPropertySet(pset)) {
                continue;
            }


            for (const prop of pset.properties) {
                const name = (prop?.name || prop?.id || "").trim();
                if (!name) {
                    continue;
                }

                const normalizedValue = normalizeMaterialToken(prop?.value);
                const resolvedName = resolveCaixaGorduraMaterialName(metaObject, name);
                const resolvedValue = resolveCaixaGorduraMaterialName(metaObject, normalizedValue);

                if (
                    materialNamesMatch(targetName, name) ||
                    materialNamesMatch(targetName, normalizedValue) ||
                    materialNamesMatch(targetName, resolvedName) ||
                    materialNamesMatch(targetName, resolvedValue)
                ) {
                    hasMaterial = true;
                    break;
                }
            }

            if (hasMaterial) {
                break;
            }
        }

        if (hasMaterial && metaObject.id) {
            ids.push(metaObject.id);
        }
    }

    return ids;
}

export function updateMaterialsActiveItem() {
    if (!materialsResultsList) {
        return;
    }

    Array.from(materialsResultsList.children).forEach((item) => {
        if (!(item instanceof HTMLElement)) {
            return;
        }

        const itemName = item.dataset.materialName;
        item.classList.toggle("is-active", Boolean(activeMaterialFilter && itemName === activeMaterialFilter));
    });
}

export function isolateMaterialByName(materialName) {
    if (!modelIsolateController) {
        return;
    }

    const idsToFocus = findMaterialObjectIds(materialName);
    if (!idsToFocus.length) {
        return;
    }

    const allIds = getAllObjectIds();
    const otherIds = allIds.filter((id) => !idsToFocus.includes(id));

    modelIsolateController.setObjectsVisible(allIds, true);
    modelIsolateController.setObjectsXRayed(allIds, true);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    modelIsolateController.setObjectsVisible(idsToFocus, true);
    modelIsolateController.setObjectsXRayed(idsToFocus, false);
    viewer.scene.setObjectsHighlighted(idsToFocus, true);

    if (otherIds.length) {
        modelIsolateController.setObjectsHighlighted(otherIds, false);
    }

    const combinedAABB = mergeAABBs(idsToFocus.map((id) => viewer.scene.getAABB(id)));
    if (combinedAABB) {
        viewer.cameraFlight.flyTo({ aabb: combinedAABB, duration: 0.6 });
    }

    requestRenderFrame();
}

export function isolateMaterialsByNames(materialNames, { modelId = null } = {}) {
    if (!Array.isArray(materialNames) || !materialNames.length) {
        return;
    }

    const idsToFocus = Array.from(new Set(materialNames
        .flatMap((materialName) => findMaterialObjectIds(materialName, { activeOnly: false }))
        .filter((id) => !modelId || getObjectMetaModelId(id) === modelId)));
    if (!idsToFocus.length) {
        return;
    }

    const allIds = getAllObjectIds();
    const otherIds = allIds.filter((id) => !idsToFocus.includes(id));

    modelIsolateController.setObjectsVisible(allIds, true);
    modelIsolateController.setObjectsXRayed(allIds, true);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    modelIsolateController.setObjectsVisible(idsToFocus, true);
    modelIsolateController.setObjectsXRayed(idsToFocus, false);
    viewer.scene.setObjectsHighlighted(idsToFocus, true);

    if (otherIds.length) {
        modelIsolateController.setObjectsHighlighted(otherIds, false);
    }

    const combinedAABB = mergeAABBs(idsToFocus.map((id) => viewer.scene.getAABB(id)));
    if (combinedAABB) {
        viewer.cameraFlight.flyTo({ aabb: combinedAABB, duration: 0.6 });
    }

    requestRenderFrame();
}

export function isolateAssociatedItemsByName(materialName) {
    if (!modelIsolateController) {
        return;
    }

    const idsToFocus = findMaterialObjectIds(materialName);
    if (!idsToFocus.length) {
        return;
    }

    const allIds = getAllObjectIds();
    const otherIds = allIds.filter((id) => !idsToFocus.includes(id));

    modelIsolateController.setObjectsVisible(allIds, false);
    modelIsolateController.setObjectsXRayed(allIds, false);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    modelIsolateController.setObjectsVisible(idsToFocus, true);
    modelIsolateController.setObjectsHighlighted(idsToFocus, true);

    if (otherIds.length) {
        modelIsolateController.setObjectsHighlighted(otherIds, false);
    }

    const combinedAABB = mergeAABBs(idsToFocus.map((id) => viewer.scene.getAABB(id)));
    if (combinedAABB) {
        viewer.cameraFlight.flyTo({ aabb: combinedAABB, duration: 0.6 });
    }

    requestRenderFrame();
}

export function isolateAssociatedItemsByNames(materialNames, { modelId = null } = {}) {
    if (!modelIsolateController || !Array.isArray(materialNames) || !materialNames.length) {
        return false;
    }

    const idsToFocus = Array.from(new Set(materialNames
        .flatMap((materialName) => findMaterialObjectIds(materialName, { activeOnly: false }))
        .filter((id) => !modelId || getObjectMetaModelId(id) === modelId)));

    if (!idsToFocus.length) {
        return false;
    }

    const allIds = getAllObjectIds();
    const otherIds = allIds.filter((id) => !idsToFocus.includes(id));

    modelIsolateController.setObjectsVisible(allIds, false);
    modelIsolateController.setObjectsXRayed(allIds, false);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    modelIsolateController.setObjectsVisible(idsToFocus, true);
    modelIsolateController.setObjectsHighlighted(idsToFocus, true);

    if (otherIds.length) {
        modelIsolateController.setObjectsHighlighted(otherIds, false);
    }

    const combinedAABB = mergeAABBs(idsToFocus.map((id) => viewer.scene.getAABB(id)));
    if (combinedAABB) {
        viewer.cameraFlight.flyTo({ aabb: combinedAABB, duration: 0.6 });
    }

    requestRenderFrame();
    return true;
}

export function isolateActiveWebBudgetSelection() {
    if (!materialsFeatureAllowed || !activeWebBudgetSelection) {
        return false;
    }

    return isolateAssociatedItemsByNames(activeWebBudgetSelection.materialNames, {
        modelId: activeWebBudgetSelection.modelId
    });
}

export function collectQuantitativeMaterials() {
    if (!materialsFeatureAllowed) {
        return [];
    }
    const totals = new Map();
    const allMetaObjects = viewer.metaScene?.metaObjects || {};
    const activeIds = getActiveObjectIdSet();
    const sectionPlanes = getActiveSectionPlanes();

    for (const metaObject of Object.values(allMetaObjects)) {
        if (metaObject?.id && !activeIds.has(metaObject.id)) {
            continue;
        }
        const propertySets = metaObject?.propertySets;
        if (!Array.isArray(propertySets)) {
            continue;
        }

        for (const pset of propertySets) {
            if (!Array.isArray(pset?.properties)) {
                continue;
            }

            if (!isMaterialPropertySet(pset)) {
                continue;
            }

            for (const prop of pset.properties) {
                const rawName = (prop?.name || prop?.id || "").trim();
                if (!rawName) {
                    continue;
                }

                const numericValue = extractNumericPropertyValue(prop?.value);
                const normalized = normalizeQuantityByIfcType(prop, numericValue);
                const name = resolveCaixaGorduraMaterialName(metaObject, rawName);

                if (normalized.quantity === null) {
                    continue;
                }

                if (normalized.quantity <= 0) {
                    continue;
                }

                // NOVO: peça atravessada pelo corte — comprimentos entram só pela parte à vista
                if (sectionPlanes.length && normalized.unitLabel === "metro(s)") {
                    const fraction = getSectionVisibleFraction(metaObject.id, sectionPlanes);
                    if (fraction <= 0) {
                        continue;
                    }
                    normalized.quantity *= fraction;
                }

                const aggregationKey = `${name}__${normalized.unitLabel}`;
                const current = totals.get(aggregationKey) || {
                    name,
                    quantity: 0,
                    unitLabel: normalized.unitLabel,
                    quantityByModel: new Map()
                };

                current.quantity += normalized.quantity;

                const modelId = metaObject?.metaModel?.id || null;
                if (modelId) {
                    const previous = current.quantityByModel.get(modelId) || 0;
                    current.quantityByModel.set(modelId, previous + normalized.quantity);
                }

                totals.set(aggregationKey, current);
            }
        }
    }

    return Array.from(totals.values())
        .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, "pt-BR"));
}

export async function generateAndRenderMaterialsList() {
    if (!materialsFeatureAllowed) {
        return [];
    }
    if (materialsGenerationPromise) {
        return materialsGenerationPromise;
    }

    const previousButtonText = generateMaterialsButton?.textContent;
    materialsGenerationPromise = (async () => {
        if (generateMaterialsButton) {
            generateMaterialsButton.disabled = true;
            generateMaterialsButton.textContent = "Carregando classificação dos materiais...";
        }

        try {
            await ensureMaterialsClassificationReady();

            const items = collectQuantitativeMaterials();
            materialsAllResults = items;
            materialsSearchQuery = "";
            if (materialsSearchInput) {
                materialsSearchInput.value = "";
            }
            renderMaterialsResults(items, { totalCount: items.length, query: "" });
            return items;
        } finally {
            if (generateMaterialsButton) {
                generateMaterialsButton.disabled = false;
                generateMaterialsButton.textContent = previousButtonText;
            }
            materialsGenerationPromise = null;
        }
    })();

    return materialsGenerationPromise;
}

export async function applyMaterialsSearch({ skipAssociationsLoad = false } = {}) {
    if (!materialsFeatureAllowed || !materialsSummary || !materialsResultsList) {
        return;
    }

    if (!skipAssociationsLoad) {
        try {
            await ensureBudgetAssociationsLoaded();
        } catch (error) {
            console.warn("Não foi possível carregar as associações para pesquisa por código.", error);
        }
    }

    const rawQuery = materialsSearchInput?.value || "";
    const normalizedQuery = normalizeSearchText(rawQuery);
    materialsSearchQuery = rawQuery;

    let filteredItems = normalizedQuery
        ? materialsAllResults.filter((item) => normalizeSearchText(item.name).includes(normalizedQuery))
        : materialsAllResults;

    if (normalizedQuery) {
        const associatedMaterials = getAssociatedMaterialsByBudgetReference({ code: rawQuery, description: rawQuery });
        if (associatedMaterials.length) {
            filteredItems = materialsAllResults.filter((item) =>
                associatedMaterials.some((associatedName) => materialNamesMatch(associatedName, item.name))
            );
        }
    }

    if (activeMaterialFilter && !filteredItems.some((item) => item.name === activeMaterialFilter)) {
        clearMaterialIsolation();
    }

    renderMaterialsResults(filteredItems, { totalCount: materialsAllResults.length, query: rawQuery.trim() });
}
