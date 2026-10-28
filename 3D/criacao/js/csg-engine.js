import { BufferAttribute, BufferGeometry, Matrix3, Matrix4, Mesh, Vector3 } from "three";

// Vendored BSP-tree CSG algorithm, adapted from three-csg-ts
// (https://github.com/samalexander/three-csg-ts, MIT license), itself a
// TypeScript port of Evan Wallace's original csg.js. Vendored (rather than
// loaded from a CDN) because three-csg-ts's published ESM build uses relative
// imports without file extensions (e.g. `from './CSG'`), which native browser
// ES modules refuse to resolve - and the alternative (jsDelivr's `+esm`
// auto-bundle) pulls in its own separate copy of three.js instead of the one
// already pinned by this project's importmap. This file imports "three"
// through that same importmap, so it shares the app's single three.js
// instance and needs no extra CDN entry.

class Vector {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new Vector(this.x, this.y, this.z); }
  negate() { this.x *= -1; this.y *= -1; this.z *= -1; return this; }
  add(a) { this.x += a.x; this.y += a.y; this.z += a.z; return this; }
  sub(a) { this.x -= a.x; this.y -= a.y; this.z -= a.z; return this; }
  times(a) { this.x *= a; this.y *= a; this.z *= a; return this; }
  dividedBy(a) { this.x /= a; this.y /= a; this.z /= a; return this; }
  lerp(a, t) { return this.add(new Vector().copy(a).sub(this).times(t)); }
  unit() { return this.dividedBy(this.length()); }
  length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); }
  normalize() { return this.unit(); }
  cross(b) {
    const ax = this.x, ay = this.y, az = this.z;
    const bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  dot(b) { return this.x * b.x + this.y * b.y + this.z * b.z; }
  toVector3() { return new Vector3(this.x, this.y, this.z); }
}

class Vertex {
  constructor(pos, normal, uv, color) {
    this.pos = new Vector().copy(pos);
    this.normal = new Vector().copy(normal);
    this.uv = new Vector().copy(uv);
    this.uv.z = 0;
    if (color) this.color = new Vector().copy(color);
  }
  clone() { return new Vertex(this.pos, this.normal, this.uv, this.color); }
  flip() { this.normal.negate(); }
  interpolate(other, t) {
    return new Vertex(
      this.pos.clone().lerp(other.pos, t),
      this.normal.clone().lerp(other.normal, t),
      this.uv.clone().lerp(other.uv, t),
      this.color && other.color && this.color.clone().lerp(other.color, t),
    );
  }
}

class Plane {
  constructor(normal, w) { this.normal = normal; this.w = w; }
  clone() { return new Plane(this.normal.clone(), this.w); }
  flip() { this.normal.negate(); this.w = -this.w; }
  splitPolygon(polygon, coplanarFront, coplanarBack, front, back) {
    const COPLANAR = 0, FRONT = 1, BACK = 2, SPANNING = 3;
    let polygonType = 0;
    const types = [];
    for (let i = 0; i < polygon.vertices.length; i++) {
      const t = this.normal.dot(polygon.vertices[i].pos) - this.w;
      const type = t < -Plane.EPSILON ? BACK : t > Plane.EPSILON ? FRONT : COPLANAR;
      polygonType |= type;
      types.push(type);
    }
    switch (polygonType) {
      case COPLANAR:
        (this.normal.dot(polygon.plane.normal) > 0 ? coplanarFront : coplanarBack).push(polygon);
        break;
      case FRONT:
        front.push(polygon);
        break;
      case BACK:
        back.push(polygon);
        break;
      case SPANNING: {
        const f = [], b = [];
        for (let i = 0; i < polygon.vertices.length; i++) {
          const j = (i + 1) % polygon.vertices.length;
          const ti = types[i], tj = types[j];
          const vi = polygon.vertices[i], vj = polygon.vertices[j];
          if (ti !== BACK) f.push(vi);
          if (ti !== FRONT) b.push(ti !== BACK ? vi.clone() : vi);
          if ((ti | tj) === SPANNING) {
            const t = (this.w - this.normal.dot(vi.pos)) / this.normal.dot(new Vector().copy(vj.pos).sub(vi.pos));
            const v = vi.interpolate(vj, t);
            f.push(v);
            b.push(v.clone());
          }
        }
        if (f.length >= 3) front.push(new Polygon(f, polygon.shared));
        if (b.length >= 3) back.push(new Polygon(b, polygon.shared));
        break;
      }
    }
  }
  static fromPoints(a, b, c) {
    const n = new Vector().copy(b).sub(a).cross(new Vector().copy(c).sub(a)).normalize();
    return new Plane(n.clone(), n.dot(a));
  }
}
Plane.EPSILON = 1e-5;

