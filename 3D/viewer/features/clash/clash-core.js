export const CLASH_STATUSES = Object.freeze(["new", "reviewing", "accepted", "resolved", "ignored"]);

const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;
const vector = (value) => Array.isArray(value) && value.length >= 3
    ? value.slice(0, 3).map((coordinate) => Number(coordinate) || 0)
    : null;

function rawClashes(raw) {
    if (Array.isArray(raw)) return raw;
    if (Array.isArray(raw?.clashes)) return raw.clashes;
    if (Array.isArray(raw?.results)) return raw.results;
    if (raw && typeof raw === "object") {
        return Object.entries(raw).flatMap(([setName, value]) => {
            const clashes = Array.isArray(value) ? value : value?.clashes;
            return Array.isArray(clashes) ? clashes.map((clash) => ({ ...clash, setName })) : [];
        });
    }
    return [];
}

function normalizeObject(raw, fallback = {}) {
    const object = raw || {};
    return {
        modelId: text(object.modelId ?? object.model_id, fallback.modelId || ""),
        guid: text(object.guid ?? object.globalId ?? object.GlobalId, ""),
        type: text(object.type ?? object.ifcClass ?? object.ifc_class, "IfcRoot"),
        name: text(object.name ?? object.Name, "Elemento sem nome")
    };
}

/** Adapts IfcClash JSON without exposing its version-specific shape to the UI. */
export function normalizeIfcClashResults(raw, context = {}) {
    return rawClashes(raw).map((clash, index) => {
        const a = clash.objectA ?? clash.a ?? clash.elementA ?? clash.element_a;
        const b = clash.objectB ?? clash.b ?? clash.elementB ?? clash.element_b;
        const position = vector(clash.position ?? clash.point ?? clash.p1) || [0, 0, 0];
        const distance = Number(clash.distance ?? clash.depth ?? clash.penetration);
        return {
            id: text(clash.id, `clash-${index + 1}`),
            setA: text(clash.setA ?? clash.groupA, context.setA || "Grupo A"),
            setB: text(clash.setB ?? clash.groupB, context.setB || "Grupo B"),
            objectA: normalizeObject(a, { modelId: context.modelA }),
            objectB: normalizeObject(b, { modelId: context.modelB }),
            position,
            distance: Number.isFinite(distance) ? distance : null,
            status: CLASH_STATUSES.includes(clash.status) ? clash.status : "new",
            source: "ifcclash"
        };
    });
}

const canonicalGuid = (guid) => text(guid).replace(/^#/, "").toLowerCase();

/** Resolves GlobalId first as model-prefixed ID, then as the original scene ID. */
export function resolveIfcGuidToSceneObjectId(guid, modelId, scene) {
    if (!guid || !scene?.objects) return null;
    const candidates = [modelId ? `${modelId}#${guid}` : null, modelId ? `${modelId}.${guid}` : null, guid].filter(Boolean);
    for (const candidate of candidates) if (scene.objects[candidate]) return candidate;
    const wanted = canonicalGuid(guid);
    return Object.keys(scene.objects).find((id) => {
        const tail = id.split(/[.#]/).pop();
        return canonicalGuid(tail) === wanted;
    }) || null;
}

/** Applies xeokit's model Euler rotation (degrees, X/Y/Z) followed by translation. */
export function transformClashPointToViewerCoordinates(point, transform = {}) {
    let [x, y, z] = vector(point) || [0, 0, 0];
    const [rx, ry, rz] = (transform.rotation || [0, 0, 0]).map((degree) => (Number(degree) || 0) * Math.PI / 180);
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    const position = transform.position || [0, 0, 0];
    return [x + (Number(position[0]) || 0), y + (Number(position[1]) || 0), z + (Number(position[2]) || 0)];
}

export function filterClashResults(clashes, { query = "", statuses = CLASH_STATUSES } = {}) {
    const accepted = new Set(statuses);
    const needle = text(query).toLocaleLowerCase("pt-BR");
    return clashes.filter((clash) => accepted.has(clash.status) && (!needle || [
        clash.objectA, clash.objectB
    ].flatMap((object) => [object.name, object.guid, object.objectId, object.originalSystemId, object.type, object.modelId]).join(" ").toLocaleLowerCase("pt-BR").includes(needle)));
}

export function groupClashResults(clashes) {
    const groups = new Map();
    clashes.forEach((clash) => {
        const key = `${clash.objectA.modelId || clash.setA} × ${clash.objectB.modelId || clash.setB}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(clash);
    });
    return groups;
}

export function adjacentClashIndex(index, length, direction) {
    if (!length) return -1;
    return (index + (direction < 0 ? -1 : 1) + length) % length;
}

export function serializeClashViewpoint(clash, viewpoint) {
    return { version: "2.1", clashId: clash.id, source: clash.source, guids: [clash.objectA.originalSystemId || clash.objectA.guid, clash.objectB.originalSystemId || clash.objectB.guid].filter(Boolean), objectIds: [clash.objectA.objectId, clash.objectB.objectId].filter(Boolean), viewpoint };
}