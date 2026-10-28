const EPSILON = 1e-9;

export function aabbIntersects(a, b, padding = 0) {
    return a[0] <= b[3] + padding && a[3] + padding >= b[0]
        && a[1] <= b[4] + padding && a[4] + padding >= b[1]
        && a[2] <= b[5] + padding && a[5] + padding >= b[2];
}

/** Sweep-and-prune on X; Y/Z are checked only for active intervals. */
export function broadPhase(objectsA, objectsB, { padding = 0, sameModel = false } = {}) {
    const left = [...objectsA].filter((o) => o?.aabb?.length === 6).sort((a, b) => a.aabb[0] - b.aabb[0]);
    const right = [...objectsB].filter((o) => o?.aabb?.length === 6).sort((a, b) => a.aabb[0] - b.aabb[0]);
    const pairs = [];
    let start = 0;
    for (const a of left) {
        while (start < right.length && right[start].aabb[3] + padding < a.aabb[0]) start++;
        for (let j = start; j < right.length && right[j].aabb[0] <= a.aabb[3] + padding; j++) {
            const b = right[j];
            if (a.id === b.id || (sameModel && String(a.id) > String(b.id))) continue;
            if (aabbIntersects(a.aabb, b.aabb, padding)) pairs.push([a, b]);
        }
    }
    return pairs;
}