class Polygon {
  constructor(vertices, shared) {
    this.vertices = vertices;
    this.shared = shared;
    this.plane = Plane.fromPoints(vertices[0].pos, vertices[1].pos, vertices[2].pos);
  }
  clone() { return new Polygon(this.vertices.map((v) => v.clone()), this.shared); }
  flip() { this.vertices.reverse().map((v) => v.flip()); this.plane.flip(); }
}

class Node {
  constructor(polygons) {
    this.plane = null;
    this.front = null;
    this.back = null;
    this.polygons = [];
    if (polygons) this.build(polygons);
  }
  clone() {
    const node = new Node();
    node.plane = this.plane && this.plane.clone();
    node.front = this.front && this.front.clone();
    node.back = this.back && this.back.clone();
    node.polygons = this.polygons.map((p) => p.clone());
    return node;
  }
  invert() {
    for (let i = 0; i < this.polygons.length; i++) this.polygons[i].flip();
    this.plane && this.plane.flip();
    this.front && this.front.invert();
    this.back && this.back.invert();
    const temp = this.front;
    this.front = this.back;
    this.back = temp;
  }
  clipPolygons(polygons) {
    if (!this.plane) return polygons.slice();
    let front = [], back = [];
    for (let i = 0; i < polygons.length; i++) this.plane.splitPolygon(polygons[i], front, back, front, back);
    if (this.front) front = this.front.clipPolygons(front);
    back = this.back ? this.back.clipPolygons(back) : [];
    return front.concat(back);
  }
  clipTo(bsp) {
    this.polygons = bsp.clipPolygons(this.polygons);
    if (this.front) this.front.clipTo(bsp);
    if (this.back) this.back.clipTo(bsp);
  }
  allPolygons() {
    let polygons = this.polygons.slice();
    if (this.front) polygons = polygons.concat(this.front.allPolygons());
    if (this.back) polygons = polygons.concat(this.back.allPolygons());
    return polygons;
  }
  build(polygons) {
    if (!polygons.length) return;
    if (!this.plane) this.plane = polygons[0].plane.clone();
    const front = [], back = [];
    for (let i = 0; i < polygons.length; i++) this.plane.splitPolygon(polygons[i], this.polygons, this.polygons, front, back);
    if (front.length) { if (!this.front) this.front = new Node(); this.front.build(front); }
    if (back.length) { if (!this.back) this.back = new Node(); this.back.build(back); }
  }
}

class NBuf3 {
  constructor(count) { this.top = 0; this.array = new Float32Array(count); }
  write(v) { this.array[this.top++] = v.x; this.array[this.top++] = v.y; this.array[this.top++] = v.z; }
}
class NBuf2 {
  constructor(count) { this.top = 0; this.array = new Float32Array(count); }
  write(v) { this.array[this.top++] = v.x; this.array[this.top++] = v.y; }
}

