// Módulo "scene-objects" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { hiddenOriginalEntityIds, lastEntity, lastSelectedEntity, loadedModels, objectModelIdLookup, rotatedEntityAliases, searchInput, viewer } from "../viewer-authenticated.js";
import { invalidateExplorerCaches } from "./explorer.js";
import { resolveMetaObject, resolveSceneObjectId } from "./ifc-meta.js";
import { modelIsolateController } from "./treeview-section.js";


export function getAllObjectIds() {
    if (!modelIsolateController) {
        return [];
    }

    const ids = [];

    if (Array.isArray(modelIsolateController?.objectIds)) {
        ids.push(...modelIsolateController.objectIds);
    }

    if (!ids.length && modelIsolateController?.objects && typeof modelIsolateController.objects === "object") {
        ids.push(...Object.keys(modelIsolateController.objects));
    }

    if (!ids.length && typeof modelIsolateController?.getObjectsIds === "function") {
        ids.push(...(modelIsolateController.getObjectsIds() || []));
    }

    if (!ids.length && typeof modelIsolateController?.getObjectIds === "function") {
        ids.push(...(modelIsolateController.getObjectIds() || []));
    }

    const unique = new Set(ids.filter((id) => !hiddenOriginalEntityIds.has(id)));
    for (const aliasId of rotatedEntityAliases.keys()) {
        unique.add(aliasId);
    }

    return Array.from(unique);
}

export function resolveEntityById(id) {
    if (!id) {
        return null;
    }

    const aliasEntry = rotatedEntityAliases.get(id);
    if (aliasEntry?.entity) {
        return aliasEntry.entity;
    }

    return viewer.scene.objects?.[id] || null;
}

export function findSourceIdByEntity(entity) {
    if (!entity?.id) {
        return null;
    }

    for (const [aliasId, aliasEntry] of rotatedEntityAliases.entries()) {
        if (aliasEntry.entity === entity) {
            return aliasEntry.sourceId || aliasId;
        }
    }

    return entity.id;
}

export function getNextCloneId(sourceId) {
    let index = 1;
    let cloneId = `${sourceId}-${index}`;

    while (rotatedEntityAliases.has(cloneId) || viewer.scene.objects?.[cloneId]) {
        index += 1;
        cloneId = `${sourceId}-${index}`;
    }

    return cloneId;
}

export function resolveRotationTargetId() {
    const selectedSourceId = findSourceIdByEntity(lastSelectedEntity);
    if (selectedSourceId) {
        return selectedSourceId;
    }

    if (lastEntity?.isObject) {
        const hoveredSourceId = findSourceIdByEntity(lastEntity);
        if (hoveredSourceId) {
            return hoveredSourceId;
        }
    }

    const typedId = searchInput?.value?.trim();
    if (typedId && resolveEntityById(typedId)?.isObject) {
        return typedId;
    }

    return null;
}

export function getModelObjectIds(modelId) {
    const ids = [];

    // Tenta usar a lista de objetos do modelo (quando disponível)
    const model = loadedModels.get(modelId);
    if (model?.objectIds?.length) {
        return [...model.objectIds];
    }

    // Fallback: filtra metaObjects pelo metaModel associado
    const metaObjects = viewer.metaScene?.metaObjects || {};
    for (const [objectId, metaObject] of Object.entries(metaObjects)) {
        if (metaObject?.metaModel?.id === modelId) {
            ids.push(objectId);
        }
    }
    return ids;
}

export function rebuildObjectModelIdLookup() {
    objectModelIdLookup.clear();
    invalidateExplorerCaches();

    loadedModels.forEach((model, modelId) => {
        if (!Array.isArray(model?.objectIds)) {
            return;
        }

        model.objectIds.forEach((objectId) => {
            if (objectId) {
                objectModelIdLookup.set(objectId, modelId);
            }
        });
    });
}

export function getObjectMetaModelId(objectId) {
    const metaObject = resolveMetaObject(objectId);

    if (metaObject?.metaModel?.id) {
        return metaObject.metaModel.id;
    }

    const sceneObjectId = resolveSceneObjectId(objectId);
    if (sceneObjectId) {
        for (const candidateId of new Set([sceneObjectId, findSourceIdByEntity(resolveEntityById(sceneObjectId))].filter(Boolean))) {
            const candidateMetaObject = resolveMetaObject(candidateId);
            if (candidateMetaObject?.metaModel?.id) {
                return candidateMetaObject.metaModel.id;
            }
        }
    }

    if (!objectModelIdLookup.size && loadedModels.size) {
        rebuildObjectModelIdLookup();
    }
    return objectModelIdLookup.get(sceneObjectId || objectId) || null;
}

export function intersectsAABB(aabbA, aabbB, overlapTolerance = 0) {
    if (!aabbA || !aabbB) {
        return false;
    }

    const overlapX = Math.min(aabbA[3], aabbB[3]) - Math.max(aabbA[0], aabbB[0]);
    const overlapY = Math.min(aabbA[4], aabbB[4]) - Math.max(aabbA[1], aabbB[1]);
    const overlapZ = Math.min(aabbA[5], aabbB[5]) - Math.max(aabbA[2], aabbB[2]);

    if (overlapX <= 0 || overlapY <= 0 || overlapZ <= 0) {
        return false;
    }

    if (overlapTolerance <= 0) {
        return true;
    }

    return overlapX >= overlapTolerance && overlapY >= overlapTolerance && overlapZ >= overlapTolerance;
}
export function mergeAABBs(aabbs) {
    const valid = aabbs.filter(Boolean);

    if (!valid.length) {
        return null;
    }

    const minX = Math.min(...valid.map((aabb) => aabb[0]));
    const minY = Math.min(...valid.map((aabb) => aabb[1]));
    const minZ = Math.min(...valid.map((aabb) => aabb[2]));
    const maxX = Math.max(...valid.map((aabb) => aabb[3]));
    const maxY = Math.max(...valid.map((aabb) => aabb[4]));
    const maxZ = Math.max(...valid.map((aabb) => aabb[5]));

    return [minX, minY, minZ, maxX, maxY, maxZ];
}

export function getCameraPose() {
    const { eye, look, up } = viewer.camera || {};

    if (!eye || !look || !up) {
        return null;
    }

    return {
        eye: [...eye],
        look: [...look],
        up: [...up]
    };
}

export function restoreCameraPose(pose) {
    if (!pose) {
        return;
    }

    viewer.cameraFlight.jumpTo({
        eye: pose.eye,
        look: pose.look,
        up: pose.up
    });
}
