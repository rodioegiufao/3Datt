import * as THREE from "three";
import { uuid, MM_TO_SCENE } from "./state.js";

const WEB_IFC_VERSION = "0.0.77";
const WEB_IFC_BASE = `https://cdn.jsdelivr.net/npm/web-ifc@${WEB_IFC_VERSION}/`;

let apiPromise = null;
function loadIfcApi() {
  if (!apiPromise) {
    apiPromise = (async () => {
      const WebIFC = await import(/* @vite-ignore */ `${WEB_IFC_BASE}web-ifc-api.js`);
      const api = new WebIFC.IfcAPI();
      api.SetWasmPath(WEB_IFC_BASE, true);
      await api.Init();
      return { WebIFC, api };
    })();
  }
  return apiPromise;
}

// --- Length unit handling -------------------------------------------------
// Our app works entirely in millimeters. IFC files declare their own length
// unit (this app's own exporter uses millimeters, but most real-world IFC
// files use meters), so every coordinate read from the file is scaled to mm
// before it touches app data.
function detectLengthUnitToMm(WebIFC, api, modelID) {
  try {
    const projects = api.GetLineIDsWithType(modelID, WebIFC.IFCPROJECT);
    if (projects.size() === 0) return 1;
    const project = api.GetLine(modelID, projects.get(0), true);
    const units = project?.UnitsInContext?.Units || [];
    for (const unit of units) {
      if (unit?.UnitType?.value !== "LENGTHUNIT") continue;
      const prefix = unit?.Prefix?.value;
      const name = unit?.Name?.value;
      if (name !== "METRE") continue;
      const prefixScale = { MILLI: 0.001, CENTI: 0.01, DECI: 0.1, KILO: 1000 }[prefix] ?? 1;
      return prefixScale * 1000; // metres-per-prefixed-unit * mm-per-metre
    }
  } catch {
    // fall through to the default below
  }
  return 1000; // no declared unit found: assume metres, the common IFC default
}

// --- IfcAxis2Placement3D -> 4x4 matrix (column-major, matches THREE.Matrix4) ---
function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function scale3(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function coords(pointOrDir, fallback) {
  const arr = pointOrDir?.Coordinates || pointOrDir?.DirectionRatios;
  if (!arr) return fallback;
  return arr.map((c) => (typeof c === "object" ? c.value : c));
}
function axis2Placement3DToMatrix(placement, lengthToMm) {
  const loc = (coords(placement?.Location, [0, 0, 0]).map((v) => v * lengthToMm));
  let zAxis = normalize3(coords(placement?.Axis, [0, 0, 1]));
  let xAxis = coords(placement?.RefDirection, [1, 0, 0]);
  xAxis = normalize3(sub3(xAxis, scale3(zAxis, dot3(xAxis, zAxis))));
  const yAxis = cross3(zAxis, xAxis);
  const m = new THREE.Matrix4();
  m.set(
    xAxis[0], yAxis[0], zAxis[0], loc[0],
    xAxis[1], yAxis[1], zAxis[1], loc[1],
    xAxis[2], yAxis[2], zAxis[2], loc[2],
    0, 0, 0, 1,
  );
  return m;
}
// Resolve an IfcLocalPlacement (already fetched with flatten:true) into a
// world-space matrix by walking PlacementRelTo up to the root. `flatten`
// resolves the immediate RelativePlacement but PlacementRelTo may come back
// as either an already-resolved object or a bare Handle depending on nesting
// depth, so each parent is re-fetched explicitly rather than trusted.
function resolveWorldMatrix(WebIFC, api, modelID, localPlacementId, lengthToMm) {
  let matrix = new THREE.Matrix4();
  let currentId = localPlacementId;
  let guard = 0;
  while (currentId != null && guard++ < 64) {
    const placement = api.GetLine(modelID, currentId, true);
    const local = axis2Placement3DToMatrix(placement.RelativePlacement, lengthToMm);
    matrix = local.multiply(matrix);
    const relTo = placement.PlacementRelTo;
    currentId = relTo == null ? null : typeof relTo === "number" ? relTo : relTo.value ?? relTo.expressID ?? null;
  }
  return matrix;
}

// A world matrix counts as "clean" when its rotation is (within tolerance)
// one of the axis-permutation states our app's own data model can represent
// (workPlane front/top/right, no continuous rotation support at all) - see
// geometry-engine.js's transformGeometryToWorkView. Anything else can't be
// reconstructed as an editable form; it's still shown via the reference mesh.
const WORKPLANE_ROTATIONS = {
  front: new THREE.Matrix4(),
  top: new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1),
  right: new THREE.Matrix4().set(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1),
};
function matchWorkPlane(matrix) {
  const rotation = new THREE.Matrix3().setFromMatrix4(matrix);
  for (const [workPlane, refMatrix] of Object.entries(WORKPLANE_ROTATIONS)) {
    const refRotation = new THREE.Matrix3().setFromMatrix4(refMatrix);
    let close = true;
    for (let i = 0; i < 9; i++) if (Math.abs(rotation.elements[i] - refRotation.elements[i]) > 1e-3) close = false;
    if (close) return workPlane;
  }
  return null;
}