class BSPSolid {
  constructor() { this.polygons = []; }
  static fromPolygons(polygons) { const s = new BSPSolid(); s.polygons = polygons; return s; }
  static fromGeometry(geom, objectIndex) {
    const posattr = geom.attributes.position;
    const normalattr = geom.attributes.normal;
    const uvattr = geom.attributes.uv;
    const colorattr = geom.attributes.color;
    const grps = geom.groups;
    let index;
    if (geom.index) index = geom.index.array;
    else {
      index = new Uint32Array((posattr.array.length / posattr.itemSize) | 0);
      for (let i = 0; i < index.length; i++) index[i] = i;
    }
    const triCount = (index.length / 3) | 0;
    const polys = new Array(triCount);
    for (let i = 0, pli = 0, l = index.length; i < l; i += 3, pli++) {
      const vertices = new Array(3);
      for (let j = 0; j < 3; j++) {
        const vi = index[i + j];
        const vp = vi * 3, vt = vi * 2;
        vertices[j] = new Vertex(
          new Vector(posattr.array[vp], posattr.array[vp + 1], posattr.array[vp + 2]),
          new Vector(normalattr.array[vp], normalattr.array[vp + 1], normalattr.array[vp + 2]),
          new Vector(uvattr?.array[vt], uvattr?.array[vt + 1], 0),
          colorattr && new Vector(colorattr.array[vp], colorattr.array[vp + 1], colorattr.array[vp + 2]),
        );
      }
      if (objectIndex === undefined && grps && grps.length > 0) {
        for (const grp of grps) if (i >= grp.start && i < grp.start + grp.count) polys[pli] = new Polygon(vertices, grp.materialIndex);
      } else {
        polys[pli] = new Polygon(vertices, objectIndex);
      }
    }
    return BSPSolid.fromPolygons(polys.filter((p) => p && !Number.isNaN(p.plane.normal.x)));
  }
  static toGeometry(solid, toMatrix) {
    let triCount = 0;
    const ps = solid.polygons;
    for (const p of ps) triCount += p.vertices.length - 2;
    const geom = new BufferGeometry();
    const vertices = new NBuf3(triCount * 3 * 3);
    const normals = new NBuf3(triCount * 3 * 3);
    const uvs = new NBuf2(triCount * 2 * 3);
    let colors;
    const grps = [], dgrp = [];
    for (const p of ps) {
      const pvs = p.vertices, pvlen = pvs.length;
      if (p.shared !== undefined && !grps[p.shared]) grps[p.shared] = [];
      if (pvlen && pvs[0].color !== undefined && !colors) colors = new NBuf3(triCount * 3 * 3);
      for (let j = 3; j <= pvlen; j++) {
        const grp = p.shared === undefined ? dgrp : grps[p.shared];
        grp.push(vertices.top / 3, vertices.top / 3 + 1, vertices.top / 3 + 2);
        vertices.write(pvs[0].pos); vertices.write(pvs[j - 2].pos); vertices.write(pvs[j - 1].pos);
        normals.write(pvs[0].normal); normals.write(pvs[j - 2].normal); normals.write(pvs[j - 1].normal);
        if (uvs) { uvs.write(pvs[0].uv); uvs.write(pvs[j - 2].uv); uvs.write(pvs[j - 1].uv); }
        if (colors) { colors.write(pvs[0].color); colors.write(pvs[j - 2].color); colors.write(pvs[j - 1].color); }
      }
    }
    geom.setAttribute("position", new BufferAttribute(vertices.array, 3));
    geom.setAttribute("normal", new BufferAttribute(normals.array, 3));
    if (uvs) geom.setAttribute("uv", new BufferAttribute(uvs.array, 2));
    if (colors) geom.setAttribute("color", new BufferAttribute(colors.array, 3));
    for (let gi = 0; gi < grps.length; gi++) if (grps[gi] === undefined) grps[gi] = [];
    if (grps.length) {
      let index = [], gbase = 0;
      for (let gi = 0; gi < grps.length; gi++) { geom.addGroup(gbase, grps[gi].length, gi); gbase += grps[gi].length; index = index.concat(grps[gi]); }
      geom.addGroup(gbase, dgrp.length, grps.length);
      index = index.concat(dgrp);
      geom.setIndex(index);
    }
    const inv = new Matrix4().copy(toMatrix).invert();
    geom.applyMatrix4(inv);
    geom.computeBoundingSphere();
    geom.computeBoundingBox();
    return geom;
  }
  static fromMesh(mesh, objectIndex) {
    const solid = BSPSolid.fromGeometry(mesh.geometry, objectIndex);
    const tmpV3 = new Vector3();
    const tmpM3 = new Matrix3().getNormalMatrix(mesh.matrix);
    for (const p of solid.polygons) {
      for (const v of p.vertices) {
        v.pos.copy(tmpV3.copy(v.pos.toVector3()).applyMatrix4(mesh.matrix));
        v.normal.copy(tmpV3.copy(v.normal.toVector3()).applyMatrix3(tmpM3));
      }
    }
    return solid;
  }
  static toMesh(solid, toMatrix, toMaterial) {
    const geom = BSPSolid.toGeometry(solid, toMatrix);
    const m = new Mesh(geom, toMaterial);
    m.matrix.copy(toMatrix);
    m.matrix.decompose(m.position, m.quaternion, m.scale);
    m.rotation.setFromQuaternion(m.quaternion);
    m.updateMatrixWorld();
    return m;
  }
  clone() {
    const s = new BSPSolid();
    s.polygons = this.polygons.map((p) => p.clone()).filter((p) => Number.isFinite(p.plane.w));
    return s;
  }
  subtract(other) {
    const a = new Node(this.clone().polygons);
    const b = new Node(other.clone().polygons);
    a.invert();
    a.clipTo(b);
    b.clipTo(a);
    b.invert();
    b.clipTo(a);
    b.invert();
    a.build(b.allPolygons());
    a.invert();
    return BSPSolid.fromPolygons(a.allPolygons());
  }
}

