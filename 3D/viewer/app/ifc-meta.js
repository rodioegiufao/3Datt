// Módulo "ifc-meta" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { clearSelection, normalizedSceneObjectIdLookup, viewer } from "../viewer-authenticated.js";
import { focusObjectCollection, getExplorerSceneMetaObjects, invalidateExplorerCaches } from "./explorer.js";
import { requestRenderFrame } from "./performance.js";
import { findSourceIdByEntity, getAllObjectIds, getObjectMetaModelId, mergeAABBs, resolveEntityById } from "./scene-objects.js";
import { modelIsolateController } from "./treeview-section.js";


export function formatIfcPropertyValue(value) {
    if (value === null || value === undefined) {
        return "(vazio)";
    }

    if (typeof value === "object") {
        try {
            return JSON.stringify(value);
        } catch (e) {
            return String(value);
        }
    }

    return String(value);
}

export function normalizeIfcPropertyKey(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .toLowerCase();
}

export function getMetaObjectPropertyValue(metaObject, propertyNames = [], options = {}) {
    if (!metaObject?.propertySets?.length || !propertyNames.length) {
        return null;
    }

    const normalizedNames = propertyNames
        .map((name) => normalizeIfcPropertyKey(name))
        .filter(Boolean);
    const normalizedPropertySetNames = (options.propertySetNames || [])
        .map((name) => normalizeIfcPropertyKey(name))
        .filter(Boolean);

    for (const pset of metaObject.propertySets) {
        if (!Array.isArray(pset?.properties)) {
            continue;
        }

        if (normalizedPropertySetNames.length) {
            const psetKey = normalizeIfcPropertyKey(pset?.name || pset?.id || "");
            if (!psetKey || !normalizedPropertySetNames.includes(psetKey)) {
                continue;
            }
        }

        for (const prop of pset.properties) {
            const propKey = normalizeIfcPropertyKey(prop?.name || prop?.id || "");
            if (!propKey || !normalizedNames.includes(propKey)) {
                continue;
            }

            const rawValue = formatIfcPropertyValue(prop?.value).trim();
            if (!rawValue || rawValue === "(vazio)") {
                continue;
            }

            return rawValue;
        }
    }

    return null;
}

export function getMetaObjectNetworkInfo(metaObject) {
    const network = getMetaObjectPropertyValue(metaObject, ["Rede", "Network"]);
    const subnetwork =
        getMetaObjectPropertyValue(metaObject, ["Subrede", "Sub-rede", "Sub Rede", "Subnetwork", "SubNetwork"]) ||
        getMetaObjectPropertyValue(metaObject, ["Elemento"], {
            propertySetNames: ["AltoQi_Eberick_Elemento"]
        });

    return {
        network: network || subnetwork || "Sem rede",
        subnetwork: subnetwork || network || "Sem subrede"
    };
}

export function getMetaObjectPartInfo(metaObject) {
    const identificationPropertySetNames = [
        "Identificação_Elemento",
        "Identificacao_Elemento",
        "Identificacao Elemento",
        "Identificação Elemento"
    ];
    const className = getMetaObjectPropertyValue(metaObject, ["Classe", "Class"], {
        propertySetNames: identificationPropertySetNames
    });
    const typeName = getMetaObjectPropertyValue(metaObject, ["Tipo", "Type"], {
        propertySetNames: identificationPropertySetNames
    });
    const partName = getMetaObjectPropertyValue(metaObject, ["Nome", "Name"], {
        propertySetNames: identificationPropertySetNames
    });

    return {
        className: className || "Sem classe",
        typeName: typeName || "Sem tipo",
        partName: partName || metaObject?.name || metaObject?.id || "Sem nome",
        hasIdentification: Boolean(className || typeName || partName)
    };
}


export function getNetworkObjectIds(networkName, modelId = null) {
    const ids = getExplorerSceneMetaObjects()
        .filter((metaObject) => {
            const { network } = getMetaObjectNetworkInfo(metaObject);
            if (network !== networkName) {
                return false;
            }
            if (modelId && (getObjectMetaModelId(metaObject.id) || "SEM_MODELO") !== modelId) {
                return false;
            }
            return true;
        })
        .map((metaObject) => metaObject.sceneObjectId || metaObject.id)
        .filter((id) => isSceneObjectId(id));

    return expandHierarchy(Array.from(new Set(ids)));
}

export function focusNetworkGroup(networkName, modelId = null) {
    return focusObjectCollection(getNetworkObjectIds(networkName, modelId));
}

