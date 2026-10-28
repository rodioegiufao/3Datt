import {
  CATEGORIES,
  STORAGE_KEY,
  Store,
  VIEWS,
  validateFamily,
} from "./state.js";
import { Plan2D } from "./plan2d.js";
import { Scene3D } from "./scene3d.js";
import { IFC_EXPORTER_VERSION, exportFamilyToIfc } from "./ifc-exporter.js";
import { exportToGlb, exportToObj } from "./mesh-exporter.js";
console.info(`IFC exporter loaded: ${IFC_EXPORTER_VERSION}`);
const $ = (selector) => document.querySelector(selector);
const store = new Store();
let activeRibbonTab = "create";

const DRAW_TOOL_LABELS = {
  select: "Selecionar",
  profile: "Perfil livre",
  line: "Linha",
  rectangle: "Retângulo",
  "polygon-inscribed": "Polígono inscrito",
  "polygon-circumscribed": "Polígono circunscrito",
  circle: "Círculo",
  arc3: "Arco por três pontos",
  spline: "Spline",
  ellipse: "Elipse",
  "pick-lines": "Selecionar linhas",
};

const els = [
  "projectName",
  "category",
  "workView",
  "activeToolLabel",
  "snapStep",
  "majorGrid",
  "showGrid",
  "snapEnabled",
  "parameterList",
  "selectedPanel",
  "planView",
  "threeView",
  "defaultDepth",
  "treeProjectName",
  "treeCategory",
  "profileCount",
  "extrusionCount",
  "profileTree",
  "extrusionTree",
  "typeTree",
].reduce((a, id) => ((a[id] = $("#" + id)), a), {});
function toast(msg, type = "ok") {
  const d = document.createElement("div");
  d.className = `toast ${type}`;
  d.textContent = msg;
  $("#toast").append(d);
  setTimeout(() => d.remove(), 3200);
}
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportIfc(schema) {
  try {
    const ifc = exportFamilyToIfc(store.snapshot(), schema);
    download(`${store.state.name}.${schema}.ifc`, ifc, "application/x-step");
    toast(`IFC ${schema} exportado.`);
  } catch (err) {
    toast(err.message, "error");
  }
}
async function exportGltf() {
  try {
    const glb = await exportToGlb(store.state);
    download(`${store.state.name}.glb`, glb, "model/gltf-binary");
    toast("glTF (.glb) exportado.");
  } catch (err) {
    toast(err.message, "error");
  }
}
function exportObj() {
  try {
    const obj = exportToObj(store.state);
    download(`${store.state.name}.obj`, obj, "text/plain");
    toast("OBJ exportado.");
  } catch (err) {
    toast(err.message, "error");
  }
}
function positive(v, label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0)
    throw new Error(`${label} deve ser maior que zero.`);
  return n;
}
function opt(select, items, valueKey = "id", labelKey = "name") {
  select.innerHTML = "";
  items.forEach((i) => {
    const o = document.createElement("option");
    o.value = i[valueKey] ?? i;
    o.textContent = i[labelKey] ?? i;
    select.append(o);
  });
}
const ACI_BASE_COLORS = [
  { index: 1, hex: "#ff0000" },
  { index: 2, hex: "#ffff00" },
  { index: 3, hex: "#00ff00" },
  { index: 4, hex: "#00ffff" },
  { index: 5, hex: "#0000ff" },
  { index: 6, hex: "#ff00ff" },
  { index: 7, hex: "#ffffff" },
  { index: 8, hex: "#808080" },
  { index: 9, hex: "#c0c0c0" },
  { index: 255, hex: "#000000" },
];
const ACI_TONE_OFFSETS = [0, 2, 4, 6, 8, 1, 3, 5, 7, 9];
const ACI_HUES = Array.from({ length: 24 }, (_, i) => i * 15);
const ACI_TONES = [
  { s: 1, l: 0.18 },
  { s: 1, l: 0.28 },
  { s: 1, l: 0.38 },
  { s: 1, l: 0.50 },
  { s: 1, l: 0.62 },
  { s: 0.58, l: 0.74 },
  { s: 0.48, l: 0.62 },
  { s: 0.40, l: 0.50 },
  { s: 0.34, l: 0.38 },
  { s: 0.30, l: 0.26 },
];
function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
function colorName(hex) {
  const normalized = hex.toLowerCase();
  const base = ACI_BASE_COLORS.find((color) => color.hex.toLowerCase() === normalized);
  if (base) return String(base.index);
  const palette = buildAciPalette();
  const match = palette.find((color) => color.hex.toLowerCase() === normalized);
  return match ? String(match.index) : hex.toUpperCase();
}
function buildAciPalette() {
  return ACI_TONES.flatMap((tone, toneIndex) => ACI_HUES.map((hue, hueIndex) => ({
    index: (hueIndex + 1) * 10 + ACI_TONE_OFFSETS[toneIndex],
    hex: hslToHex(hue, tone.s, tone.l),
  })));
}
function isSolidForm(item) {
  return store.state.forms.some((form) => form.id === item.id && (form.operation || "solid") === "solid");
}
opt(els.category, CATEGORIES, "x", "x");
opt(els.workView, VIEWS);
opt($("#workViewRibbon"), VIEWS);
function itemButton(item) {
  const li = document.createElement("li"),
    b = document.createElement("button");
  b.textContent = `${item.visible === false ? "○" : "●"} ${item.name}`;
  b.className = item.id === store.state.selectedElementId ? "selected" : "";
  b.onclick = () => store.select(item.id);
   b.oncontextmenu = (ev) => {
    ev.preventDefault();
    store.select(item.id);
    showElementMenu(ev.clientX, ev.clientY, item);
  };
  li.append(b);
  return li;
}
function showElementMenu(x, y, item) {
  document.querySelector(".element-context-menu")?.remove();
  const menu = document.createElement("div");
  menu.className = "element-context-menu";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const edit = document.createElement("button");
  edit.type = "button";
  edit.textContent = "Editar perfil";
  const isProfile = store.state.profiles.some((p) => p.id === item.id);
  edit.disabled = !isProfile;
  edit.onclick = () => {
    menu.remove();
    if (!store.beginProfileEdit(item.id)) return toast("Selecione um perfil para editar.", "error");
    toast("Perfil em edição: ajuste os vértices na vista 2D e clique em Concluir.");
  };
  const color = document.createElement("button");
  color.type = "button";
  color.textContent = "Adicionar cor ACI";
  color.disabled = !isSolidForm(item);
  color.onclick = () => {
    menu.remove();
    showAciColorDialog(item);
  };
  menu.append(edit, color);
  document.body.append(menu);
  const close = (ev) => {
    if (!menu.contains(ev.target)) {
      menu.remove();
      document.removeEventListener("pointerdown", close);
    }
  };
  setTimeout(() => document.addEventListener("pointerdown", close), 0);
}
function showAciColorDialog(item) {
  document.querySelector(".aci-color-dialog")?.remove();
  const overlay = document.createElement("div");
  overlay.className = "aci-color-dialog";
  const current = item.material?.color || "#ffffff";
  let selected = current;
  overlay.innerHTML = `
    <div class="aci-window" role="dialog" aria-modal="true" aria-label="Selecionar cor ACI">
      <div class="aci-title"><span>Selecionar cor</span><button type="button" class="aci-close" aria-label="Fechar">×</button></div>
      <div class="aci-tabs"><button class="active" type="button">Cor indexada</button><button type="button">True Color</button><button type="button">Livros de cores</button></div>
      <div class="aci-content">
        <div class="aci-label">Índice de cores do AutoCAD (ACI):</div>
        <div class="aci-grid"></div>
        <div class="aci-base-row"></div>
        <div class="aci-footer"><label>Cor:<input class="aci-name" readonly></label><button class="aci-ok" type="button">OK</button><button class="aci-cancel" type="button">Cancelar</button></div>
      </div>
    </div>`;
  const grid = overlay.querySelector(".aci-grid");
  const baseRow = overlay.querySelector(".aci-base-row");
  const input = overlay.querySelector(".aci-name");
  const windowEl = overlay.querySelector(".aci-window");
  const titleBar = overlay.querySelector(".aci-title");
  const setSelected = (hex) => {
    selected = hex;
    input.value = colorName(hex);
    overlay.querySelectorAll(".aci-swatch").forEach((swatch) => swatch.classList.toggle("selected", swatch.dataset.hex === hex));
  };
  buildAciPalette().forEach(({ index, hex }) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "aci-swatch";
    swatch.dataset.hex = hex;
    swatch.title = String(index);
    swatch.style.background = hex;
    swatch.onclick = () => setSelected(hex);
    grid.append(swatch);
  });
  ACI_BASE_COLORS.forEach(({ index, hex }) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "aci-swatch aci-base";
    swatch.title = String(index);
    swatch.dataset.hex = hex;
    swatch.style.background = hex;
    swatch.onclick = () => setSelected(hex);
    baseRow.append(swatch);
  });
  overlay.querySelector(".aci-close").onclick = () => overlay.remove();
  overlay.querySelector(".aci-cancel").onclick = () => overlay.remove();
  titleBar.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("button")) return;
    ev.preventDefault();
    const rect = windowEl.getBoundingClientRect();
    const startX = ev.clientX;
    const startY = ev.clientY;
    const startLeft = rect.left;
    const startTop = rect.top;
    overlay.classList.add("dragging");
    windowEl.setPointerCapture(ev.pointerId);
    const move = (moveEv) => {
      const nextLeft = Math.min(Math.max(0, startLeft + moveEv.clientX - startX), window.innerWidth - rect.width);
      const nextTop = Math.min(Math.max(0, startTop + moveEv.clientY - startY), window.innerHeight - rect.height);
      windowEl.style.left = `${nextLeft}px`;
      windowEl.style.top = `${nextTop}px`;
      windowEl.style.transform = "none";
    };
    const stop = () => {
      overlay.classList.remove("dragging");
      windowEl.removeEventListener("pointermove", move);
      windowEl.removeEventListener("pointerup", stop);
      windowEl.removeEventListener("pointercancel", stop);
    };
    windowEl.addEventListener("pointermove", move);
    windowEl.addEventListener("pointerup", stop);
    windowEl.addEventListener("pointercancel", stop);
  });
  overlay.querySelector(".aci-ok").onclick = () => {
    store.updateElement(item.id, { material: { ...(item.material || {}), color: selected } });
    overlay.remove();
    toast(`Cor ${colorName(selected)} aplicada à forma e será exportada no IFC.`);
  };
  overlay.addEventListener("pointerdown", (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.append(overlay);
  setSelected(current);
}
function sync(s) {
  els.projectName.value = s.name;
  els.category.value = s.category;
  els.workView.value = s.workView;
  els.activeToolLabel.value =
    DRAW_TOOL_LABELS[s.creationSession?.drawingTool || s.activeTool] || s.activeTool;
  els.snapStep.value = s.settings.snapStep;
  els.majorGrid.value = s.settings.majorGrid;
  els.showGrid.checked = s.settings.showGrid;
  els.snapEnabled.checked = s.settings.snapEnabled;
  $("#toolProfile")?.classList.toggle("active", s.activeTool === "profile");
  $("#toolSelect")?.classList.toggle("active", s.activeTool === "select");
  ["Line", "Rectangle", "Circle", "Polygon"].forEach((n) =>
    $("#tool" + n)?.classList.toggle(
      "active",
      s.activeTool === n.toLowerCase(),
    ),
  );
  document
    .querySelectorAll("[data-draw-tool]")
    .forEach((b) =>
      b.classList.toggle(
        "active",
        s.creationSession?.drawingTool === b.dataset.drawTool,
      ),
    );
  $("#orthoToggle")?.classList.toggle("active", s.settings.ortho);
  els.treeProjectName.textContent = s.name;
  els.treeCategory.textContent = s.category;
  els.profileCount.textContent = s.profiles.length;
  els.extrusionCount.textContent = (s.forms || s.extrusions).length;
  els.profileTree.innerHTML = "";
  s.profiles.forEach((p) => els.profileTree.append(itemButton(p)));
  els.extrusionTree.innerHTML = "";
  (s.forms || s.extrusions).forEach((e) =>
    els.extrusionTree.append(itemButton(e)),
  );
  els.typeTree.innerHTML = "";
  s.types.forEach((t) => {
    const li = document.createElement("li"),
      b = document.createElement("button");
    b.textContent = t.name;
    b.className = t.id === s.currentTypeId ? "selected" : "";
    b.onclick = () => store.applyType(t.id);
    li.append(b);
    els.typeTree.append(li);
  });
  renderParams(s);
  renderSelected(s);
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.toggle("active", b.dataset.view === s.view));
  els.planView.classList.toggle("hidden", s.view === "three");
  els.threeView.classList.toggle("hidden", s.view === "plan");
  $(".canvas-area").classList.toggle("split", s.view === "split");
  $("#snapStatus").textContent =
    `Snap: ${s.settings.snapEnabled ? "ligado" : "desligado"}`;
  $("#toolStatus").textContent = `Ferramenta: ${els.activeToolLabel.value}`;
  const activeCreation = !!s.creationSession?.active;
  const activeProfileEdit = s.editMode === "profileEdit";
  const activeModify = activeCreation || activeProfileEdit;
  document
    .querySelectorAll("[data-ribbon-tab]")
    .forEach((b) => {
      b.classList.toggle("active", b.dataset.ribbonTab === activeRibbonTab);
      b.classList.toggle("hidden", activeModify);
    });
  document
    .querySelectorAll("[data-ribbon-panel]")
    .forEach((panel) =>
      panel.classList.toggle(
        "hidden",
        activeModify || panel.dataset.ribbonPanel !== activeRibbonTab,
      ),
    );
  $("#creationRibbon")?.classList.toggle("hidden", !activeModify);
  $("#optionsBar")?.classList.toggle("hidden", !activeModify);
  $("#workViewRibbon") && ($("#workViewRibbon").value = s.workView);
  if (activeProfileEdit) {
    const profile = s.profiles.find((p) => p.id === s.editingProfileId);
    $("#creationTitle").textContent = `Modificar | Editar perfil — ${profile?.name || "perfil selecionado"}`;
  } else if (activeCreation) {
    const names = {
      extrusion: "extrusão",
      blend: "mesclar",
      revolve: "revolver",
      sweep: "varredura",
      sweptBlend: "mesclar com varredura",
    };
    const steps = {
      profile: "desenhe o perfil",
      startProfile: "Etapa 1 de 2: desenhe o perfil inicial",
      endProfile: "Etapa 2 de 2: desenhe o perfil final",
      path: "desenhe o caminho",
      axis: "desenhe o eixo de revolução",
    };
    $("#creationTitle").textContent =
      `Modificar | Criar ${names[s.creationSession.formType]}${s.creationSession.operation === "void" ? " vazia" : ""} — ${steps[s.creationSession.step] || "desenhe"}`;
  }
}
function renderParams(s) {
  els.parameterList.innerHTML = "";
  s.parameters.forEach((p) => {
    const row = document.createElement("div");
    row.className = "param-row";
    row.innerHTML = `<input value="${p.name}" data-k="name"><input type="number" value="${p.value}" data-k="value"><span>mm</span>`;
    row.querySelectorAll("input").forEach(
      (i) =>
        (i.onchange = () =>
          store.updateParameter(p.id, {
            [i.dataset.k]:
              i.dataset.k === "value" ? Number(i.value) : i.value.trim(),
          })),
    );
    els.parameterList.append(row);
  });
}
function renderSelected(s) {
  const p = s.profiles.find((x) => x.id === s.selectedElementId),
    e = (s.forms || s.extrusions).find((x) => x.id === s.selectedElementId);
  if (!p && !e) {
    const workPlaneOptions = VIEWS.map(
      (view) =>
        `<option value="${view.id}" ${s.workView === view.id ? "selected" : ""}>${view.name} (${view.plane})</option>`,
    ).join("");
    els.selectedPanel.innerHTML = `<div class="property-group">
      <h3>Plano de trabalho</h3>
      <label class="property-row">
        <span>Plano atual</span>
        <select id="initialWorkPlane" aria-label="Plano de trabalho atual">${workPlaneOptions}</select>
      </label>
      <p class="muted">Escolha o plano em que deseja desenhar. Ele pode ser alterado a qualquer momento.</p>
    </div>
    <p class="muted">Selecione uma forma para editar suas propriedades.</p>`;
    $("#initialWorkPlane").onchange = (event) =>
      store.set({ workView: event.target.value });
    return;
  }
  const item = p || e;
  const isRevolve =
    e &&
    (e.kind === "revolve" ||
      e.kind === "voidRevolve" ||
      String(e.kind).includes("Revolve"));
  const revolveControls = isRevolve
    ? `<label>Ângulo inicial (graus)<input id="selStartAngle" type="number" value="${e.startAngle ?? 0}"></label><label>Ângulo final (graus)<input id="selEndAngle" type="number" value="${e.endAngle ?? 360}"></label><label>Segmentos da revolução<input id="selSegments" type="number" min="8" max="128" value="${e.segments ?? 48}"></label><p class="muted">Eixo: ${e.pathId ? "linha desenhada na etapa do eixo" : "eixo vertical padrão"}.</p>`
    : "";
  const isExtrusion = e && ["extrusion", "voidExtrusion", undefined].includes(e.kind);
  const start = Number(e?.offset) || 0;
  const depth = e?.depth ?? e?.distance ?? "Profundidade";
  const numericDepth = Number(depth);
  const end = Number.isFinite(numericDepth) ? start + numericDepth : depth;
  const planeOptions = VIEWS.map(
    (view) => `<option value="${view.id}" ${(e?.workPlane || p?.view) === view.id ? "selected" : ""}>${view.name} (${view.plane})</option>`,
  ).join("");
  const identity = `<div class="property-group"><h3>Dados de identidade</h3><label class="property-row"><span>Nome</span><input id="selName" value="${item.name}"></label></div>`;
  const graphics = `<div class="property-group"><h3>Gráficos</h3><label class="property-row check"><span>Visível</span><input id="selVisible" type="checkbox" ${item.visible !== false ? "checked" : ""}></label></div>`;
  // A profile is selected briefly while a creation session turns it into a
  // form. Build only the property markup for the selected element so that
  // this intermediate render cannot dereference a missing form (or profile).
  const extrusionProperties = e
    ? `<div class="property-kind">Extrusão ${e.operation === "void" ? "vazia" : "sólida"}</div><div class="property-group"><h3>Restrições</h3><label class="property-row"><span>Final da extrusão</span><input id="selExtrusionEnd" value="${end}"></label><label class="property-row"><span>Início da extrusão</span><input id="selExtrusionStart" type="number" value="${start}"></label><label class="property-row"><span>Plano de trabalho</span><select id="selWorkPlane">${planeOptions}</select></label></div>`
    : "";
  const genericFormProperties = e
    ? `<div class="property-kind">${e.kind || "Forma"} (${e.operation || "solid"})</div><div class="property-group"><h3>Restrições</h3><label class="property-row"><span>Profundidade/distância</span><input id="selDepth" value="${depth}"></label><label class="property-row"><span>Deslocamento (mm)</span><input id="selOffset" type="number" value="${start}"></label></div>${revolveControls}`
    : "";
  const profileProperties = p
    ? `<div class="property-kind">Perfil com ${p.points.length} vértices — ${p.view}</div>`
    : "";
  els.selectedPanel.innerHTML = `${e ? (isExtrusion ? extrusionProperties : genericFormProperties) : profileProperties}${graphics}${identity}`
  $("#selName").onchange = (ev) =>
    store.updateElement(item.id, { name: ev.target.value.trim() || item.name });
  $("#selVisible").onchange = (ev) =>
    store.updateElement(item.id, { visible: ev.target.checked });
  if (e) {
    if (isExtrusion) {
      $("#selExtrusionStart").onchange = (ev) => {
        const nextStart = Number(ev.target.value) || 0;
        const currentEnd = Number($("#selExtrusionEnd").value);
        store.updateElement(e.id, {
          offset: nextStart,
          ...(Number.isFinite(currentEnd) ? { depth: Math.max(currentEnd - nextStart, 1) } : {}),
        });
      };
      $("#selExtrusionEnd").onchange = (ev) => {
        const value = ev.target.value.trim();
        const numericEnd = Number(value);
        store.updateElement(e.id, {
          depth: Number.isFinite(numericEnd) ? Math.max(numericEnd - (Number(e.offset) || 0), 1) : value || "Profundidade",
        });
      };
      $("#selWorkPlane").onchange = (ev) =>
        store.updateElement(e.id, { workPlane: ev.target.value });
    } else {
      $("#selDepth").onchange = (ev) =>
        store.updateElement(e.id, { depth: ev.target.value.trim() || 0 });
      $("#selOffset").onchange = (ev) =>
        store.updateElement(e.id, { offset: Number(ev.target.value) || 0 });
    }
    if (isRevolve) {
      $("#selStartAngle").onchange = (ev) =>
        store.updateElement(e.id, { startAngle: Number(ev.target.value) || 0 });
      $("#selEndAngle").onchange = (ev) =>
        store.updateElement(e.id, { endAngle: Number(ev.target.value) || 360 });
      $("#selSegments").onchange = (ev) =>
        store.updateElement(e.id, {
          segments: Math.max(8, Number(ev.target.value) || 48),
        });
    }
  }
}
const plan2d = new Plan2D($("#planCanvas"), store, {
  onStatus: (p, len, kind) => {
    $("#coordX").textContent = `X: ${p.x.toFixed(0)} mm`;
    $("#coordY").textContent = `Y: ${p.y.toFixed(0)} mm`;
    $("#tempLength").textContent =
      `Segmento: ${len ? len.toFixed(0) + " mm" : "—"}`;
    $("#snapStatus").textContent = `Snap: ${kind}`;
  },
  onError: (m) => toast(m, "error"),
});
const scene3d = new Scene3D($("#threeCanvas"), store, { onError: (m) => toast(m, "error") });
store.subscribe(sync);
document.querySelectorAll("[data-ribbon-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      activeRibbonTab = b.dataset.ribbonTab || "create";
      sync(store.state);
    }),
);
if ($("#toolProfile"))
  $("#toolProfile").onclick = () =>
    store.set({ activeTool: "profile", editMode: "profile" });
