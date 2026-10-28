import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { buildGeometryCached, disposeCachedGeometry, isVoidKind } from "./geometry-engine.js";
import { MM_TO_SCENE } from "./state.js";
import { makeShapePoints, TWO_POINT_TOOLS, THREE_POINT_TOOLS } from "./draw-primitives.js";

// Segment-selection ("Selecionar linhas") is a 2D-canvas concept (it edits an
// existing profile's vertex chain via screen-space hit-testing in plan2d.js);
// the 3D view has no equivalent interaction, so it falls back to plain point
// placement there instead of doing nothing.
const DRAW_TOOL_MODES = {
  "pick-lines": "line",
};

const drawingMode = (tool) => DRAW_TOOL_MODES[tool] || tool;
const pointToScene = (p, view = "front") => {
  const x = p.x * MM_TO_SCENE, y = p.y * MM_TO_SCENE, z = 0;
  if (view === "top") return new THREE.Vector3(x, 0, p.y * MM_TO_SCENE);
  if (view === "right") return new THREE.Vector3(0, y, p.x * MM_TO_SCENE);
  return new THREE.Vector3(x, y, z);
};

export class Scene3D {
  constructor(canvas, store, { onError } = {}) {
    this.canvas = canvas;
    this.store = store;
    this.onError = onError || (() => {});
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf4f8f8);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000);
    this.camera.position.set(1.6, 1.4, 1.8);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.25, 0.25, 0);
    this.meshes = new Map();
    this.geometryErrors = new Set();
    this.points = [];
    this.preview = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.draftLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xff00cc }));
    this.viewCubeStage = null;
    this.moveDrag = null;
    this.typedDistance = "";
    this.referenceGroup = null;
    this.init();
    this.initViewCube();
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", () => { this.moveDrag = null; this.controls.enabled = true; });
    canvas.addEventListener("contextmenu", (e) => { if (this.s?.creationSession?.active) { e.preventDefault(); this.finish(); } });
    window.addEventListener("keydown", (e) => this.key(e));
    store.subscribe((s) => {
      this.s = s;
      this.sync();
      this.resize();
    });
    this.animate();
  }
  init() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const d = new THREE.DirectionalLight(0xffffff, 0.9);
    d.position.set(3, 5, 4);
    this.scene.add(d);
    this.scene.add(new THREE.GridHelper(2, 20, 0x8aa0a0, 0xd2dddd));
    this.scene.add(new THREE.AxesHelper(0.5));
    this.scene.add(this.draftLine);
  }
  // Shows imported-IFC geometry as a non-editable, non-store-tracked visual
  // backdrop (kept out of Store state entirely - it's a tracing aid, not
  // family data, so it doesn't participate in undo/redo or JSON export).
  // Pass `null` to remove it.
  setReferenceGroup(group) {
    if (this.referenceGroup) {
      this.scene.remove(this.referenceGroup);
      const disposedMaterials = new Set();
      this.referenceGroup.traverse((obj) => {
        obj.geometry?.dispose();
        if (obj.material && !disposedMaterials.has(obj.material)) {
          disposedMaterials.add(obj.material);
          obj.material.dispose();
        }
      });
    }
    this.referenceGroup = group;
    if (group) this.scene.add(group);
  }
  initViewCube() {
    const host = document.getElementById("viewCube");
    if (!host) return;
    host.innerHTML = `
      <div class="view-cube__axis view-cube__axis--x"></div>
      <div class="view-cube__axis view-cube__axis--y"></div>
      <div class="view-cube__axis view-cube__axis--z"></div>
      <div class="view-cube__stage">
        <button class="view-cube__face view-cube__face--front" data-cube-view="front" type="button">Frente</button>
        <button class="view-cube__face view-cube__face--back" data-cube-view="back" type="button">Atrás</button>
        <button class="view-cube__face view-cube__face--right" data-cube-view="right" type="button">Direita</button>
        <button class="view-cube__face view-cube__face--left" data-cube-view="left" type="button">Esquerda</button>
        <button class="view-cube__face view-cube__face--top" data-cube-view="top" type="button">Topo</button>
        <button class="view-cube__face view-cube__face--bottom" data-cube-view="bottom" type="button">Base</button>
      </div>`;
    this.viewCubeStage = host.querySelector(".view-cube__stage");
    host.addEventListener("pointerdown", (event) => event.stopPropagation());
    host.addEventListener("click", (event) => {
      const button = event.target.closest("[data-cube-view]");
      if (!button) return;
      event.preventDefault();
      event.stopPropagation();
      this.setCubeView(button.dataset.cubeView);
    });
  }
  setCubeView(view) {
    const target = this.controls.target.clone();
    const distance = Math.max(this.camera.position.distanceTo(target), 1.2);
    const directions = {
      front: new THREE.Vector3(0, -1, 0.42),
      back: new THREE.Vector3(0, 1, 0.42),
      right: new THREE.Vector3(1, 0, 0.42),
      left: new THREE.Vector3(-1, 0, 0.42),
      top: new THREE.Vector3(0, 0, 1),
      bottom: new THREE.Vector3(0, 0, -1)
    };
    const direction = (directions[view] || directions.front).normalize();
    this.camera.position.copy(target).add(direction.multiplyScalar(distance));
    this.camera.up.set(0, 0, view === "bottom" ? -1 : 1);
    if (view === "front" || view === "back" || view === "left" || view === "right") {
      this.camera.up.set(0, 0, 1);
    }
    this.controls.update();
  }
  updateViewCube() {
    if (!this.viewCubeStage) return;
    const euler = new THREE.Euler().setFromQuaternion(this.camera.quaternion, "YXZ");
    this.viewCubeStage.style.transform = `rotateX(${-THREE.MathUtils.radToDeg(euler.x)}deg) rotateY(${-THREE.MathUtils.radToDeg(euler.y)}deg) rotateZ(${THREE.MathUtils.radToDeg(euler.z)}deg)`;
  }
  resize() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(r.width, r.height, false);
  }
  orient(mesh) {
    mesh.rotation.set(0, 0, 0);
    mesh.position.set(0, 0, 0);
  }
  activeTool() { return drawingMode(this.s?.creationSession?.active ? this.s.creationSession.drawingTool : this.s?.activeTool); }
  plane() {
    if (this.s?.workView === "top") return new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    if (this.s?.workView === "right") return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
    return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  }
  toProfilePoint(v) {
    const mm = 1 / MM_TO_SCENE;
    if (this.s?.workView === "top") return { x: v.x * mm, y: v.z * mm };
    if (this.s?.workView === "right") return { x: v.z * mm, y: v.y * mm };
    return { x: v.x * mm, y: v.y * mm };
  }
  deltaForWorkView(delta) {
    if (this.s?.workView === "top") return { x: delta.x, y: 0, z: delta.y };
    if (this.s?.workView === "right") return { x: 0, y: delta.y, z: delta.x };
    return { x: delta.x, y: delta.y, z: 0 };
  }
  setPointer(event) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }
  worldPoint(event) {
    this.setPointer(event);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.plane(), hit) ? this.snap(this.toProfilePoint(hit), event.shiftKey).point : null;
  }
  snap(p, shift = false) {
    let q = { ...p };
    if (this.s.settings.snapEnabled) {
      const st = this.s.settings.snapStep;
      q = { x: Math.round(p.x / st) * st, y: Math.round(p.y / st) * st };
      for (const prof of this.s.profiles) for (const pt of prof.points) if (Math.hypot(pt.x - p.x, pt.y - p.y) < 18) q = { ...pt };
      this.points.forEach((pt) => { if (Math.hypot(pt.x - p.x, pt.y - p.y) < 18) q = { ...pt }; });
    }
    const last = this.points.at(-1);
    if ((this.s.settings.ortho || shift) && last) Math.abs(q.x - last.x) > Math.abs(q.y - last.y) ? (q.y = last.y) : (q.x = last.x);
    return { point: q };
  }
  key(e) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || this.s?.view === "plan") return;
    const isNumberKey = /^\d$/.test(e.key) || [",", ".", "Backspace"].includes(e.key);
    if (this.s?.creationSession?.active && this.points.length && isNumberKey) {
      e.preventDefault();
      if (e.key === "Backspace") this.typedDistance = this.typedDistance.slice(0, -1);
      else if ((e.key === "." || e.key === ",") && !/[.,]/.test(this.typedDistance)) this.typedDistance += ".";
      else if (/^\d$/.test(e.key)) this.typedDistance += e.key;
      this.applyTypedDistance();
      return;
    }
    if (this.s?.creationSession?.active && e.key === "Escape") {
      e.preventDefault();
      this.preview = null;
      this.typedDistance = "";
      this.store.setTemporaryPoints(this.currentDraft());
      this.syncDraft();
      this.store.setCreationDrawingTool("pick-lines");
      return;
    }
    if (this.s?.creationSession?.active && e.key === "Enter" && this.typedDistance && this.preview) {
      e.preventDefault();
      this.commitPreviewPoint();
    }
  }
  applyTypedDistance() {
    const distance = Number(this.typedDistance.replace(",", "."));
    const last = this.points.at(-1);
    if (!last || !Number.isFinite(distance)) return;
    const target = this.preview || { x: last.x + 1, y: last.y };
    const vx = target.x - last.x, vy = target.y - last.y;
    const len = Math.hypot(vx, vy) || 1;
    this.preview = { x: last.x + (vx / len) * distance, y: last.y + (vy / len) * distance };
    this.store.setTemporaryPoints(this.currentDraft());
    this.syncDraft();
  }
  commitPreviewPoint() {
    this.points.push({ ...this.preview });
    this.preview = null;
    this.typedDistance = "";
    const tool = this.activeTool();
    if (TWO_POINT_TOOLS.includes(tool) && this.points.length === 2) this.finish();
    if (THREE_POINT_TOOLS.includes(tool) && this.points.length === 3) this.finish();
    this.store.setTemporaryPoints(this.currentDraft());
    this.syncDraft();
  }
  down(e) {
    if (this.s?.view === "plan") return;
    if (!this.s?.creationSession?.active && this.activeTool() === "select") {
      this.setPointer(e);
      const hits = this.raycaster.intersectObjects([...this.meshes.values()], false);
      const hit = hits.find((h) => h.object.userData?.id);
      this.store.select(hit?.object.userData?.id || null);
      if (hit) {
        const point = this.worldPoint(e);
        if (point) {
          this.store.pushHistory();
          this.moveDrag = { id: hit.object.userData.id, last: point };
          this.controls.enabled = false;
          this.canvas.setPointerCapture?.(e.pointerId);
        }
      }
      return;
    }
    if (!this.s?.creationSession?.active) return;
    if (this.activeTool() === "select-segment") return;
    e.preventDefault(); e.stopPropagation();
    const point = this.worldPoint(e), tool = this.activeTool();
    if (!point) return;
    if (this.points.length > 2 && Math.hypot(point.x - this.points[0].x, point.y - this.points[0].y) < 15) return this.finish();
    this.points.push(point); this.preview = null; this.typedDistance = "";
    if (TWO_POINT_TOOLS.includes(tool) && this.points.length === 2) this.finish();
    if (THREE_POINT_TOOLS.includes(tool) && this.points.length === 3) this.finish();
    this.store.setTemporaryPoints(this.currentDraft());
    this.syncDraft();
  }
  move(e) {
    if (this.s?.view === "plan") return;
    if (this.moveDrag) {
      const point = this.worldPoint(e);
      if (!point) return;
      const delta = { x: point.x - this.moveDrag.last.x, y: point.y - this.moveDrag.last.y };
      if (Math.hypot(delta.x, delta.y) > 0) {
        this.store.moveElement(this.moveDrag.id, this.deltaForWorkView(delta), { history: false });
        this.moveDrag.last = point;
      }
      return;
    }
    if (!this.s?.creationSession?.active) return;
    const point = this.worldPoint(e);
    if (!point) return;
    this.preview = point;
    this.store.setTemporaryPoints(this.currentDraft());
    this.syncDraft();
  }
  hasDraft() { return this.points.length > 0 || !!this.preview; }
  currentDraft() { const pts = [...this.points]; if (this.preview) pts.push(this.preview); return this.makePrimitive(pts) || pts; }
  makePrimitive(pts, extra = {}) {
    const tool = this.activeTool();
    const sides = Number(document.querySelector("#polygonSides")?.value) || 6;
    return makeShapePoints(tool, pts, { sides, ...extra });
  }
  validate(points, closed) { if (points.length < (closed ? 3 : 2)) throw new Error(closed ? "Crie ao menos três pontos." : "Crie ao menos dois pontos."); }
  finish() { try { const cs = this.s.creationSession, step = cs?.step; if (!cs?.active) return; const closed = !["path","axis"].includes(step); let pts = this.makePrimitive(this.points, { closed }) || [...this.points]; this.validate(pts, closed); if (step === "path" || step === "axis") { const path=this.store.addPath(pts.map((p)=>({...p,z:0})),{name: step === "axis" ? "Eixo de revolução" : "Caminho"}); this.store.advanceCreationStep(step === "axis" ? {axisId:path.id,pathId:path.id}:{pathId:path.id}); } else { const color = cs.operation === "void" ? "#f36b2d" : "#ff00cc"; this.store.addProfile(pts,{name:"Perfil de criação",material:{color}}); this.store.advanceCreationStep({profileId:this.store.state.selectedElementId}); } this.points=[]; this.preview=null; this.typedDistance=""; this.syncDraft(); } catch (err) { this.onError(err.message); } }
  cancel() { this.points = []; this.preview = null; this.typedDistance = ""; this.syncDraft(); }
  cancelCurrentPrimitive() {
    this.points = [];
    this.preview = null;
    this.typedDistance = "";
    this.store.setTemporaryPoints([]);
    this.syncDraft();
  }
  syncDraft() {
    const pts = this.currentDraft().map((p) => pointToScene(p, this.s?.workView));
    if (pts.length && this.s?.creationSession?.active) {
      const closed = !["path", "axis"].includes(this.s.creationSession.step) && pts.length > 2;
      const linePts = closed ? [...pts, pts[0]] : pts;
      this.draftLine.geometry.dispose();
      this.draftLine.geometry = new THREE.BufferGeometry().setFromPoints(linePts);
      this.draftLine.material.color.set(this.s.creationSession.operation === "void" ? 0xf36b2d : 0xff00cc);
      this.draftLine.visible = true;
    } else {
      this.draftLine.visible = false;
    }
  }
  sync() {
    const visibleForms = (this.s.forms || this.s.extrusions || []).filter((e) => e.visible !== false);
    const valid = new Set(visibleForms.map((e) => e.id));
    for (const [id, m] of this.meshes) if (!valid.has(id)) {
      m.material.dispose(); this.scene.remove(m); this.meshes.delete(id);
      disposeCachedGeometry(id);
    }
    for (const form of visibleForms) {
      let geom = null;
      try {
        geom = buildGeometryCached(this.s, form);
        this.geometryErrors.delete(form.id);
      } catch (err) {
        if (!this.geometryErrors.has(form.id)) {
          this.geometryErrors.add(form.id);
          console.error(`Falha ao construir geometria de "${form.name || form.id}":`, err);
          this.onError(`Não foi possível gerar a geometria de "${form.name || "forma"}": ${err.message}`);
        }
        continue;
      }
      if (!geom) continue;
      let m = this.meshes.get(form.id);
      const isVoid = isVoidKind(form.kind);
      if (!m) {
        m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0.02, side: THREE.DoubleSide, transparent: isVoid, opacity: isVoid ? 0.28 : 1 }));
        this.scene.add(m); this.meshes.set(form.id, m);
      } else if (m.geometry !== geom) {
        // The cache already disposed the superseded geometry when it rebuilt;
        // just swap the reference here instead of disposing it again.
        m.geometry = geom;
      }
      m.userData.id = form.id;
      m.material.transparent = isVoid; m.material.opacity = isVoid ? 0.28 : 1; m.material.wireframe = isVoid;
      m.material.color.set(form.id === this.s.selectedElementId ? (isVoid ? 0xff7a2b : 0x54a7e8) : form.material?.color || (isVoid ? 0xf36b2d : 0x4aa3df));
      m.material.emissive.set(form.id === this.s.selectedElementId ? 0x123650 : 0x000000);
      this.orient(m, form);
    }
  }
  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.updateViewCube();
    this.renderer.render(this.scene, this.camera);
  }
}