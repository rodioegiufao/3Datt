import * as THREE from "three";
import { MM_TO_SCENE, evalValue, parameterMap } from "./state.js";
import { collectVoidCutters, boundsOverlap, subtractGeometry } from "./csg-engine.js";

const EPS = 1e-6;
export const SOLID_KINDS = ["extrusion", "blend", "revolve", "sweep", "sweptBlend"];
export const VOID_KINDS = ["voidExtrusion", "voidBlend", "voidRevolve", "voidSweep", "voidSweptBlend"];
export const isVoidKind = (kind) => VOID_KINDS.includes(kind);
export const isSolidKind = (kind) => SOLID_KINDS.includes(kind);
const v2 = (p) => new THREE.Vector2(p.x * MM_TO_SCENE, p.y * MM_TO_SCENE);

export function signedArea(points) {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + (p.x * q.y - q.x * p.y);
  }, 0) / 2;
}
export function normalizedLoop(points, ccw = true) {
  const pts = points.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }));
  const shouldReverse = ccw ? signedArea(pts) < 0 : signedArea(pts) > 0;
  return shouldReverse ? pts.reverse() : pts;
}
export function resampleLoop(points, count) {
  const pts = normalizedLoop(points);
  const lengths = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length].x - p.x, pts[(i + 1) % pts.length].y - p.y));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const out = [];
  for (let s = 0; s < count; s++) {
    let target = (s / count) * total;
    let i = 0;
    while (target > lengths[i] && i < lengths.length - 1) target -= lengths[i++];
    const a = pts[i], b = pts[(i + 1) % pts.length], t = lengths[i] ? target / lengths[i] : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}
