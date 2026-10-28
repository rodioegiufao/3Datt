export const STORAGE_KEY = "engrodrigo-family-studio-v1";
export const MM_TO_SCENE = 0.001;
export const UNIT = "mm";

const now = () => new Date().toISOString();
const clone = (value) => structuredClone(value);

export const CATEGORIES = [
  "Mobiliário",
  "Equipamento",
  "Modelo genérico",
  "Esquadria",
  "Hidrossanitário",
];
export const VIEWS = [
  { id: "front", name: "Frontal", plane: "XY" },
  { id: "top", name: "Superior", plane: "XZ" },
  { id: "right", name: "Lateral", plane: "YZ" },
];

export function uuid(prefix = "id") {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
export function createInitialState() {
  return {
    format: "engrodrigo-family-json",
    formatVersion: 2,
    appName: "EngRodrigo Family Studio",
    name: "Nova família paramétrica",
    category: "Mobiliário",
    createdAt: now(),
    updatedAt: now(),
    activeTool: "select",
    editMode: null,
    editingProfileId: null,
    creationSession: {
      active: false,
      formType: null,
      operation: null,
      step: null,
      stepIndex: 0,
      drawingTool: null,
      temporaryPoints: [],
      profileIds: [],
      pathId: null,
      axisId: null,
    },
    view: "split",
    workView: "front",
    selectedElementId: null,
    settings: {
      snapStep: 10,
      majorGrid: 100,
      snapEnabled: true,
      showGrid: true,
      ortho: false,
    },
    parameters: [
      { id: uuid("param"), name: "Largura", value: 600, unit: UNIT },
      { id: uuid("param"), name: "Profundidade", value: 400, unit: UNIT },
      { id: uuid("param"), name: "Altura", value: 800, unit: UNIT },
      { id: uuid("param"), name: "Espessura", value: 20, unit: UNIT },
    ],
    types: [
      {
        id: uuid("type"),
        name: "Padrão",
        values: { Largura: 600, Profundidade: 400, Altura: 800, Espessura: 20 },
      },
    ],
    currentTypeId: null,
    referencePlanes: [
      {
        id: "ref-center-v",
        name: "Centro vertical",
        view: "front",
        axis: "x",
        offset: 0,
        visible: true,
      },
      {
        id: "ref-base",
        name: "Base",
        view: "front",
        axis: "y",
        offset: 0,
        visible: true,
      },
    ],
    profiles: [],
    paths: [],
    forms: [],
    extrusions: [],
    history: { undo: [], redo: [] },
  };
}
export function parameterMap(state) {
  return Object.fromEntries(
    state.parameters.map((p) => [p.name, Number(p.value) || 0]),
  );
}
export function evalValue(value, params = {}) {
  if (typeof value === "number") return value;
  const text = String(value ?? "0").trim();
  if (!text) return 0;
  if (Object.prototype.hasOwnProperty.call(params, text)) return params[text];
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}
export function pointTo3D(point, viewId, depth = 0) {
  if (viewId === "top") return { x: point.x, y: depth, z: point.y };
  if (viewId === "right") return { x: depth, y: point.y, z: point.x };
  return { x: point.x, y: point.y, z: depth };
}
export function profileBounds(points) {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

export class Store {
  constructor() {
    this.state = createInitialState();
    this.state.currentTypeId = this.state.types[0].id;
    this.listeners = new Set();
  }
  subscribe(fn) {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.state.updatedAt = now();
    this.listeners.forEach((fn) => fn(this.state));
  }
  snapshot() {
    const s = clone(this.state);
    s.history = { undo: [], redo: [] };
    return s;
  }
  pushHistory() {
    this.state.history.undo.push(this.snapshot());
    if (this.state.history.undo.length > 80) this.state.history.undo.shift();
    this.state.history.redo = [];
  }
  set(partial, { history = false } = {}) {
    if (history) this.pushHistory();
    Object.assign(this.state, partial);
    this.emit();
  }
  updateSettings(p) {
    this.set({ settings: { ...this.state.settings, ...p } });
  }
  addProfile(points, patch = {}) {
    this.pushHistory();
    const item = {
      id: uuid("profile"),
      name: `Perfil ${this.state.profiles.length + 1}`,
      view: this.state.workView,
      points,
      visible: true,
      material: { color: "#8dd6c4" },
      ...patch,
    };
    this.state.profiles.push(item);
    this.state.selectedElementId = item.id;
    this.emit();
  }
  addPath(points, patch = {}) {
    this.pushHistory();
    const item = { id: uuid("path"), name: `Caminho ${this.state.paths.length + 1}`, points, visible: true, ...patch };
    this.state.paths.push(item);
    this.state.selectedElementId = item.id;
    this.emit();
    return item;
  }
  // Merges pre-built profile/form objects (already carrying their own ids and
  // full field sets, e.g. from ifc-importer.js) into the current family as one
  // undoable step - unlike addProfile/addForm, which build a single new item
  // from scratch and auto-select it.
  importGeometry(profiles, forms) {
    if (!profiles.length && !forms.length) return;
    this.pushHistory();
    this.state.profiles.push(...profiles);
    this.state.forms.push(...forms);
    this.emit();
  }
  addForm(kind, options = {}) {
    const solid = options.operation ? options.operation === "solid" : !String(kind).startsWith("void");
    const profile = this.state.profiles.find((p) => p.id === (options.profileId || this.state.selectedElementId)) || this.state.profiles[0];
    if (!profile) return null;
    this.pushHistory();
    const item = {
      id: uuid("form"), name: `${solid ? "Forma" : "Vazio"} ${this.state.forms.length + 1}`,
      kind, operation: solid ? "solid" : "void", profileId: profile.id,
      endProfileId: options.endProfileId || profile.id, pathId: options.pathId || this.state.paths?.[0]?.id || null,
      depth: options.depth ?? "Profundidade", offset: options.offset ?? 0, distance: options.distance ?? "Profundidade",
      workPlane: options.workPlane || profile.view || this.state.workView,
      startAngle: options.startAngle ?? 0, endAngle: options.endAngle ?? 360, segments: options.segments ?? 48,
      visible: true, material: { color: solid ? "#4aa3df" : "#f36b2d" },
    };
    this.state.forms.push(item);
    this.state.extrusions = this.state.forms.filter((f) => f.kind === "extrusion");
    this.state.selectedElementId = item.id;
    this.emit();
    return item;
  }
  addExtrusion(profileId, depth = "Profundidade", offset = 0) {
    const profile = this.state.profiles.find((p) => p.id === profileId);
    if (!profile) return;
    this.pushHistory();
    const item = {
      id: uuid("extrusion"),
      name: `Extrusão ${this.state.extrusions.length + 1}`,
      profileId,
      depth,
      offset,
      workPlane: profile.view || this.state.workView,
      visible: true,
      material: { color: "#4aa3df" },
    };
    this.state.extrusions.push(item);
    this.state.forms.push({ ...item, kind: "extrusion", operation: "solid" });
    this.state.selectedElementId = item.id;
    this.emit();
  }
  beginCreationSession({ formType, operation = "solid" }) {
    this.pushHistory();
    this.state.creationSession = {
      active: true, formType, operation, step: this.firstCreationStep(formType), stepIndex: 0,
      drawingTool: "line", temporaryPoints: [], profileIds: [], pathId: null, axisId: null,
    };
    this.state.activeTool = "line";
    this.state.editMode = "creation";
    this.emit();
  }
  firstCreationStep(formType) {
    return ({ extrusion: "profile", blend: "startProfile", revolve: "profile", sweep: "profile", sweptBlend: "startProfile" })[formType] || "profile";
  }
  creationSteps(formType) {
    return ({ extrusion: ["profile"], blend: ["startProfile", "endProfile"], revolve: ["profile", "axis"], sweep: ["profile", "path"], sweptBlend: ["startProfile", "endProfile", "path"] })[formType] || ["profile"];
  }
  beginProfileEdit(profileId) {
    const profile = this.state.profiles.find((p) => p.id === profileId);
    if (!profile) return false;
    this.state.selectedElementId = profileId;
    this.state.workView = profile.view || this.state.workView;
    this.state.creationSession = createInitialState().creationSession;
    this.state.activeTool = "line";
    this.state.editMode = "profileEdit";
    this.state.editingProfileId = profileId;
    this.emit();
    return true;
  }
  finishProfileEdit(points, holes = []) {
    const id = this.state.editingProfileId;
    if (!id) return false;
    this.pushHistory();
    this.state.profiles = this.state.profiles.map((p) =>
      p.id === id ? { ...p, points: points.map((pt) => ({ ...pt })), holes: holes.map((loop) => loop.map((pt) => ({ ...pt }))) } : p,
    );
    this.state.editMode = null;
    this.state.editingProfileId = null;
    this.state.activeTool = "select";
    this.state.selectedElementId = id;
    this.emit();
    return true;
  }
  cancelProfileEdit() {
    if (this.state.editMode !== "profileEdit") return;
    this.state.editMode = null;
    this.state.editingProfileId = null;
    this.state.activeTool = "select";
    this.emit();
  }
  setCreationDrawingTool(tool) {
    this.state.creationSession = { ...this.state.creationSession, drawingTool: tool, temporaryPoints: [] };
    this.state.activeTool = tool;
    this.emit();
  }
  setTemporaryPoints(points) {
    if (!this.state.creationSession?.active) return;
    this.state.creationSession.temporaryPoints = points.map((p) => ({ ...p }));
    this.emit();
  }
  advanceCreationStep(payload = {}) {
    const cs = this.state.creationSession;
    if (!cs?.active) return false;
    const patch = { ...cs, temporaryPoints: [] };
    if (payload.profileId) patch.profileIds = [...patch.profileIds, payload.profileId];
    if (payload.pathId) patch.pathId = payload.pathId;
    if (payload.axisId) patch.axisId = payload.axisId;
    const steps = this.creationSteps(cs.formType);
    const next = (patch.stepIndex || 0) + 1;
    if (next < steps.length) {
      patch.stepIndex = next; patch.step = steps[next]; patch.drawingTool = steps[next] === "path" || steps[next] === "axis" ? "line" : "line";
      this.state.creationSession = patch; this.state.activeTool = patch.drawingTool; this.emit(); return false;
    }
    this.finishCreationSession(patch);
    return true;
  }
  finishCreationSession(session = this.state.creationSession) {
    const cs = session;
    if (!cs?.active) return null;
    const voidPrefix = cs.operation === "void" ? "void" : "";
    const cap = cs.formType[0].toUpperCase() + cs.formType.slice(1);
    const kind = cs.operation === "void" ? `${voidPrefix}${cap}` : cs.formType;
    if (cs.operation === "void" && cs.formType === "extrusion" && !this.voidIntersectsSolid(cs.profileIds[0])) {
      this.state.creationSession = createInitialState().creationSession;
      this.state.editMode = null; this.state.editingProfileId = null; this.state.activeTool = "select";
      this.emit();
      throw new Error("A forma vazia não intersecta nenhuma forma sólida.");
    }
    const form = this.addForm(kind, { operation: cs.operation, profileId: cs.profileIds[0], endProfileId: cs.profileIds[1] || cs.profileIds[0], pathId: cs.pathId || cs.axisId, axisId: cs.axisId, depth: "Profundidade" });
    this.state.creationSession = createInitialState().creationSession;
    this.state.editMode = null; this.state.editingProfileId = null; this.state.activeTool = "select";
    this.emit();
    return form;
  }
  voidIntersectsSolid(profileId) {
    const voidProfile = this.state.profiles.find((p) => p.id === profileId);
    if (!voidProfile) return false;
    const a = profileBounds(voidProfile.points);
    return (this.state.forms || []).some((form) => {
      if (form.operation === "void" || form.visible === false) return false;
      const p = this.state.profiles.find((x) => x.id === form.profileId);
      if (!p) return false;
      const b = profileBounds(p.points);
      return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
    });
  }
  cancelCreationSession() {
    this.state.creationSession = createInitialState().creationSession;
    this.state.editMode = null; this.state.editingProfileId = null; this.state.activeTool = "select";
    this.emit();
  }
  updateElement(id, patch) {
    this.pushHistory();
    for (const key of ["profiles", "paths", "forms", "extrusions"])
      this.state[key] = this.state[key].map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      );
    this.emit();
  }
   moveElement(id, delta, { history = true } = {}) {
    if (!id || (!delta?.x && !delta?.y && !delta?.z)) return false;
    if (history) this.pushHistory();
    const movePoints = (points = []) =>
      points.map((p) => ({
        ...p,
        x: (Number(p.x) || 0) + (Number(delta.x) || 0),
        y: (Number(p.y) || 0) + (Number(delta.y) || 0),
        z: p.z == null ? p.z : (Number(p.z) || 0) + (Number(delta.z) || 0),
      }));
    let changed = false;
    this.state.profiles = this.state.profiles.map((p) => {
      if (p.id !== id) return p;
      changed = true;
      return { ...p, points: movePoints(p.points) };
    });
    this.state.paths = (this.state.paths || []).map((p) => {
      if (p.id !== id) return p;
      changed = true;
      return { ...p, points: movePoints(p.points) };
    });
    const moveForm = (form) => {
      if (form.id !== id) return form;
      changed = true;
      const current = form.position || { x: 0, y: 0, z: 0 };
      return {
        ...form,
        position: {
          x: (Number(current.x) || 0) + (Number(delta.x) || 0),
          y: (Number(current.y) || 0) + (Number(delta.y) || 0),
          z: (Number(current.z) || 0) + (Number(delta.z) || 0),
        },
      };
    };
    this.state.forms = (this.state.forms || []).map(moveForm);
    this.state.extrusions = (this.state.extrusions || []).map(moveForm);
    if (changed) this.emit();
    return changed;
  }
  select(id) {
    this.state.selectedElementId = id;
    this.emit();
  }
  deleteSelected() {
    const id = this.state.selectedElementId;
    if (!id) return false;
    this.pushHistory();
    this.state.profiles = this.state.profiles.filter((p) => p.id !== id);
    this.state.paths = (this.state.paths || []).filter((p) => p.id !== id);
    this.state.forms = (this.state.forms || []).filter((e) => e.id !== id && e.profileId !== id && e.endProfileId !== id && e.pathId !== id);
    this.state.extrusions = this.state.extrusions.filter(
      (e) => e.id !== id && e.profileId !== id,
    );
    this.state.selectedElementId = null;
    this.emit();
    return true;
  }
  addParameter(name, value) {
    this.pushHistory();
    this.state.parameters.push({
      id: uuid("param"),
      name,
      value: Number(value) || 0,
      unit: UNIT,
    });
    this.emit();
  }
  updateParameter(id, patch) {
    this.pushHistory();
    this.state.parameters = this.state.parameters.map((p) =>
      p.id === id
        ? { ...p, ...patch, value: Number(patch.value ?? p.value) || 0 }
        : p,
    );
    this.emit();
  }
  addType() {
    this.pushHistory();
    this.state.types.push({
      id: uuid("type"),
      name: `Tipo ${this.state.types.length + 1}`,
      values: parameterMap(this.state),
    });
    this.emit();
  }
  applyType(id) {
    const type = this.state.types.find((t) => t.id === id);
    if (!type) return;
    this.pushHistory();
    this.state.currentTypeId = id;
    this.state.parameters = this.state.parameters.map((p) => ({
      ...p,
      value: type.values[p.name] ?? p.value,
    }));
    this.emit();
  }
  undo() {
    const p = this.state.history.undo.pop();
    if (!p) return;
    this.state.history.redo.push(this.snapshot());
    this.state = { ...p, history: this.state.history };
    this.emit();
  }
  redo() {
    const n = this.state.history.redo.pop();
    if (!n) return;
    this.state.history.undo.push(this.snapshot());
    this.state = { ...n, history: this.state.history };
    this.emit();
  }
  save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
  }
  loadSaved() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    this.replace(validateFamily(JSON.parse(raw)));
    return true;
  }
  replace(project) {
    this.state = {
      ...project,
      history: { undo: [], redo: [] },
      selectedElementId: null,
    };
    this.emit();
  }
}
export function validateFamily(data) {
  if (!data || data.format !== "engrodrigo-family-json")
    throw new Error("JSON de família inválido ou incompatível.");
  const base = createInitialState();
  return {
    ...base,
    ...data,
    settings: { ...base.settings, ...data.settings },
    parameters: Array.isArray(data.parameters)
      ? data.parameters
      : base.parameters,
    types: Array.isArray(data.types) ? data.types : base.types,
    profiles: Array.isArray(data.profiles) ? data.profiles : [],
    paths: Array.isArray(data.paths) ? data.paths : [],
    forms: Array.isArray(data.forms) ? data.forms : [],
    extrusions: Array.isArray(data.extrusions) ? data.extrusions : [],
    creationSession: base.creationSession,
    editMode: null,
    editingProfileId: null,
  };
}