if ($("#toolSelect"))
  $("#toolSelect").onclick = () =>
    store.set({ activeTool: "select", editMode: null });
if ($("#toolLine"))
  $("#toolLine").onclick = () =>
    store.set({ activeTool: "line", editMode: "path" });
if ($("#toolRectangle"))
  $("#toolRectangle").onclick = () =>
    store.set({ activeTool: "rectangle", editMode: "profile" });
if ($("#toolCircle"))
  $("#toolCircle").onclick = () =>
    store.set({ activeTool: "circle", editMode: "profile" });
if ($("#toolPolygon"))
  $("#toolPolygon").onclick = () =>
    store.set({ activeTool: "polygon", editMode: "profile" });
if ($("#orthoToggle"))
  $("#orthoToggle").onclick = () =>
    store.updateSettings({ ortho: !store.state.settings.ortho });
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => store.set({ view: b.dataset.view })));
els.projectName.onchange = (e) =>
  store.set({ name: e.target.value.trim() || "Nova família paramétrica" });
els.category.onchange = (e) => store.set({ category: e.target.value });
els.workView.onchange = (e) => store.set({ workView: e.target.value });
els.snapStep.onchange = (e) => {
  try {
    store.updateSettings({ snapStep: positive(e.target.value, "Snap") });
  } catch (err) {
    toast(err.message, "error");
  }
};
els.majorGrid.onchange = (e) => {
  try {
    store.updateSettings({ majorGrid: positive(e.target.value, "Grade") });
  } catch (err) {
    toast(err.message, "error");
  }
};
els.showGrid.onchange = (e) =>
  store.updateSettings({ showGrid: e.target.checked });
