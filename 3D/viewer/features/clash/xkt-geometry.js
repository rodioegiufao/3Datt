const cache = new Map();
const numberArray = (value, Type) => value?.length ? (value instanceof Type ? value : new Type(value)) : null;

function transformPositions(positions, transform = {}) {
    const output = new Float32Array(positions.length);
    const rotation=(transform.rotation||[0,0,0]).map(v=>(Number(v)||0)*Math.PI/180), position=transform.position||[0,0,0];
    const [sx,cx]=[Math.sin(rotation[0]),Math.cos(rotation[0])], [sy,cy]=[Math.sin(rotation[1]),Math.cos(rotation[1])], [sz,cz]=[Math.sin(rotation[2]),Math.cos(rotation[2])];
    for(let i=0;i<positions.length;i+=3) {
        let x=positions[i],y=positions[i+1],z=positions[i+2];
        [y,z]=[y*cx-z*sx,y*sx+z*cx]; [x,z]=[x*cy+z*sy,-x*sy+z*cy]; [x,y]=[x*cz-y*sz,x*sz+y*cz];
        output[i]=x+(Number(position[0])||0); output[i+1]=y+(Number(position[1])||0); output[i+2]=z+(Number(position[2])||0);
    }
    return output;
}

export function positionsAABB(positions) {
    const aabb=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
    for(let i=0;i<positions.length;i+=3) { for(let axis=0;axis<3;axis++) { aabb[axis]=Math.min(aabb[axis],positions[i+axis]); aabb[axis+3]=Math.max(aabb[axis+3],positions[i+axis]); } }
    return aabb;
}
const aabbError=(a,b)=>a.reduce((sum,value,index)=>sum+Math.abs(value-b[index]),0);

function normalizeGeometryData(data) {
    const chunks = Array.isArray(data) ? data : Array.isArray(data?.meshes) ? data.meshes : [data];
    const usable=chunks.filter(chunk=>chunk?.positions?.length);
    if(!usable.length) return null;
    let vertexOffset=0; const positions=[],indices=[];
    for(const chunk of usable) {
        const source=numberArray(chunk.positions,Float32Array); if(!source) continue;
        const origin=chunk.origin||[0,0,0];
        for(let i=0;i<source.length;i+=3) positions.push(source[i]+origin[0],source[i+1]+origin[1],source[i+2]+origin[2]);
        const sourceIndices=chunk.indices?.length ? chunk.indices : Array.from({length:source.length/3},(_,i)=>i);
        for(const index of sourceIndices) indices.push(Number(index)+vertexOffset);
        vertexOffset += source.length/3;
    }
    return positions.length && indices.length >= 3 ? {positions:new Float32Array(positions),indices:new Uint32Array(indices)} : null;
}

/** Chooses raw or model-transformed vertices by comparing them with xeokit's world AABB. */
export function alignGeometryToEntityAABB(geometry, entityAABB, transform) {
    const transformed=transformPositions(geometry.positions,transform);
    const rawError=aabbError(positionsAABB(geometry.positions),entityAABB), transformedError=aabbError(positionsAABB(transformed),entityAABB);
    return {...geometry,positions:transformedError + 1e-5 < rawError ? transformed : geometry.positions,coordinateSpace:transformedError + 1e-5 < rawError ? "model-local+transform" : "world"};
}

export function validateGeometryCoordinateSpace(entity, geometry, tolerance = 0.02) {
    const calculated=positionsAABB(geometry.positions), expected=Array.from(entity.aabb);
    return {valid:aabbError(calculated,expected)<=tolerance*6,calculated,expected,error:aabbError(calculated,expected)};
}

export function extractEntityGeometry(entity, { modelId, transform = {}, metaObjects = {} } = {}) {
    const stableId=entity.originalSystemId||String(entity.id).split("#").pop();
    const key=`${modelId}:${stableId}`; if(cache.has(key)) return cache.get(key);
    if(typeof entity.getGeometryData !== "function") return null;
    const normalized=normalizeGeometryData(entity.getGeometryData()); if(!normalized) return null;
    const geometry=alignGeometryToEntityAABB(normalized,Array.from(entity.aabb),transform);
    const meta=metaObjects[entity.id]||metaObjects[entity.originalSystemId]||{};
    const result={id:stableId,objectId:stableId,originalSystemId:entity.originalSystemId||null,modelId,type:meta.type||entity.type||"Elemento",name:meta.name||stableId,aabb:Array.from(entity.aabb),positions:geometry.positions,indices:geometry.indices};
    cache.set(key,result); return result;
}

export const clearClashGeometryCache = (modelId) => { for(const key of cache.keys()) if(!modelId || key.startsWith(`${modelId}:`)) cache.delete(key); };
export const clashGeometryCache = cache;