const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
const add = (a, b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]];
const mul = (a, n) => [a[0]*n, a[1]*n, a[2]*n];
const dot = (a, b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
const length2 = (a) => dot(a, a);

function segmentTriangle(p0, p1, t, epsilon) {
    const direction = sub(p1, p0), edge1 = sub(t[1], t[0]), edge2 = sub(t[2], t[0]);
    const h = cross(direction, edge2), determinant = dot(edge1, h);
    if (Math.abs(determinant) <= epsilon) return null;
    const inverse = 1 / determinant, s = sub(p0, t[0]), u = inverse * dot(s, h);
    if (u < -epsilon || u > 1 + epsilon) return null;
    const q = cross(s, edge1), v = inverse * dot(direction, q);
    if (v < -epsilon || u + v > 1 + epsilon) return null;
    const distance = inverse * dot(edge2, q);
    return distance >= -epsilon && distance <= 1 + epsilon ? add(p0, mul(direction, Math.max(0, Math.min(1, distance)))) : null;
}

function pointInTriangle3D(p, t, epsilon) {
    const v0 = sub(t[2], t[0]), v1 = sub(t[1], t[0]), v2 = sub(p, t[0]);
    const d00=dot(v0,v0), d01=dot(v0,v1), d02=dot(v0,v2), d11=dot(v1,v1), d12=dot(v1,v2);
    const denominator=d00*d11-d01*d01;
    if (Math.abs(denominator) <= EPSILON) return false;
    const u=(d11*d02-d01*d12)/denominator, v=(d00*d12-d01*d02)/denominator;
    return u >= -epsilon && v >= -epsilon && u + v <= 1 + epsilon;
}

/** Möller–Trumbore edge tests, with a coplanar containment fallback. */
export function trianglesIntersect(a, b, epsilon = 0.001) {
    const points = [];
    for (let i=0;i<3;i++) { const p=segmentTriangle(a[i],a[(i+1)%3],b,epsilon); if(p) points.push(p); }
    for (let i=0;i<3;i++) { const p=segmentTriangle(b[i],b[(i+1)%3],a,epsilon); if(p) points.push(p); }
    if (!points.length) {
        const normal = cross(sub(a[1],a[0]), sub(a[2],a[0]));
        const scale = Math.sqrt(length2(normal));
        if (scale > EPSILON && b.every((p) => Math.abs(dot(normal, sub(p,a[0]))) <= epsilon*scale)) {
            if (a.some((p) => pointInTriangle3D(p,b,epsilon)) || b.some((p) => pointInTriangle3D(p,a,epsilon))) points.push(a[0]);
        }
    }
    if (!points.length) return null;
    return points.reduce((sum,p)=>add(sum,p),[0,0,0]).map((v)=>v/points.length);
}

function triangle(geometry, offset) {
    const { positions, indices } = geometry;
    const vertex = (index) => [positions[index*3],positions[index*3+1],positions[index*3+2]];
    return [vertex(indices[offset]),vertex(indices[offset+1]),vertex(indices[offset+2])];
}
const triangleAABB = (t) => [Math.min(...t.map(p=>p[0])),Math.min(...t.map(p=>p[1])),Math.min(...t.map(p=>p[2])),Math.max(...t.map(p=>p[0])),Math.max(...t.map(p=>p[1])),Math.max(...t.map(p=>p[2]))];

export function buildTriangleBVH(geometry, offsets = null, leafSize = 12) {
    offsets ||= Array.from({length: Math.floor(geometry.indices.length/3)},(_,i)=>i*3);
    const bounds = offsets.map((offset)=>({offset,aabb:triangleAABB(triangle(geometry,offset))}));
    const build = (items) => {
        const aabb = items.reduce((r,x)=>r ? [Math.min(r[0],x.aabb[0]),Math.min(r[1],x.aabb[1]),Math.min(r[2],x.aabb[2]),Math.max(r[3],x.aabb[3]),Math.max(r[4],x.aabb[4]),Math.max(r[5],x.aabb[5])] : [...x.aabb],null);
        if (items.length <= leafSize) return {aabb, offsets:items.map(x=>x.offset)};
        const axis = [aabb[3]-aabb[0],aabb[4]-aabb[1],aabb[5]-aabb[2]].indexOf(Math.max(aabb[3]-aabb[0],aabb[4]-aabb[1],aabb[5]-aabb[2]));
        items.sort((x,y)=>(x.aabb[axis]+x.aabb[axis+3])-(y.aabb[axis]+y.aabb[axis+3]));
        const mid=Math.floor(items.length/2); return {aabb,left:build(items.slice(0,mid)),right:build(items.slice(mid))};
    };
    return bounds.length ? build(bounds) : null;
}

export function intersectGeometry(a, b, epsilon = 0.001) {
    if (!a?.positions?.length || !a?.indices?.length || !b?.positions?.length || !b?.indices?.length) return [];
    const rootA=buildTriangleBVH(a), rootB=buildTriangleBVH(b), points=[];
    if (!rootA || !rootB) return points;
    const stack=[[rootA,rootB]];
    while(stack.length) {
        const [na,nb]=stack.pop(); if(!aabbIntersects(na.aabb,nb.aabb,epsilon)) continue;
        if(na.offsets && nb.offsets) {
            for(const ia of na.offsets) for(const ib of nb.offsets) { const point=trianglesIntersect(triangle(a,ia),triangle(b,ib),epsilon); if(point) points.push(point); }
        } else if(na.offsets) { stack.push([na,nb.left],[na,nb.right]); }
        else if(nb.offsets) { stack.push([na.left,nb],[na.right,nb]); }
        else { stack.push([na.left,nb.left],[na.left,nb.right],[na.right,nb.left],[na.right,nb.right]); }
    }
    return points;
}

export function analyzeXktObjects(objectsA, objectsB, options = {}) {
    const candidates=broadPhase(objectsA,objectsB,{padding:options.mode === "clearance" ? options.clearance || 0 : 0,sameModel:options.sameModel});
    const clashes=[];
    for(const [a,b] of candidates) {
        const points=intersectGeometry(a,b,options.epsilon ?? 0.001);
        if(points.length) clashes.push({objectA:a,objectB:b,intersectionPoints:points,position:points.reduce((s,p)=>add(s,p),[0,0,0]).map(v=>v/points.length),penetrationDepth:null});
    }
    return {candidates:candidates.length,clashes};
}