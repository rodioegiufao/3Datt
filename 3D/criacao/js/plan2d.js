import { MM_TO_SCENE } from "./state.js";
import { buildGeometryCached, isVoidKind } from "./geometry-engine.js";
import { makeShapePoints, TWO_POINT_TOOLS, THREE_POINT_TOOLS } from "./draw-primitives.js";

const DRAW_TOOL_MODES = {
  "pick-lines": "select-segment",
};
const drawingMode = (tool) => DRAW_TOOL_MODES[tool] || tool;

const projectionPoint = (view, x, y, z) => {
  if (view === "top") return { x, y: z };
  if (view === "right") return { x: z, y };
  return { x, y };
};
export class Plan2D {
  constructor(canvas, store, { onStatus, onError }) {
Object.assign(this, { c: canvas, ctx: canvas.getContext("2d"), store, onStatus, onError, scale: 0.7, off: { x: 0, y: 0 }, points: [], completedLoops: [], preview: null, primitiveStart: 0, awaitingLineEndpoint: false, selectedSegment: null, lastTool: null, lastEditingProfileId: null, drag: null, editVertexDrag: null, moveDrag: null, typedDistance: "", geometryErrors: new Set() });
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", () => { this.drag = null; this.editVertexDrag = null; this.moveDrag = null; });
    canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); this.cancelCurrentPrimitive(); });
    window.addEventListener("keydown", (e) => this.key(e));
    store.subscribe((s) => {
      // `s` is the Store's single mutable state object, reused (not replaced) across
      // ordinary updates, so `this.s?.editingProfileId` here would already reflect the
      // *new* value by the time this listener runs. Track the previously-seen id in a
      // plain instance field instead - same pattern as `lastTool` below.
      const previousEditId = this.lastEditingProfileId;
      const previousTool = this.lastTool;
      this.s = s;
      const currentTool = this.activeTool();
      if (previousTool && currentTool !== previousTool) {
        this.primitiveStart = this.points.length;
        this.preview = null;
        this.awaitingLineEndpoint = false;
        this.selectedSegment = null;
      }
      this.lastTool = currentTool;
      if (s.editMode === "profileEdit" && s.editingProfileId && s.editingProfileId !== previousEditId) {
        const profile = s.profiles.find((p) => p.id === s.editingProfileId);
        this.points = profile ? profile.points.map((pt) => ({ ...pt })) : [];
        this.completedLoops = profile?.holes?.map((loop) => loop.map((pt) => ({ ...pt }))) || [];
        this.preview = null;
        this.awaitingLineEndpoint = false;
      }
      this.lastEditingProfileId = s.editingProfileId || null;
      this.draw();
    });
  }
  resize() { const r = this.c.getBoundingClientRect(), d = devicePixelRatio || 1; this.c.width = r.width * d; this.c.height = r.height * d; this.ctx.setTransform(d, 0, 0, d, 0, 0); if (!this.off.x) this.off = { x: r.width / 2, y: r.height / 2 }; this.draw(); }
  screen(p) { return { x: p.x * this.scale + this.off.x, y: this.off.y - p.y * this.scale }; }
  world(e) { const r = this.c.getBoundingClientRect(); return { x: (e.clientX - r.left - this.off.x) / this.scale, y: (this.off.y - (e.clientY - r.top)) / this.scale }; }
  activeTool() { return drawingMode(this.s.creationSession?.active ? this.s.creationSession.drawingTool : this.s.activeTool); }
  snap(p, shift = false) {
    let q = { ...p }, kind = "livre";
    if (this.s.settings.snapEnabled) {
      const st = this.s.settings.snapStep; q = { x: Math.round(p.x / st) * st, y: Math.round(p.y / st) * st }; kind = "grade";
      for (const prof of this.s.profiles) for (const pt of prof.points) if (Math.hypot(pt.x - p.x, pt.y - p.y) < 12 / this.scale) { q = { ...pt }; kind = "vértice"; }
      this.points.forEach((pt) => { if (Math.hypot(pt.x - p.x, pt.y - p.y) < 12 / this.scale) { q = { ...pt }; kind = "ponto"; } });
    }
    const last = this.points.at(-1); if ((this.s.settings.ortho || shift) && last) { Math.abs(q.x - last.x) > Math.abs(q.y - last.y) ? (q.y = last.y) : (q.x = last.x); kind += " orto"; }
    return { point: q, kind };
  }
  wheel(e) { e.preventDefault(); const b = this.world(e); this.scale = Math.min(3, Math.max(0.15, this.scale * (e.deltaY < 0 ? 1.1 : 0.9))); const a = this.world(e); this.off.x += (a.x - b.x) * this.scale; this.off.y -= (a.y - b.y) * this.scale; this.draw(); }
  isDrawing() { return this.s?.creationSession?.active || this.s?.editMode === "profileEdit" || ["line", "spline", ...TWO_POINT_TOOLS, ...THREE_POINT_TOOLS].includes(this.activeTool()); }
  key(e) {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || this.s?.view === "three") return;
    if ((e.key === "Delete" || e.key === "Backspace") && this.selectedSegment) {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.deleteSelectedSegment();
      return;
    }
    const isNumberKey = /^\d$/.test(e.key) || [",", ".", "Backspace"].includes(e.key);
    if (this.points.length && this.isDrawing() && isNumberKey) {
      e.preventDefault();
      if (e.key === "Backspace") this.typedDistance = this.typedDistance.slice(0, -1);
      else if ((e.key === "." || e.key === ",") && !/[.,]/.test(this.typedDistance)) this.typedDistance += ".";
      else if (/^\d$/.test(e.key)) this.typedDistance += e.key;
      this.applyTypedDistance();
      return;
    }
    if (e.key === "Escape" && this.s?.creationSession?.active) {
      e.preventDefault();
      this.activateSegmentSelection();
      return;
    }
    if (e.key === "Escape" && this.isDrawing() && (this.points.length || this.preview)) {
      e.preventDefault();
      this.cancelCurrentPrimitive();
      return;
    }
    if (e.key === "Enter" && this.typedDistance && this.preview) {
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
    this.onStatus(this.preview, distance, `distância ${distance} mm`);
    if (this.s.creationSession?.active) this.store.setTemporaryPoints(this.currentDraft());
    this.draw();
  }
  commitPreviewPoint() {
    const point = { ...this.preview };
    this.typedDistance = "";
    this.points.push(point);
    this.preview = null;
    const tool = this.activeTool();
    const primitiveCount = this.points.length - this.primitiveStart;
    const canKeepComposing = this.s.creationSession?.active || this.s.editMode === "profileEdit";
    if (TWO_POINT_TOOLS.includes(tool) && primitiveCount === 2) return canKeepComposing ? this.commitPrimitive() : this.finish();
    if (THREE_POINT_TOOLS.includes(tool) && primitiveCount === 3) return canKeepComposing ? this.commitPrimitive() : this.finish();
    if (this.s.creationSession?.active) this.store.setTemporaryPoints(this.currentDraft());
    this.draw();
  }
  down(e) {
    if (e.button === 1 || e.altKey) { this.drag = { x: e.clientX, y: e.clientY, off: { ...this.off } }; return; }
    const rawPoint = this.world(e), tool = this.activeTool();
    if (tool === "select-segment") {
      this.selectSegmentAt(rawPoint);
      return;
    }
    // A click on the body of an existing line ends line drawing and selects
    // that segment. Endpoints are ignored so the user can still close or
    // continue a contour normally.
    if (tool === "line" && this.segmentAt(rawPoint, { ignoreEndpoints: true })) {
      this.activateSegmentSelection();
      this.selectSegmentAt(rawPoint);
      return;
    }
    if (tool === "line" && this.awaitingLineEndpoint) {
      const endpoint = this.lineEndpointAt(rawPoint);
      if (!endpoint) {
        this.onError("Clique em uma das extremidades da linha para continuar.");
        return;
      }
      if (endpoint === "start") this.points.reverse();
      this.primitiveStart = this.points.length;
      this.awaitingLineEndpoint = false;
      this.preview = null;
      this.typedDistance = "";
      this.draw();
      return;
    }
    const { point } = this.snap(rawPoint, e.shiftKey);
    if (this.s.editMode === "profileEdit") {
      if (e.button === 2) return;
      const hit = this.points.findIndex((pt) => Math.hypot(pt.x - point.x, pt.y - point.y) < 14 / this.scale);
      if (hit >= 0) { this.editVertexDrag = hit; return; }
    }
    if (tool === "select") {
      const picked = this.pick(point);
      if (picked) {
        this.store.pushHistory();
        this.moveDrag = { id: picked, last: point };
        this.c.setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (this.points.length > 2 && Math.hypot(point.x - this.points[0].x, point.y - this.points[0].y) < 15 / this.scale) {
      // For open-ended tools like "spline" the raw clicked points are only
      // control points - the actual shape is the smoothed curve through them
      // (matching the live preview drawn while composing it), so smooth here
      // too rather than closing the loop with straight segments between raw
      // clicks. Fixed-point-count tools (rectangle/circle/arc3/...) never
      // reach this branch - they auto-commit at their point count instead.
      const closedLoop = this.makePrimitive(this.points, { closed: true }) || this.points;
      this.validate(closedLoop, true);
      this.completedLoops.push(closedLoop.map((pt) => ({ ...pt })));
      this.points = [];
      this.preview = null;
      this.primitiveStart = 0;
      this.awaitingLineEndpoint = false;
      this.typedDistance = "";
      this.onStatus(point, 0, "contorno fechado — desenhe outro ou finalize");
      if (this.s.creationSession?.active) this.store.setTemporaryPoints([]);
      return this.draw();
    }
    this.points.push(point); this.preview = null; this.typedDistance = "";
    const primitiveCount = this.points.length - this.primitiveStart;
    const canKeepComposing = this.s.creationSession?.active || this.s.editMode === "profileEdit";
    if (TWO_POINT_TOOLS.includes(tool) && primitiveCount === 2) {
      if (canKeepComposing) this.commitPrimitive();
      else this.finish();
      return;
    }
    if (THREE_POINT_TOOLS.includes(tool) && primitiveCount === 3) {
      if (canKeepComposing) this.commitPrimitive();
      else this.finish();
      return;
    }
    if (this.s.creationSession?.active) this.store.setTemporaryPoints(this.currentDraft());
    this.draw();
  }
  move(e) { if (this.drag) { this.off = { x: this.drag.off.x + e.clientX - this.drag.x, y: this.drag.off.y + e.clientY - this.drag.y }; return this.draw(); } const raw = this.world(e); if (this.awaitingLineEndpoint) { this.preview = null; const endpoint = this.lineEndpointAt(raw); this.onStatus(raw, 0, endpoint ? "extremidade" : "selecione uma extremidade"); return this.draw(); } const sn = this.snap(raw, e.shiftKey); if (this.moveDrag) { const delta2 = { x: sn.point.x - this.moveDrag.last.x, y: sn.point.y - this.moveDrag.last.y }; if (Math.hypot(delta2.x, delta2.y) > 0) { this.store.moveElement(this.moveDrag.id, this.deltaForWorkView(delta2), { history: false }); this.moveDrag.last = sn.point; } this.onStatus(sn.point, 0, sn.kind); return; } if (this.editVertexDrag !== null) { this.points[this.editVertexDrag] = sn.point; this.preview = null; this.onStatus(sn.point, 0, sn.kind); return this.draw(); } this.preview = sn.point; const last = this.points.at(-1); this.onStatus(sn.point, last ? Math.hypot(sn.point.x - last.x, sn.point.y - last.y) : 0, sn.kind); if (this.s.creationSession?.active) this.store.setTemporaryPoints(this.currentDraft()); this.draw(); }
  lineEndpointAt(point) {
    if (this.points.length < 2) return null;
    const tolerance = 15 / this.scale;
    if (Math.hypot(point.x - this.points[0].x, point.y - this.points[0].y) <= tolerance) return "start";
    const end = this.points.at(-1);
    return Math.hypot(point.x - end.x, point.y - end.y) <= tolerance ? "end" : null;
  }
  selectSegmentAt(point) {
    this.selectedSegment = this.segmentAt(point);
    this.preview = null;
    this.onStatus(point, 0, this.selectedSegment ? "linha selecionada — pressione Delete ou use Excluir linha" : "nenhuma linha selecionada");
    this.draw();
  }
  segmentAt(point, { ignoreEndpoints = false } = {}) {
    let best = null;
    const inspect = (loop, loopIndex, closed) => {
      if (loop.length < 2) return;
      const segmentCount = closed ? loop.length : loop.length - 1;
      for (let i = 0; i < segmentCount; i++) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        if (ignoreEndpoints) {
          const endpointTolerance = 15 / this.scale;
          if (Math.hypot(point.x - a.x, point.y - a.y) <= endpointTolerance || Math.hypot(point.x - b.x, point.y - b.y) <= endpointTolerance) continue;
        }
        const distance = this.pointSegmentDistance(point, a, b);
        if (!best || distance < best.distance) best = { loopIndex, segmentIndex: i, distance };
      }
    };
    this.completedLoops.forEach((loop, index) => inspect(loop, index, true));
    inspect(this.points, -1, false);
    return best?.distance <= 14 / this.scale ? best : null;
  }
  activateSegmentSelection() {
    this.preview = null;
    this.typedDistance = "";
    this.awaitingLineEndpoint = false;
    this.primitiveStart = this.points.length;
    this.store.setCreationDrawingTool("pick-lines");
    if (this.s?.creationSession?.active) this.store.setTemporaryPoints(this.currentDraft());
    this.onStatus(this.points.at(-1) || { x: 0, y: 0 }, 0, "desenho desativado — selecione a linha desejada");
    this.draw();
  }
  deleteSelectedSegment() {
    const selected = this.selectedSegment;
    if (!selected) {
      this.onError("Selecione primeiro a linha que deseja apagar.");
      return false;
    }
    const loop = selected.loopIndex < 0 ? this.points : this.completedLoops[selected.loopIndex];
    if (!loop || loop.length < 3) {
      this.onError("O contorno precisa manter ao menos dois segmentos.");
      return false;
    }
    // Rotate the former closed loop so that the removed edge becomes the gap
    // between the last and first point. Either point can then start the repair.
    const start = (selected.segmentIndex + 1) % loop.length;
    this.points = Array.from({ length: loop.length }, (_, offset) => ({ ...loop[(start + offset) % loop.length] }));
    if (selected.loopIndex >= 0) this.completedLoops.splice(selected.loopIndex, 1);
    this.store.setCreationDrawingTool("line");
    this.selectedSegment = null;
    this.preview = null;
    this.primitiveStart = this.points.length;
    this.awaitingLineEndpoint = true;
    this.typedDistance = "";
    if (this.s?.creationSession?.active) this.store.setTemporaryPoints(this.points);
    this.onStatus(this.points[0], 0, "linha apagada — clique em qualquer ponta para desenhar a substituta");
    this.draw();
    return true;
  }
  deltaForWorkView(delta) {
    if (this.s.workView === "top") return { x: delta.x, y: 0, z: delta.y };
    if (this.s.workView === "right") return { x: 0, y: delta.y, z: delta.x };
    return { x: delta.x, y: delta.y, z: 0 };
  }
  currentDraft() { const pts = [...this.points]; if (this.preview) pts.push(this.preview); return this.composePrimitive(pts); }
  composePrimitive(pts, extra = {}) {
    const start = Math.min(this.primitiveStart || 0, pts.length);
    const head = pts.slice(0, start), tail = pts.slice(start);
    const primitive = this.makePrimitive(tail, extra);
    return primitive ? head.concat(primitive) : pts;
  }
  commitPrimitive() {
    const primitive = this.currentDraft().map((p) => ({ ...p }));
    this.validate(primitive, true);
    this.completedLoops.push(primitive);
    this.points = [];
    this.preview = null;
    this.primitiveStart = 0;
    if (this.s.creationSession?.active) this.store.setTemporaryPoints([]);
    this.draw();
  }
  cancelCurrentPrimitive() {
    const start = Math.min(this.primitiveStart || 0, this.points.length);
    this.points = this.points.slice(0, start);
    this.primitiveStart = this.points.length;
    this.awaitingLineEndpoint = false;
    this.preview = null;
    this.typedDistance = "";
    this.editVertexDrag = null;
    if (this.s?.creationSession?.active) this.store.setTemporaryPoints(this.currentDraft());
    this.draw();
  }
  makePrimitive(pts, extra = {}) {
    const tool = this.activeTool();
    const sides = Number(document.querySelector("#polygonSides")?.value) || 6;
    return makeShapePoints(tool, pts, { sides, ...extra });
  }
  validate(points, closed) { if (points.length < (closed ? 3 : 2)) throw new Error(closed ? "Crie ao menos três pontos." : "Crie ao menos dois pontos."); for (let i=1;i<points.length;i++) if (Math.hypot(points[i].x-points[i-1].x, points[i].y-points[i-1].y) < 1e-6) throw new Error("Remova pontos consecutivos duplicados."); if (closed) for (let i=0;i<points.length;i++) for (let j=i+1;j<points.length;j++) { if (Math.abs(i-j)<2 || (i===0 && j===points.length-1)) continue; if (this.intersects(points[i], points[(i+1)%points.length], points[j], points[(j+1)%points.length])) throw new Error("Perfil com auto-interseção."); } }
  intersects(a,b,c,d){ const ccw=(p,q,r)=>(r.y-p.y)*(q.x-p.x)>(q.y-p.y)*(r.x-p.x); return ccw(a,c,d)!==ccw(b,c,d)&&ccw(a,b,c)!==ccw(a,b,d); }
  finish() { try { const cs = this.s.creationSession, step = cs?.step; const tool = this.activeTool(); const closed = !cs || !["path","axis"].includes(step); let pts = this.composePrimitive(this.points, { closed }); const loops = closed ? [...this.completedLoops, ...(pts.length ? [pts] : [])] : []; if (closed) { if (!loops.length) throw new Error("Crie ao menos três pontos."); loops.forEach((loop) => this.validate(loop, true)); loops.sort((a, b) => Math.abs(this.loopArea(b)) - Math.abs(this.loopArea(a))); pts = loops[0]; } else this.validate(pts, false); const holes = closed ? loops.slice(1) : []; if (this.s.editMode === "profileEdit") { this.store.finishProfileEdit(pts, holes); this.resetDraft(); this.draw(); return; } if (cs?.active) { const color = cs.operation === "void" ? "#f36b2d" : "#ff00cc"; if (step === "path" || step === "axis") { const path=this.store.addPath(pts.map((p)=>({...p,z:0})),{name: step === "axis" ? "Eixo de revolução" : "Caminho"}); this.store.advanceCreationStep(step === "axis" ? {axisId:path.id,pathId:path.id}:{pathId:path.id}); } else { this.store.addProfile(pts,{holes,name:"Perfil de criação",material:{color}}); try { this.store.advanceCreationStep({profileId:this.store.state.selectedElementId}); } catch (err) { this.onError(err.message); } } } else if (tool === "line") this.store.addPath(pts.map((p)=>({...p,z:0}))); else this.store.addProfile(pts,{holes}); this.resetDraft(); this.draw(); } catch (err) { this.onError(err.message); } }
  loopArea(points) { return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]; return sum + p.x * q.y - q.x * p.y; }, 0) / 2; }
  resetDraft() { this.points=[]; this.completedLoops=[]; this.preview=null; this.primitiveStart=0; this.awaitingLineEndpoint=false; this.selectedSegment=null; this.typedDistance=""; }
  cancel() { this.resetDraft(); this.editVertexDrag = null; if (this.s?.editMode === "profileEdit") this.store.cancelProfileEdit(); if (this.s?.creationSession?.active) this.store.cancelCreationSession(); this.draw(); }
  pointSegmentDistance(p, a, b) { const vx=b.x-a.x, vy=b.y-a.y, len=vx*vx+vy*vy || 1; const t=Math.max(0,Math.min(1,((p.x-a.x)*vx+(p.y-a.y)*vy)/len)); return Math.hypot(p.x-(a.x+vx*t), p.y-(a.y+vy*t)); }
  pick(p) {
    let best=null, bd=1e9;
    for (const form of (this.s.forms||this.s.extrusions||[]).filter((f)=>f.visible!==false)) for (const [a,b] of this.projectedSegments(form)) { const d=this.pointSegmentDistance(p,a,b); if(d<bd){bd=d; best=form;} }
    for (const path of (this.s.paths||[]).filter((x)=>x.visible!==false)) for (let i=1;i<path.points.length;i++) { const d=this.pointSegmentDistance(p,path.points[i-1],path.points[i]); if(d<bd){bd=d; best=path;} }
    for (const prof of this.s.profiles.filter((x)=>x.visible!==false&&x.view===this.s.workView)) for (const pt of prof.points) { const d=Math.hypot(pt.x-p.x,pt.y-p.y); if(d<bd){bd=d; best=prof;} }
    this.store.select(bd < 25 / this.scale ? best?.id || null : null);
    return bd < 25 / this.scale ? best?.id || null : null;
  }
  drawPoly(points, close, color, selected = false, stroke = null) { const ctx=this.ctx; if(!points.length) return; ctx.beginPath(); points.map((p)=>this.screen(p)).forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y)); if(close) ctx.closePath(); ctx.fillStyle=color; ctx.strokeStyle=stroke || (selected ? "#0a5fb4" : "#2d4b55"); ctx.lineWidth=selected?3:2; if(close) ctx.fill(); ctx.stroke(); }
  projectedSegments(form) {
    let geom = null;
    try {
      geom = buildGeometryCached(this.s, form);
      this.geometryErrors.delete(form.id);
    } catch (err) {
      if (!this.geometryErrors.has(form.id)) {
        this.geometryErrors.add(form.id);
        console.error(`Falha ao construir geometria de "${form.name || form.id}":`, err);
        this.onError?.(`Não foi possível gerar a geometria de "${form.name || "forma"}": ${err.message}`);
      }
      return [];
    }
    const pos = geom?.attributes?.position;
    if (!pos) return [];
    const index = geom.index?.array;
    const edgeKeys = new Set(), segments = [];
    const read = (i) => projectionPoint(this.s.workView, pos.getX(i) / MM_TO_SCENE, pos.getY(i) / MM_TO_SCENE, pos.getZ(i) / MM_TO_SCENE);
    const add = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      const p = read(a), q = read(b);
      if (Math.hypot(p.x - q.x, p.y - q.y) > 0.01) segments.push([p, q]);
    };
    if (index) for (let i = 0; i < index.length; i += 3) { add(index[i], index[i + 1]); add(index[i + 1], index[i + 2]); add(index[i + 2], index[i]); }
    else for (let i = 0; i < pos.count; i += 3) { add(i, i + 1); add(i + 1, i + 2); add(i + 2, i); }
    // `geom` is a shared, cached instance (also used by Scene3D for the live
    // mesh) - it must not be disposed here; the cache disposes it centrally
    // once it's actually superseded or the form is deleted.
    return segments;
  }
  drawProjection(form) {
    const ctx = this.ctx, isVoid = isVoidKind(form.kind), selected = form.id === this.s.selectedElementId;
    ctx.save(); ctx.strokeStyle = selected ? (isVoid ? "#d95b18" : "#0a5fb4") : (isVoid ? "#f36b2d99" : "#225b7a66"); ctx.lineWidth = selected ? 2.5 : 1.4; ctx.setLineDash(isVoid ? [7, 5] : []);
    this.projectedSegments(form).forEach(([a,b]) => { const p=this.screen(a), q=this.screen(b); ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y); ctx.stroke(); });
    ctx.restore();
  }
  drawSelectedSegment() {
    if (!this.selectedSegment) return;
    const { loopIndex, segmentIndex } = this.selectedSegment;
    const loop = loopIndex < 0 ? this.points : this.completedLoops[loopIndex];
    if (!loop?.length) return;
    const a = this.screen(loop[segmentIndex]);
    const b = this.screen(loop[(segmentIndex + 1) % loop.length]);
    this.ctx.save();
    this.ctx.strokeStyle = "#e53935";
    this.ctx.lineWidth = 5;
    this.ctx.beginPath();
    this.ctx.moveTo(a.x, a.y);
    this.ctx.lineTo(b.x, b.y);
    this.ctx.stroke();
    this.ctx.restore();
  }
  draw() { if(!this.s) return; const r=this.c.getBoundingClientRect(), ctx=this.ctx; ctx.clearRect(0,0,r.width,r.height); if(this.s.settings.showGrid){ const minor=this.s.settings.snapStep*this.scale, major=this.s.settings.majorGrid*this.scale; ctx.lineWidth=1; for(const [st,col] of [[minor,"#edf2f2"],[major,"#cad8d8"]]){ ctx.strokeStyle=col; for(let x=this.off.x%st;x<r.width;x+=st){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,r.height);ctx.stroke();} for(let y=this.off.y%st;y<r.height;y+=st){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(r.width,y);ctx.stroke();}} } const o=this.screen({x:0,y:0}); ctx.strokeStyle="#b55"; ctx.beginPath(); ctx.moveTo(o.x-10,o.y);ctx.lineTo(o.x+10,o.y);ctx.moveTo(o.x,o.y-10);ctx.lineTo(o.x,o.y+10);ctx.stroke(); (this.s.forms||this.s.extrusions||[]).filter((f)=>f.visible!==false).forEach((f)=>this.drawProjection(f)); (this.s.paths||[]).filter((p)=>p.visible!==false).forEach((path)=>this.drawPoly(path.points,false,path.id===this.s.selectedElementId?"#f6a13a88":"#f6a13a55",path.id===this.s.selectedElementId)); this.s.profiles.filter((p)=>p.visible!==false&&p.view===this.s.workView).forEach((p)=>{ this.drawPoly(p.points,true,p.id===this.s.selectedElementId?"#76b7f055":"#8dd6c455",p.id===this.s.selectedElementId); (p.holes||[]).forEach((loop)=>this.drawPoly(loop,true,"#fff",p.id===this.s.selectedElementId)); }); this.completedLoops.forEach((loop)=>this.drawPoly(loop,true,"#ff00cc11",true,this.s.creationSession?.operation==="void"?"#f36b2d":"#ff00cc")); const draft=this.currentDraft(); this.drawPoly(draft,false,"#ff00cc22",true,this.s.creationSession?.operation==="void"?"#f36b2d":"#ff00cc"); if(this.preview){ const sp=this.screen(this.preview); ctx.fillStyle="#ff00cc"; ctx.beginPath(); ctx.arc(sp.x,sp.y,4,0,Math.PI*2); ctx.fill(); } this.drawSelectedSegment(); }
}