// --- Profile extraction ----------------------------------------------------
// Only closed polylines (straight edges) are supported - IFCPOLYLINE for
// IFCARBITRARYCLOSEDPROFILEDEF/WITHVOIDS, or a rectangle profile. Anything
// with curved edges (circles, trimmed curves) is rejected for reconstruction.
function polylinePoints(curve, lengthToMm) {
  if (!curve || !Array.isArray(curve.Points)) return null;
  return curve.Points.map((p) => {
    const c = coords(p, null);
    return c ? { x: c[0] * lengthToMm, y: c[1] * lengthToMm } : null;
  }).filter(Boolean);
}
function dedupeClosingPoint(points) {
  if (points.length > 1) {
    const first = points[0], last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) return points.slice(0, -1);
  }
  return points;
}
function extractProfile(WebIFC, sweptArea, lengthToMm) {
  if (!sweptArea) return null;
  if (sweptArea.type === WebIFC.IFCRECTANGLEPROFILEDEF) {
    const xDim = (sweptArea.XDim?.value ?? sweptArea.XDim) * lengthToMm;
    const yDim = (sweptArea.YDim?.value ?? sweptArea.YDim) * lengthToMm;
    if (!(xDim > 0) || !(yDim > 0)) return null;
    const cx = xDim / 2, cy = yDim / 2;
    return { points: [{ x: -cx, y: -cy }, { x: cx, y: -cy }, { x: cx, y: cy }, { x: -cx, y: cy }], holes: [] };
  }
  if (sweptArea.type === WebIFC.IFCARBITRARYPROFILEDEFWITHVOIDS || sweptArea.type === WebIFC.IFCARBITRARYCLOSEDPROFILEDEF) {
    if (sweptArea.OuterCurve?.type !== WebIFC.IFCPOLYLINE) return null;
    const outer = dedupeClosingPoint(polylinePoints(sweptArea.OuterCurve, lengthToMm) || []);
    if (outer.length < 3) return null;
    const innerCurves = sweptArea.InnerCurves || [];
    const holes = [];
    for (const inner of innerCurves) {
      if (inner?.type !== WebIFC.IFCPOLYLINE) return null; // curved hole -> unsupported
      const hole = dedupeClosingPoint(polylinePoints(inner, lengthToMm) || []);
      if (hole.length < 3) return null;
      holes.push(hole);
    }
    return { points: outer, holes };
  }
  return null; // circle / composite / derived profiles: not supported
}

// Attempts to reconstruct one product as an editable {profile, form} pair.
// Returns null (never throws) if anything about it falls outside the narrow
// "simple extrusion, axis-aligned placement" case this editor can represent.
function tryReconstructProduct(WebIFC, api, modelID, product, lengthToMm) {
  try {
    const reps = product?.Representation?.Representations || [];
    const items = reps.flatMap((r) => r?.Items || []);
    if (items.length !== 1) return null;
    const solid = items[0];
    if (solid?.type !== WebIFC.IFCEXTRUDEDAREASOLID) return null;
    const direction = coords(solid.ExtrudedDirection, [0, 0, 1]);
    if (Math.hypot(direction[0], direction[1], direction[2] - 1) > 1e-3) return null; // must extrude along local +Z
    const depth = (solid.Depth?.value ?? solid.Depth) * lengthToMm;
    if (!(depth > 0)) return null;
    const profile = extractProfile(WebIFC, solid.SweptArea, lengthToMm);
    if (!profile) return null;

    // The solid's own Position offsets/rotates the profile within the
    // element's local frame. A 2D rotation there is folded directly into the
    // profile points (any 2D shape is representable); anything with a
    // non-planar tilt (Z axis not parallel to local Z) is rejected.
    let offsetZ = 0, points = profile.points, holes = profile.holes;
    if (solid.Position) {
      const zAxis = normalize3(coords(solid.Position.Axis, [0, 0, 1]));
      if (Math.hypot(zAxis[0], zAxis[1], zAxis[2] - 1) > 1e-3) return null;
      const loc = coords(solid.Position.Location, [0, 0, 0]).map((v) => v * lengthToMm);
      let xAxis = normalize3(coords(solid.Position.RefDirection, [1, 0, 0]));
      xAxis = normalize3(sub3(xAxis, scale3(zAxis, dot3(xAxis, zAxis))));
      const angle = Math.atan2(xAxis[1], xAxis[0]);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const applyLocal2D = (p) => ({ x: p.x * cos - p.y * sin + loc[0], y: p.x * sin + p.y * cos + loc[1] });
      points = points.map(applyLocal2D);
      holes = holes.map((loop) => loop.map(applyLocal2D));
      offsetZ = loc[2];
    }

    if (!product.ObjectPlacement) return null;
    const placementId = product.ObjectPlacement.expressID ?? product.ObjectPlacement.value;
    const worldMatrix = resolveWorldMatrix(WebIFC, api, modelID, placementId, lengthToMm);
    const workPlane = matchWorkPlane(worldMatrix);
    if (!workPlane) return null; // rotation this app's schema can't represent
    const position = new THREE.Vector3();
    worldMatrix.decompose(position, new THREE.Quaternion(), new THREE.Vector3());

    return {
      workPlane,
      position: { x: position.x, y: position.y, z: position.z },
      offset: offsetZ,
      depth,
      points,
      holes,
      name: product.Name?.value || null,
      color: readColor(product),
    };
  } catch {
    return null;
  }
}
function readColor() {
  return null; // styled-item color lookup is not implemented yet; default form color is used
}