export function resolveMetaObject(entityId) {
    if (!entityId) {
        return null;
    }

    const metaObjects = viewer.metaScene?.metaObjects;
    if (!metaObjects) {
        return null;
    }

    if (metaObjects[entityId]) {
        return metaObjects[entityId];
    }

    const rawId = String(entityId);
    const candidateIds = new Set([rawId]);

    ["#", "/", ":"].forEach((separator) => {
        if (!rawId.includes(separator)) {
            return;
        }

        const parts = rawId.split(separator);
        const suffix = parts[parts.length - 1];
        if (suffix) {
            candidateIds.add(suffix);
        }
    });

    for (const candidateId of candidateIds) {
        if (metaObjects[candidateId]) {
            return metaObjects[candidateId];
        }
    }

    const normalizedCandidates = new Set(Array.from(candidateIds, (id) => id.toLowerCase()));

    for (const [id, metaObject] of Object.entries(metaObjects)) {
        const normalizedId = id.toLowerCase();
        if (normalizedCandidates.has(normalizedId)) {
            return metaObject;
        }

        for (const candidateId of normalizedCandidates) {
            if (
                normalizedId.endsWith(`#${candidateId}`) ||
                normalizedId.endsWith(`/${candidateId}`) ||
                normalizedId.endsWith(`:${candidateId}`)
            ) {
                return metaObject;
            }
        }
    }

    return null;
}
export function getMetaObjectParent(metaObject) {
    if (!metaObject) {
        return null;
    }

    if (typeof metaObject.parent === "string") {
        return resolveMetaObject(metaObject.parent);
    }

    if (metaObject.parent?.id) {
        return metaObject.parent;
    }

    if (metaObject.parentId) {
        return resolveMetaObject(metaObject.parentId);
    }

    return null;
}

export function getMetaObjectChildren(metaObject) {
    if (!metaObject) {
        return [];
    }

    const entries = [];

    if (Array.isArray(metaObject.children)) {
        entries.push(...metaObject.children);
    }

    if (Array.isArray(metaObject.childrenIds)) {
        entries.push(...metaObject.childrenIds);
    }

    const children = [];
    const seenIds = new Set();

    for (const entry of entries) {
        const child = typeof entry === "string" ? resolveMetaObject(entry) : entry;
        if (!child?.id || seenIds.has(child.id)) {
            continue;
        }

        seenIds.add(child.id);
        children.push(child);
    }

    return children;
}

export function traverseMetaObjectSubtree(metaObject, visitor) {
    if (!metaObject || typeof visitor !== "function") {
        return;
    }

    const stack = [metaObject];
    const visited = new Set();

    while (stack.length) {
        const current = stack.pop();
        if (!current?.id || visited.has(current.id)) {
            continue;
        }

        visited.add(current.id);
        visitor(current);

        const children = getMetaObjectChildren(current);
        for (let i = children.length - 1; i >= 0; i--) {
            stack.push(children[i]);
        }
    }
}

export function buildSceneObjectIdCandidates(objectId) {
    if (!objectId) {
        return [];
    }

    const rawId = String(objectId).trim();
    if (!rawId) {
        return [];
    }

    const candidates = new Set([rawId]);

    ["#", "/", ":"].forEach((separator) => {
        if (!rawId.includes(separator)) {
            return;
        }

        const parts = rawId.split(separator);
        const suffix = parts[parts.length - 1]?.trim();
        if (suffix) {
            candidates.add(suffix);
        }
    });

    return Array.from(candidates);
}

export function rebuildSceneObjectIdLookup() {
    normalizedSceneObjectIdLookup.clear();
    invalidateExplorerCaches();

    const sceneObjectIds = new Set();
    Object.keys(viewer.scene?.objects || {}).forEach((id) => {
        if (id) {
            sceneObjectIds.add(id);
        }
    });

    getAllObjectIds().forEach((id) => {
        if (id) {
            sceneObjectIds.add(id);
        }
    });

    sceneObjectIds.forEach((sceneObjectId) => {
        buildSceneObjectIdCandidates(sceneObjectId).forEach((candidateId) => {
            const normalizedCandidate = candidateId.toLowerCase();
            if (!normalizedSceneObjectIdLookup.has(normalizedCandidate)) {
                normalizedSceneObjectIdLookup.set(normalizedCandidate, sceneObjectId);
            }
        });
    });
}

export function resolveSceneObjectId(objectId) {
    if (!objectId) {
        return null;
    }

    const directEntity = resolveEntityById(objectId);
    if (directEntity?.id) {
        return findSourceIdByEntity(directEntity) || directEntity.id;
    }

    if (!normalizedSceneObjectIdLookup.size) {
        rebuildSceneObjectIdLookup();
    }

    for (const candidateId of buildSceneObjectIdCandidates(objectId)) {
        const resolvedId = normalizedSceneObjectIdLookup.get(candidateId.toLowerCase());
        if (resolvedId) {
            return resolvedId;
        }
    }

    return null;
}

export function isSceneObjectId(objectId) {
    return Boolean(resolveSceneObjectId(objectId));
}

export function metaObjectBelongsToStorey(metaObject, storeyId) {
    if (!metaObject?.id || !storeyId) {
        return false;
    }

    let current = metaObject;
    const visited = new Set();

    while (current?.id && !visited.has(current.id)) {
        if (current.id === storeyId) {
            return true;
        }

        visited.add(current.id);
        current = getMetaObjectParent(current);
    }

    return false;
}