els.snapEnabled.onchange = (e) =>
  store.updateSettings({ snapEnabled: e.target.checked });
// Keep supporting the legacy shortcut when it is present without preventing the
// rest of the editor from initializing on layouts that only use the ribbon.
if ($("#extrudeSelected"))
  $("#extrudeSelected").onclick = () => {
    store.beginCreationSession({ formType: "extrusion", operation: "solid" });
    toast("Criar extrusão: desenhe um perfil fechado na vista 2D ou 3D.");
  };

$("#addParam").onclick = () => {
  const name = $("#newParamName").value.trim();
  if (!name) return toast("Informe o nome do parâmetro.", "error");
  store.addParameter(name, $("#newParamValue").value);
  $("#newParamName").value = "";
  $("#newParamValue").value = "";
};
$("#addType").onclick = () => store.addType();
$("#saveProject").onclick = () => {
  store.save();
  toast("Família salva no navegador.");
};
$("#newProject").onclick = () => {
  if (confirm("Criar uma nova família e limpar a atual?")) {
    localStorage.removeItem(STORAGE_KEY);
    store.replace(
      validateFamily({
        ...store.snapshot(),
        ...{
          format: "engrodrigo-family-json",
          profiles: [],
          extrusions: [],
          forms: [],
          paths: [],
          name: "Nova família paramétrica",
        },
      }),
    );
  }
};
const deleteAction = () =>
  store.deleteSelected()
    ? toast("Elemento excluído.")
    : toast("Nada selecionado.", "error");
