// Módulo "entity-actions" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { viewer } from "../viewer-authenticated.js";
import { focusObjectCollection, getExplorerSceneMetaObjects } from "./explorer.js";
import { expandHierarchy, getMetaObjectNetworkInfo, getMetaObjectPartInfo, isSceneObjectId, resolveMetaObject } from "./ifc-meta.js";
import { findMaterialObjectIds, isMaterialPropertySet, normalizeMaterialName, normalizeMaterialToken } from "./materials.js";
import { getObjectMetaModelId } from "./scene-objects.js";
import { toArraySafe } from "./snapshots.js";


export function resetXRay() {
    const scene = viewer.scene;

    if (!scene || scene.numXRayedObjects === 0) {
        return;
    }

    scene.setObjectsXRayed(scene.xrayedObjectIds, false);
}

export function hideEntity(entity) {
    if (!entity?.isObject) {
        return;
    }

    entity.visible = false;
}

export function collectEntityMaterialTokens(entity) {
    const metaObject = resolveMetaObject(entity?.id);
    if (!metaObject?.propertySets?.length) {
        return [];
    }

    const ignoredTokens = new Set([
        "material",
        "materials",
        "materiais",
        "itens associados",
        "itens_associados",
        "associated items"
    ]);

    const tokens = new Set();

    for (const pset of metaObject.propertySets) {
        if (!isMaterialPropertySet(pset) || !Array.isArray(pset?.properties)) {
            continue;
        }

        for (const prop of pset.properties) {
            const normalizedName = normalizeMaterialName(prop?.name || prop?.id || "");
            const normalizedValue = normalizeMaterialToken(prop?.value);

            if (normalizedName && !ignoredTokens.has(normalizedName)) {
                tokens.add(normalizedName);
            }

            if (normalizedValue && !ignoredTokens.has(normalizedValue)) {
                tokens.add(normalizedValue);
            }
        }
    }

    return Array.from(tokens);
}

export function getPartObjectIdsForEntity(entity) {
    const metaObject = resolveMetaObject(entity?.id);
    if (!metaObject) {
        return [];
    }

    const partInfo = getMetaObjectPartInfo(metaObject);
    if (!partInfo.hasIdentification) {
        return [];
    }

    const modelId = getObjectMetaModelId(metaObject.id) || "SEM_MODELO";
    const ids = getExplorerSceneMetaObjects()
        .filter((candidateMetaObject) => {
            if ((getObjectMetaModelId(candidateMetaObject.id) || "SEM_MODELO") !== modelId) {
                return false;
            }

            const candidatePartInfo = getMetaObjectPartInfo(candidateMetaObject);
            if (!candidatePartInfo.hasIdentification) {
                return false;
            }

            return candidatePartInfo.className === partInfo.className
                && candidatePartInfo.typeName === partInfo.typeName
                && candidatePartInfo.partName === partInfo.partName;
        })
        .map((candidateMetaObject) => candidateMetaObject.sceneObjectId || candidateMetaObject.id)
        .filter((id) => isSceneObjectId(id));

    return expandHierarchy(Array.from(new Set(ids)));
}

export function getFallbackSimilarObjectIds(entity) {
    const scene = viewer.scene;

    if (!scene || !entity?.isObject) {
        return [];
    }

    const tokens = collectEntityMaterialTokens(entity);
    const ids = new Set();

    for (const token of tokens) {
        const matchingIds = findMaterialObjectIds(token, { activeOnly: false });
        for (const id of matchingIds) {
            ids.add(id);
        }
    }

    if (entity.id) {
        ids.add(entity.id);
    }

    return Array.from(ids);
}

export function getSimilarEntityObjectIds(entity) {
    const partObjectIds = getPartObjectIdsForEntity(entity);
    if (partObjectIds.length) {
        return partObjectIds;
    }

    return getFallbackSimilarObjectIds(entity);
}

export function getSubnetworkObjectIdsForEntity(entity) {
    const metaObject = resolveMetaObject(entity?.id);
    if (!metaObject) {
        return [];
    }

    const { subnetwork } = getMetaObjectNetworkInfo(metaObject);
    if (!subnetwork || subnetwork === "Sem subrede") {
        return [];
    }

    const modelId = getObjectMetaModelId(metaObject.id) || null;
    const ids = getExplorerSceneMetaObjects()
        .filter((candidateMetaObject) => {
            if (modelId && getObjectMetaModelId(candidateMetaObject.id) !== modelId) {
                return false;
            }

            return getMetaObjectNetworkInfo(candidateMetaObject).subnetwork === subnetwork;
        })
        .map((candidateMetaObject) => candidateMetaObject.sceneObjectId || candidateMetaObject.id)
        .filter((id) => isSceneObjectId(id));

    return expandHierarchy(Array.from(new Set(ids)));
}

export function hideSimilarEntities(entity) {
    const scene = viewer.scene;

    if (!scene || !entity?.isObject) {
        return;
    }

    const visibleIds = new Set(toArraySafe(scene.visibleObjectIds));
    const idsToHide = getSimilarEntityObjectIds(entity).filter((id) => visibleIds.has(id));

    if (!idsToHide.length) {
        return;
    }

    scene.setObjectsSelected(scene.selectedObjectIds, false);
    scene.setObjectsVisible(idsToHide, false);
}

export function isolateSimilarEntities(entity) {
    const scene = viewer.scene;

    if (!scene || !entity?.isObject) {
        return;
    }

    const idsToShow = getSimilarEntityObjectIds(entity);

    if (!idsToShow.length) {
        return;
    }

    focusObjectCollection(idsToShow);
}

export function isolateEntitySubnetwork(entity) {
    const idsToShow = getSubnetworkObjectIdsForEntity(entity);
    if (!idsToShow.length) {
        return;
    }

    focusObjectCollection(idsToShow);
}

export function hideEntitySubnetwork(entity) {
    const scene = viewer.scene;

    if (!scene || !entity?.isObject) {
        return;
    }

    const visibleIds = new Set(toArraySafe(scene.visibleObjectIds));
    const idsToHide = getSubnetworkObjectIdsForEntity(entity).filter((id) => visibleIds.has(id));

    if (!idsToHide.length) {
        return;
    }

    scene.setObjectsSelected(scene.selectedObjectIds, false);
    scene.setObjectsVisible(idsToHide, false);
}

export function isolateEntity(entity) {
    const scene = viewer.scene;
    const metaObject = resolveMetaObject(entity?.id);

    if (!scene || !entity?.isObject || !metaObject) {
        return;
    }

    scene.setObjectsVisible(scene.visibleObjectIds, false);
    scene.setObjectsXRayed(scene.xrayedObjectIds, false);
    scene.setObjectsSelected(scene.selectedObjectIds, false);

    metaObject.withMetaObjectsInSubtree((mo) => {
        const currentEntity = scene.objects[mo.id];
        if (currentEntity) {
            currentEntity.visible = true;
        }
    });
}

export function showAllEntities() {
    const scene = viewer.scene;

    if (!scene) {
        return;
    }

    scene.setObjectsVisible(scene.objectIds, true);
    scene.setObjectsXRayed(scene.xrayedObjectIds, false);
    scene.setObjectsSelected(scene.selectedObjectIds, false);
}