export const CSG_ENGINE_VERSION = "real-bsp-subtract-vendored-2026-09";

export function describeCsgStrategy() {
  return "CSG real via BSP (algoritmo vendorizado de three-csg-ts, MIT): cada vazio visível tem sua própria geometria 3D construída (extrusão, revolução, varredura etc.) e só é efetivamente subtraído de um sólido depois de uma checagem real de sobreposição de bounding box em 3D - funciona para qualquer combinação de tipos de forma sólida/vazia, não só extrusão cortando extrusão.";
}

// Any visible void form is a *candidate* cutter for a solid - the actual decision
// of whether it cuts anything happens later in geometry-engine.js, once both
// geometries exist, via boundsOverlap(). Filtering by profile/kind here (like the
// previous "voidExtrusion only, different profileId" heuristic) can't tell whether
// two shapes are actually anywhere near each other in space.
export function collectVoidCutters(state, solidForm) {
  if (!solidForm || solidForm.operation === "void") return [];
  return (state.forms || []).filter(
    (form) => form.id !== solidForm.id && form.visible !== false && form.operation === "void",
  );
}

export function boundsOverlap(a, b) {
  if (!a || !b) return false;
  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  );
}

// Subtracts `cutterGeometry` from `baseGeometry` and returns a brand-new
// geometry. `baseGeometry` is treated as consumed (disposed) since callers only
// ever pass an intermediate they're about to replace; `cutterGeometry` is left
// untouched since it's typically a shared/cached instance still needed for the
// void form's own (wireframe) rendering.
export function subtractGeometry(baseGeometry, cutterGeometry) {
  const identity = new Matrix4();
  const baseSolid = BSPSolid.fromMesh(new Mesh(baseGeometry));
  const cutterSolid = BSPSolid.fromMesh(new Mesh(cutterGeometry));
  const resultMesh = BSPSolid.toMesh(baseSolid.subtract(cutterSolid), identity);
  baseGeometry.dispose();
  return resultMesh.geometry;
}