if ($("#deleteSelected")) $("#deleteSelected").onclick = deleteAction;
$("#deleteSelectedSide").onclick = deleteAction;
$("#undo").onclick = () => store.undo();
$("#redo").onclick = () => store.redo();
$("#exportJson").onclick = () =>
  download(
    `${store.state.name}.efamily.json`,
    JSON.stringify(store.snapshot(), null, 2),
    "application/json",
  );
$("#exportIfc2x3").onclick = () => exportIfc("IFC2X3");
$("#exportIfc4").onclick = () => exportIfc("IFC4");
$("#exportGltf").onclick = () => exportGltf();
$("#exportObj").onclick = () => exportObj();
$("#importJson").onchange = async (e) => {
  try {
    const f = e.target.files[0];
    if (!f) return;
    store.replace(validateFamily(JSON.parse(await f.text())));
    toast("Família importada.");
  } catch (err) {
    toast(`Falha na importação: ${err.message}`, "error");
  } finally {
    e.target.value = "";
  }
};
$("#importIfc").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    toast("Lendo IFC…");
    const { importIfc, toStoreGeometry } = await import("./ifc-importer.js");
    const bytes = new Uint8Array(await f.arrayBuffer());
    const result = await importIfc(bytes);
    scene3d.setReferenceGroup(result.referenceGroup);
    $("#clearIfcReference").classList.remove("hidden");
    const { profiles, forms } = toStoreGeometry(result.reconstructed);
    store.importGeometry(profiles, forms);
    const { totalProducts, reconstructedCount } = result.stats;
    const referenceOnly = totalProducts - reconstructedCount;
    toast(
      reconstructedCount
        ? `IFC carregado: ${reconstructedCount} forma(s) reconstruída(s) como perfis editáveis${referenceOnly ? `, ${referenceOnly} exibida(s) só como referência visual` : ""}.`
        : `IFC carregado como referência visual (${totalProducts} elemento(s)) — nenhuma forma pôde ser reconstruída como editável.`,
    );
  } catch (err) {
    console.error(err);
    toast(`Falha ao importar IFC: ${err.message}`, "error");
  } finally {
    e.target.value = "";
  }
};
$("#clearIfcReference").onclick = () => {
  scene3d.setReferenceGroup(null);
  $("#clearIfcReference").classList.add("hidden");
};
window.addEventListener("keydown", (e) => {
  const edit = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (
    !store.state.creationSession?.active &&
    store.state.editMode !== "profileEdit" &&
    !edit &&
    (e.key === "Delete" || e.key === "Backspace")
  )
    store.deleteSelected();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") store.undo();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") store.redo();
});
document
  .querySelectorAll(".collapse")
  .forEach(
    (b) =>
      (b.onclick = () =>
        document
          .querySelector("." + b.dataset.target)
          .classList.toggle("collapsed")),
  );