export function getObjectsByStorey(storeyId) {
    const storeyMetaObject = resolveMetaObject(storeyId);
    if (!storeyMetaObject) {
        return [];
    }

    const ids = new Set();

    if (typeof viewer.scene.getObjectsInSubtree === "function") {
        const subtreeIds = viewer.scene.getObjectsInSubtree(storeyMetaObject.id) || [];
        subtreeIds.forEach((id) => {
            const sceneObjectId = resolveSceneObjectId(id);
            if (sceneObjectId) {
                ids.add(sceneObjectId);
            }
        });
    }

    traverseMetaObjectSubtree(storeyMetaObject, (metaObject) => {
        const sceneObjectId = resolveSceneObjectId(metaObject.id);
        if (sceneObjectId) {
            ids.add(sceneObjectId);
        }
    });

    const allMetaObjects = viewer.metaScene?.metaObjects || {};
    for (const metaObject of Object.values(allMetaObjects)) {
        if (!metaObject?.id || !isSceneObjectId(metaObject.id)) {
            continue;
        }

        if (metaObjectBelongsToStorey(metaObject, storeyMetaObject.id)) {
            const sceneObjectId = resolveSceneObjectId(metaObject.id);
            if (sceneObjectId) {
                ids.add(sceneObjectId);
            }
        }
    }

    return Array.from(ids);
}

export function getClassesFromObjects(objectIds) {
    const classIds = new Set();

    objectIds.forEach((objectId) => {
        const metaObject = resolveMetaObject(objectId);
        const classId = metaObject?.type;
        if (classId) {
            classIds.add(classId);
        }
    });

    return Array.from(classIds);
}

export function expandHierarchy(objectIds) {
    const expandedIds = new Set();

    objectIds.forEach((objectId) => {
        const metaObject = resolveMetaObject(objectId);
        if (!metaObject) {
            const sceneObjectId = resolveSceneObjectId(objectId);
            if (sceneObjectId) {
                expandedIds.add(sceneObjectId);
            }
            return;
        }

        traverseMetaObjectSubtree(metaObject, (childMetaObject) => {
            const sceneObjectId = resolveSceneObjectId(childMetaObject.id);
            if (sceneObjectId) {
                expandedIds.add(sceneObjectId);
            }
        });
    });

    return Array.from(expandedIds);
}

export function getAllEntitiesFromStorey(storeyId) {
    const objectIds = getObjectsByStorey(storeyId);
    const expandedObjectIds = expandHierarchy(objectIds);
    const classIds = getClassesFromObjects(expandedObjectIds);

    return {
        objectIds: expandedObjectIds,
        classIds
    };
}

export function getObjectIdsByType(type) {
    if (!type) {
        return [];
    }

    if (typeof viewer.metaScene?.getObjectIDsByType === "function") {
        return viewer.metaScene.getObjectIDsByType(type) || [];
    }

    const metaObjects = viewer.metaScene?.metaObjects || {};
    const ids = [];

    for (const metaObject of Object.values(metaObjects)) {
        if (metaObject?.type === type && metaObject?.id) {
            ids.push(metaObject.id);
        }
    }

    return ids;
}

export function isolateStorey(storeyId) {
    const storeyMetaObject = resolveMetaObject(storeyId);
    if (!storeyMetaObject) {
        return false;
    }

    const { objectIds, classIds } = getAllEntitiesFromStorey(storeyMetaObject.id);
    const idsToFocus = new Set(objectIds);

    classIds.forEach((classId) => {
        getObjectIdsByType(classId).forEach((objectId) => {
            const metaObject = resolveMetaObject(objectId);
            const sceneObjectId = resolveSceneObjectId(objectId);
            if (metaObjectBelongsToStorey(metaObject, storeyMetaObject.id) && sceneObjectId) {
                idsToFocus.add(sceneObjectId)
            }
        });
    });

    const idsToShow = Array.from(idsToFocus);
    if (!idsToShow.length) {
        return false;
    }

    const allIds = getAllObjectIds();
    modelIsolateController.setObjectsVisible(allIds, false);
    modelIsolateController.setObjectsXRayed(allIds, false);
    modelIsolateController.setObjectsHighlighted(allIds, false);

    modelIsolateController.setObjectsVisible(idsToShow, true);
    modelIsolateController.setObjectsXRayed(idsToShow, false);
    viewer.scene.setObjectsHighlighted(idsToShow, true);

    const combinedAABB = mergeAABBs(idsToShow.map((id) => viewer.scene.getAABB(id)));
    if (combinedAABB) {
        viewer.cameraFlight.flyTo({
            aabb: combinedAABB,
            duration: 0.6
        });
    }

    clearSelection();
    requestRenderFrame();
    return true;
}