// --- Reference mesh (always available, any IFC, any complexity) -----------
function buildReferenceGroup(api, modelID, lengthToMm) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: 0x9aa7ad, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false,
  });
  const scale = lengthToMm * MM_TO_SCENE;
  api.StreamAllMeshes(modelID, (mesh) => {
    const geometries = mesh.geometries;
    for (let i = 0; i < geometries.size(); i++) {
      const placed = geometries.get(i);
      const ifcGeometry = api.GetGeometry(modelID, placed.geometryExpressID);
      const vertexData = api.GetVertexArray(ifcGeometry.GetVertexData(), ifcGeometry.GetVertexDataSize());
      const indexData = api.GetIndexArray(ifcGeometry.GetIndexData(), ifcGeometry.GetIndexDataSize());
      if (!vertexData.length || !indexData.length) continue;
      const positions = new Float32Array((vertexData.length / 6) * 3);
      for (let v = 0, p = 0; v < vertexData.length; v += 6, p += 3) {
        positions[p] = vertexData[v]; positions[p + 1] = vertexData[v + 1]; positions[p + 2] = vertexData[v + 2];
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indexData), 1));
      geometry.computeVertexNormals();
      const m = placed.flatTransformation;
      const localMatrix = new THREE.Matrix4().set(
        m[0], m[4], m[8], m[12],
        m[1], m[5], m[9], m[13],
        m[2], m[6], m[10], m[14],
        m[3], m[7], m[11], m[15],
      );
      const meshObj = new THREE.Mesh(geometry, material);
      meshObj.applyMatrix4(localMatrix);
      meshObj.scale.multiplyScalar(scale);
      meshObj.position.multiplyScalar(scale);
      group.add(meshObj);
    }
  });
  return group;
}

function collectProducts(WebIFC, api, modelID) {
  const types = api.GetIfcEntityList(modelID).filter((t) => api.IsIfcElement(t));
  const products = [];
  for (const type of types) {
    const ids = api.GetLineIDsWithType(modelID, type);
    for (let i = 0; i < ids.size(); i++) products.push(ids.get(i));
  }
  return products;
}

// Parses an IFC file (ArrayBuffer/Uint8Array) and returns:
//  - referenceGroup: a THREE.Group with the full model geometry in world
//    space (scaled to the app's scene units), for visual tracing/reference.
//  - reconstructed: [{profile: {...}, form: {...}}] editable forms recovered
//    for products whose geometry was a single simple extrusion.
//  - stats: counts for a user-facing summary toast.
export async function importIfc(bytes) {
  const { WebIFC, api } = await loadIfcApi();
  const modelID = api.OpenModel(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  try {
    const lengthToMm = detectLengthUnitToMm(WebIFC, api, modelID);
    const products = collectProducts(WebIFC, api, modelID);
    const reconstructed = [];
    for (const id of products) {
      const product = api.GetLine(modelID, id, true);
      const result = tryReconstructProduct(WebIFC, api, modelID, product, lengthToMm);
      if (result) reconstructed.push(result);
    }
    const referenceGroup = buildReferenceGroup(api, modelID, lengthToMm);
    return {
      referenceGroup,
      reconstructed,
      stats: { totalProducts: products.length, reconstructedCount: reconstructed.length },
    };
  } finally {
    api.CloseModel(modelID);
  }
}

// Converts importIfc()'s `reconstructed` entries into {profiles, forms}
// ready for Store.importGeometry - each reconstructed item becomes one
// profile plus one solid extrusion form referencing it.
export function toStoreGeometry(reconstructed) {
  const profiles = [];
  const forms = [];
  for (const item of reconstructed) {
    const profileId = uuid("profile");
    profiles.push({
      id: profileId,
      name: item.name ? `${item.name} (IFC)` : "Perfil importado (IFC)",
      view: item.workPlane,
      points: item.points,
      holes: item.holes,
      visible: true,
      material: { color: "#8dd6c4" },
    });
    forms.push({
      id: uuid("form"),
      name: item.name || "Forma importada (IFC)",
      kind: "extrusion",
      operation: "solid",
      profileId,
      endProfileId: profileId,
      pathId: null,
      depth: item.depth,
      offset: item.offset,
      distance: item.depth,
      workPlane: item.workPlane,
      position: item.position,
      startAngle: 0,
      endAngle: 360,
      segments: 48,
      visible: true,
      material: { color: item.color || "#4aa3df" },
    });
  }
  return { profiles, forms };
}