try {
  if (
    localStorage.getItem(STORAGE_KEY) &&
    confirm("Restaurar a última família salva neste navegador?")
  )
    store.loadSaved();
} catch {
  toast("Não foi possível restaurar a família salva.", "error");
}
const formOperation = $("#formOperation");
const syncFormOperationStyle = () => {
  const operation = formOperation?.value || "solid";
  document.querySelectorAll("[data-create-form]").forEach((b) => {
    b.dataset.operation = operation;
    b.classList.toggle("solid", operation === "solid");
    b.classList.toggle("void", operation === "void");
  });
};
formOperation?.addEventListener("change", syncFormOperationStyle);
syncFormOperationStyle();
document.querySelectorAll("[data-create-form]").forEach(
  (b) =>
    (b.onclick = () => {
      const operation = formOperation?.value || b.dataset.operation || "solid";
      store.beginCreationSession({
        formType: b.dataset.createForm,
        operation,
      });
      const operationLabel = operation === "void" ? "vazia" : "sólida";
      toast(
        `${b.textContent.trim()} ${operationLabel}: desenhe as etapas na vista 2D ou 3D.`,
      );
    }),
);
document
  .querySelectorAll("[data-draw-tool]")
  .forEach(
    (b) => (b.onclick = () => store.setCreationDrawingTool(b.dataset.drawTool)),
  );
$("#finishEdit").onclick = () => (scene3d.hasDraft() ? scene3d.finish() : plan2d.finish());
$("#deleteProfileLine").onclick = () => plan2d.deleteSelectedSegment();
$("#cancelEdit").onclick = () => {
  plan2d.cancel();
  scene3d.cancel();
  toast("Criação cancelada.");
};
$("#workViewRibbon").onchange = (e) => store.set({ workView: e.target.value });
$("#orthoOption").onchange = (e) =>
  store.updateSettings({ ortho: e.target.checked });
$("#setPlane").onclick = () =>
  toast("Plano de trabalho definido pela vista selecionada.");
$("#showPlane").onclick = () =>
  store.updateSettings({ showGrid: !store.state.settings.showGrid });
$("#howToDraw").onclick = () => $("#drawHelp").classList.remove("hidden");
$("#closeHelp").onclick = () => $("#drawHelp").classList.add("hidden");
$("#revolveHelp").onclick = () =>
  $("#revolveHelpModal").classList.remove("hidden");
$("#closeRevolveHelp").onclick = () =>
  $("#revolveHelpModal").classList.add("hidden");