function rotateToBestMatch(a, b) {
  let best = b, bestScore = Infinity;
  for (let shift = 0; shift < b.length; shift++) {
    const rot = b.map((_, i) => b[(i + shift) % b.length]);
    const score = a.reduce((sum, p, i) => sum + Math.hypot(p.x - rot[i].x, p.y - rot[i].y), 0);
    if (score < bestScore) { bestScore = score; best = rot; }
  }
  return best;
}
function shapeFromLoop(points, holes = []) {
  const loop = normalizedLoop(points, true);
  const shape = new THREE.Shape(loop.map(v2));
  holes.forEach((hole) => shape.holes.push(new THREE.Path(normalizedLoop(hole, false).map(v2))));
  return shape;
}
function extrusion(profile, form, params) {
  const depth = Math.max(evalValue(form.depth ?? form.end ?? "Profundidade", params), 1) * MM_TO_SCENE;
  return new THREE.ExtrudeGeometry(shapeFromLoop(profile.points, profile.holes || []), { depth, bevelEnabled: false });
}
function blend(profileA, profileB, form, params) {
  const n = Math.max(profileA.points.length, profileB.points.length, 12);
  const a = resampleLoop(profileA.points, n);
  const b = rotateToBestMatch(a, resampleLoop(profileB.points, n));
  const dist = Math.max(evalValue(form.distance ?? form.depth ?? "Profundidade", params), 1) * MM_TO_SCENE;
  return loftSections([a, b], [0, dist]);
}
function axisPointsFromPath(path) {
  const points = pathPoints(path);
  return points.length >= 2 ? [points[0], points[points.length - 1]] : [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1000, z: 0 }];
}
function revolve(profile, form, path) {
  if (!path?.points?.length) throw new Error("Eixo de revolução não definido para esta forma.");
  const [a, b] = axisPointsFromPath(path);
  const axis = new THREE.Vector2(b.x - a.x, b.y - a.y);
  if (axis.lengthSq() < EPS) axis.set(0, 1);
  axis.normalize();
  const normal = new THREE.Vector2(-axis.y, axis.x);
  const origin = new THREE.Vector2(a.x, a.y);
  const lathePoints = normalizedLoop(profile.points)
    .map((point) => {
      const relative = new THREE.Vector2(point.x, point.y).sub(origin);
      const radius = Math.abs(relative.dot(normal));
      const height = relative.dot(axis);
      return new THREE.Vector2(Math.max(radius, 1) * MM_TO_SCENE, height * MM_TO_SCENE);
    })
    .filter((point, index, points) => index === 0 || point.distanceTo(points[index - 1]) > EPS);
  const start = THREE.MathUtils.degToRad(Number(form.startAngle ?? 0));
  const end = THREE.MathUtils.degToRad(Number(form.endAngle ?? 360));
  const geometry = new THREE.LatheGeometry(lathePoints, Number(form.segments) || 48, start, end - start);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(axis.x, axis.y, 0).normalize());
  geometry.applyQuaternion(quaternion);
  geometry.translate(a.x * MM_TO_SCENE, a.y * MM_TO_SCENE, 0);
  return geometry;
}
function transformGeometryToWorkView(geometry, viewId = "front", offset = 0) {
  geometry.translate(0, 0, (Number(offset) || 0) * MM_TO_SCENE);
  const matrix = new THREE.Matrix4();
  if (viewId === "top") {
    matrix.set(
      1, 0, 0, 0,
      0, 0, 1, 0,
      0, 1, 0, 0,
      0, 0, 0, 1,
    );
    geometry.applyMatrix4(matrix);
  } else if (viewId === "right") {
    matrix.set(
      0, 0, 1, 0,
      0, 1, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 1,
    );
    geometry.applyMatrix4(matrix);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
function pathPoints(path) { return (path?.points?.length ? path.points : [{x:0,y:0,z:0},{x:0,y:800,z:0}]).map((p) => ({ x:p.x??0, y:p.y??0, z:p.z??0 })); }
function sweep(profile, path) { return sweepBetween(profile.points, profile.points, pathPoints(path)); }
function sweptBlend(profileA, profileB, path) { return sweepBetween(profileA.points, profileB.points, pathPoints(path)); }
function sweepBetween(pointsA, pointsB, path) {
  const n = Math.max(pointsA.length, pointsB.length, 12);
  const a = resampleLoop(pointsA, n); const b = rotateToBestMatch(a, resampleLoop(pointsB, n));
  const sections = path.map((_, i) => a.map((p, j) => ({ x: p.x + (b[j].x - p.x) * (i / Math.max(path.length - 1, 1)), y: p.y + (b[j].y - p.y) * (i / Math.max(path.length - 1, 1)) })));
  return loftSections(sections, path.map((p) => p.z * MM_TO_SCENE), path);
}
function loftSections(sections, zs, path = null) {
  const vertices = [], indices = [], n = sections[0].length;
  sections.forEach((sec, si) => sec.forEach((p) => vertices.push(p.x * MM_TO_SCENE + (path?.[si]?.x || 0) * MM_TO_SCENE, p.y * MM_TO_SCENE + (path?.[si]?.y || 0) * MM_TO_SCENE, zs[si])));
  for (let s = 0; s < sections.length - 1; s++) for (let i = 0; i < n; i++) indices.push(s*n+i, s*n+(i+1)%n, (s+1)*n+(i+1)%n, s*n+i, (s+1)*n+(i+1)%n, (s+1)*n+i);
  for (let i = 1; i < n-1; i++) indices.push(0, i, i+1, (sections.length-1)*n, (sections.length-1)*n+i+1, (sections.length-1)*n+i);
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
function buildBaseGeometry(form, p1, p2, path, params) {
  if (form.kind.includes("Blend") || form.kind === "blend" || form.kind === "voidBlend") return blend(p1, p2, form, params);
  if (form.kind.includes("Revolve") || form.kind === "revolve" || form.kind === "voidRevolve") return revolve(p1, form, path);
  if (form.kind.includes("SweptBlend") || form.kind === "sweptBlend" || form.kind === "voidSweptBlend") return sweptBlend(p1, p2, path);
  if (form.kind.includes("Sweep") || form.kind === "sweep" || form.kind === "voidSweep") return sweep(p1, path);
  return extrusion(p1, form, params);
}
export function buildGeometry(state, form) {
  const params = parameterMap(state), profiles = state.profiles;
  const p1 = profiles.find((p) => p.id === form.profileId);
  const p2 = profiles.find((p) => p.id === form.endProfileId) || p1;
  const path = state.paths?.find((p) => p.id === form.pathId);
  if (!p1) return null;
  let geometry = buildBaseGeometry(form, p1, p2, path, params);
  geometry = transformGeometryToWorkView(geometry, form.workPlane || p1.view, form.offset);
  const position = form.position || {};
  geometry.translate(
    (Number(position.x) || 0) * MM_TO_SCENE,
    (Number(position.y) || 0) * MM_TO_SCENE,
    (Number(position.z) || 0) * MM_TO_SCENE,
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  if (form.operation !== "void") {
    for (const cutterForm of collectVoidCutters(state, form)) {
      let cutterGeometry;
      try {
        cutterGeometry = buildGeometryCached(state, cutterForm);
      } catch (err) {
        console.warn(`Vazio "${cutterForm.name || cutterForm.id}" não pôde ser construído e foi ignorado ao cortar "${form.name || form.id}":`, err);
        continue;
      }
      if (!cutterGeometry || !boundsOverlap(geometry.boundingBox, cutterGeometry.boundingBox)) continue;
      geometry = subtractGeometry(geometry, cutterGeometry);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }
  }
  return geometry;
}

// Both the 2D projection (plan2d.js, redrawn on every pointermove) and the 3D
// mesh (scene3d.js, resynced on every store emit) call buildGeometry() for
// every visible form on every frame of an interaction - dragging one element
// used to rebuild the full extrusion/lathe/loft of every *other* form too.
// This cache keys a form's last-built geometry to a signature of everything
// buildGeometry() actually reads, so unrelated forms are skipped entirely and
// unchanged forms reuse the same THREE.BufferGeometry instance instead of
// rebuilding it, letting callers share one instance instead of each building
// (and disposing) their own throwaway copy.
const geometryCache = new Map();
// Everything a single form's own base geometry depends on - reused both for the
// form itself and (recursively, one level deep) for each void cutter, since a
// cutter's shape can now be any kind (revolve, sweep, ...), not just an extrusion.
function formSnapshot(state, form) {
  const profiles = state.profiles;
  const p1 = profiles.find((p) => p.id === form.profileId);
  const p2 = profiles.find((p) => p.id === form.endProfileId);
  const path = state.paths?.find((p) => p.id === form.pathId);
  return {
    kind: form.kind,
    depth: form.depth,
    distance: form.distance,
    offset: form.offset,
    workPlane: form.workPlane,
    startAngle: form.startAngle,
    endAngle: form.endAngle,
    segments: form.segments,
    position: form.position,
    p1: p1 ? { points: p1.points, holes: p1.holes, view: p1.view } : null,
    p2: p2 ? { points: p2.points, holes: p2.holes, view: p2.view } : null,
    path: path ? path.points : null,
  };
}
function geometrySignature(state, form) {
  const cutters = collectVoidCutters(state, form).map((f) => formSnapshot(state, f));
  return JSON.stringify({ self: formSnapshot(state, form), cutters, params: parameterMap(state) });
}
export function buildGeometryCached(state, form) {
  const signature = geometrySignature(state, form);
  const cached = geometryCache.get(form.id);
  if (cached && cached.signature === signature) return cached.geometry;
  const geometry = buildGeometry(state, form);
  if (cached) cached.geometry?.dispose();
  if (geometry) geometryCache.set(form.id, { signature, geometry });
  else geometryCache.delete(form.id);
  return geometry;
}
export function disposeCachedGeometry(formId) {
  const cached = geometryCache.get(formId);
  if (!cached) return;
  cached.geometry?.dispose();
  geometryCache.delete(formId);
}