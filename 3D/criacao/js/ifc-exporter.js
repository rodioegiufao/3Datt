import { evalValue, parameterMap, pointTo3D } from "./state.js";
import { buildGeometry, isSolidKind } from "./geometry-engine.js";

const IFC_SCHEMA = {
  IFC2X3: "IFC2X3",
  IFC4: "IFC4",
};
const IFC_GUID_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
export const IFC_EXPORTER_VERSION = "family-ifc-aci-colors-2026-07-17-01";
const APP_NAME = "EngRodrigo Family Studio";

const IFC_CATEGORY_TYPES = {
  Mobiliário: {
    ifc2x3: "IFCFURNISHINGELEMENT",
    ifc4: "IFCFURNISHINGELEMENT",
    predefined: ".USERDEFINED.",
  },
  Equipamento: {
    ifc2x3: "IFCBUILDINGELEMENTPROXY",
    ifc4: "IFCBUILDINGELEMENTPROXY",
    predefined: ".USERDEFINED.",
  },
  "Modelo genérico": {
    ifc2x3: "IFCBUILDINGELEMENTPROXY",
    ifc4: "IFCBUILDINGELEMENTPROXY",
    predefined: ".USERDEFINED.",
  },
  Esquadria: {
    ifc2x3: "IFCBUILDINGELEMENTPROXY",
    ifc4: "IFCBUILDINGELEMENTPROXY",
    predefined: ".USERDEFINED.",
  },
  Hidrossanitário: {
    ifc2x3: "IFCBUILDINGELEMENTPROXY",
    ifc4: "IFCBUILDINGELEMENTPROXY",
    predefined: ".USERDEFINED.",
  },
};

const sanitize = (value) => String(value ?? "").replace(/'/g, "''");
const str = (value) => `'${sanitize(value)}'`;
const optStr = (value) => (value ? str(value) : "$ ".trim());
const num = (value) =>
  Number.isFinite(value) ? Number(value.toFixed(6)).toString() : "0";
const timestamp = () => Math.floor(Date.now() / 1000).toString();

function uuidBytes() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replace(/-/g, "");
  }
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function compressUuidToIfcGuid(uuidHex) {
  let value = BigInt(`0x${uuidHex}`);
  const chars = Array(22).fill("0");
  for (let i = 21; i >= 0; i -= 1) {
    chars[i] = IFC_GUID_ALPHABET[Number(value & 63n)];
    value >>= 6n;
  }
  return chars.join("");
}

function createGuidFactory() {
  const used = new Set();
  return () => {
    let id;
    do {
      id = compressUuidToIfcGuid(uuidBytes());
    } while (used.has(id));
    used.add(id);
    return id;
  };
}

class IfcWriter {
  constructor(schema) {
    this.schema = schema;
    this.nextId = 1;
    this.lines = [];
    this.guid = createGuidFactory();
  }

  add(type, args) {
    const id = this.nextId++;
    this.lines.push(`#${id}=${type}(${args.join(",")});`);
    return id;
  }

  ref(id) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(`Referência IFC inválida: ${id}`);
    }
    return `#${id}`;
  }
  refs(ids) {
    return `(${ids.map((id) => this.ref(id)).join(",")})`;
  }

  rootArgs(ownerHistory, name, description = "$", objectType = "$") {
    return [str(this.guid()), this.ref(ownerHistory), str(name), description, objectType];
  }
}

function getElementInfo(category, schema) {
  const fallback = IFC_CATEGORY_TYPES["Modelo genérico"];
  const entry = IFC_CATEGORY_TYPES[category] || fallback;
  return {
    type: schema === IFC_SCHEMA.IFC4 ? entry.ifc4 : entry.ifc2x3,
    predefined: entry.predefined,
  };
}

function createOwnerHistory(writer) {
  const person = writer.add("IFCPERSON", ["$", "'EngRodrigo'", "$", "$", "$", "$", "$", "$"]);
  const organization = writer.add("IFCORGANIZATION", ["$", str(APP_NAME), "$", "$", "$"]);
  const personAndOrganization = writer.add("IFCPERSONANDORGANIZATION", [
    writer.ref(person),
    writer.ref(organization),
    "$",
  ]);
  const application = writer.add("IFCAPPLICATION", [
    writer.ref(organization),
    "'1.0'",
    str(APP_NAME),
    "'ENGRODRIGO_FAMILY_STUDIO'",
  ]);
  return writer.add("IFCOWNERHISTORY", [
    writer.ref(personAndOrganization),
    writer.ref(application),
    "$",
    ".ADDED.",
    "$",
    writer.ref(personAndOrganization),
    writer.ref(application),
    timestamp(),
  ]);
  }

function createBaseGeometry(writer) {
  const lengthUnit = writer.add("IFCSIUNIT", ["*", ".LENGTHUNIT.", ".MILLI.", ".METRE."]);
  const planeAngleUnit = writer.add("IFCSIUNIT", ["*", ".PLANEANGLEUNIT.", "$", ".RADIAN."]);
  const unitAssignment = writer.add("IFCUNITASSIGNMENT", [writer.refs([lengthUnit, planeAngleUnit])]);
  const origin = writer.add("IFCCARTESIANPOINT", ["(0.,0.,0.)"]);
  const axisZ = writer.add("IFCDIRECTION", ["(0.,0.,1.)"]);
  const axisX = writer.add("IFCDIRECTION", ["(1.,0.,0.)"]);
  const placement3d = writer.add("IFCAXIS2PLACEMENT3D", [writer.ref(origin), writer.ref(axisZ), writer.ref(axisX)]);
  const worldPlacement = writer.add("IFCLOCALPLACEMENT", ["$", writer.ref(placement3d)]);
  const context = writer.add("IFCGEOMETRICREPRESENTATIONCONTEXT", [
    "$",
    "'Model'",
    "3",
    "1.E-05",
    writer.ref(placement3d),
    "$",
  ]);
  return { unitAssignment, placement3d, worldPlacement, context };
}

function createLocalPlacement(writer, relativeTo = "$", coordinates = [0, 0, 0]) {
  const point = writer.add("IFCCARTESIANPOINT", [
    `(${coordinates.map((value) => num(value)).join(",")})`,
  ]);
  const axisZ = writer.add("IFCDIRECTION", ["(0.,0.,1.)"]);
  const axisX = writer.add("IFCDIRECTION", ["(1.,0.,0.)"]);
  const placement3d = writer.add("IFCAXIS2PLACEMENT3D", [
    writer.ref(point),
    writer.ref(axisZ),
    writer.ref(axisX),
  ]);
  return writer.add("IFCLOCALPLACEMENT", [relativeTo, writer.ref(placement3d)]);
}

function createIfc4SpatialStructure(writer, projectName, ownerHistory) {
  const base = createBaseGeometry(writer);
  const project = writer.add("IFCPROJECT", [
    ...writer.rootArgs(ownerHistory, projectName),
    "$",
    "$",
    `(${writer.ref(base.context)})`,
    writer.ref(base.unitAssignment),
  ]);
  const sitePlacement = createLocalPlacement(writer);
  const site = writer.add("IFCSITE", [
    ...writer.rootArgs(ownerHistory, "Terreno"),
    writer.ref(sitePlacement),
    "$",
    "$",
    ".ELEMENT.",
    "$",
    "$",
    "$",
    "$",
    "$",
  ]);
  const buildingPlacement = createLocalPlacement(writer, writer.ref(sitePlacement));
  const building = writer.add("IFCBUILDING", [
    ...writer.rootArgs(ownerHistory, "Edificação"),
    writer.ref(buildingPlacement),
    "$",
    "$",
    ".ELEMENT.",
    "$",
    "$",
    "$",
  ]);
  const storeyPlacement = createLocalPlacement(writer, writer.ref(buildingPlacement));
  const storey = writer.add("IFCBUILDINGSTOREY", [
    ...writer.rootArgs(ownerHistory, "Nível 0"),
    writer.ref(storeyPlacement),
    "$",
    "'Nível 0'",
    ".ELEMENT.",
    "0.",
  ]);
  addAggregates(writer, ownerHistory, project, site, building, storey);
  return { ...base, project, site, sitePlacement, building, buildingPlacement, storey, storeyPlacement };
}

function createIfc2x3SpatialStructure(writer, projectName, ownerHistory) {
  const base = createBaseGeometry(writer);
  const project = writer.add("IFCPROJECT", [
    ...writer.rootArgs(ownerHistory, projectName),
    "$",
    `(${writer.ref(base.context)})`,
    writer.ref(base.unitAssignment),
  ]);
  const sitePlacement = createLocalPlacement(writer);
  const site = writer.add("IFCSITE", [
    ...writer.rootArgs(ownerHistory, "Terreno"),
    writer.ref(sitePlacement),
    "$",
    "$",
    ".ELEMENT.",
    "$",
    "$",
    "$",
    "$",
    "$",
  ]);

  const buildingPlacement = createLocalPlacement(writer, writer.ref(sitePlacement));
  const building = writer.add("IFCBUILDING", [
    ...writer.rootArgs(ownerHistory, "Edificação"),
    writer.ref(buildingPlacement),
    "$",
    "$",
    ".ELEMENT.",
    "$",
    "$",
    "$",
  ]);
  const storeyPlacement = createLocalPlacement(writer, writer.ref(buildingPlacement));
  const storey = writer.add("IFCBUILDINGSTOREY", [
    ...writer.rootArgs(ownerHistory, "Nível 0"),
    writer.ref(storeyPlacement),
    "$",
    "$",
    ".ELEMENT.",
    "0.",
  ]);
  addAggregates(writer, ownerHistory, project, site, building, storey);
  return { ...base, project, site, sitePlacement, building, buildingPlacement, storey, storeyPlacement };
}

function addAggregates(writer, ownerHistory, project, site, building, storey) {
  [[project, site], [site, building], [building, storey]].forEach(([parent, child]) => {
    writer.add("IFCRELAGGREGATES", [
      ...writer.rootArgs(ownerHistory, "Agregação", "$", "$"),
      writer.ref(parent),
      writer.refs([child]),
    ]);
  });
}

function createElement(writer, state, extrusion, localPlacement, productShape, ownerHistory) {
  const info = getElementInfo(state.category, writer.schema);
  const baseArgs = [
    ...writer.rootArgs(ownerHistory, extrusion.name),
    writer.ref(localPlacement),
    writer.ref(productShape),
    "$",
  ];
  if (writer.schema === IFC_SCHEMA.IFC4 && info.type === "IFCBUILDINGELEMENTPROXY") {
    return writer.add(info.type, [...baseArgs, info.predefined]);
  }
  return writer.add(info.type, baseArgs);
}

function hexToRgb01(hex) {
  const value = String(hex || "#4aa3df").trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(value);
  const normalized = match ? match[1] : "4aa3df";
  return [0, 2, 4].map((i) => parseInt(normalized.slice(i, i + 2), 16) / 255);
}
function addSurfaceColorStyle(writer, itemId, form) {
  const [r, g, b] = hexToRgb01(form.material?.color);
  const color = writer.add("IFCCOLOURRGB", ["$", num(r), num(g), num(b)]);
  const rendering = writer.add("IFCSURFACESTYLERENDERING", [writer.ref(color), "0.", "$", "$", "$", "$", "$", "$", ".NOTDEFINED."]);
  const surfaceStyle = writer.add("IFCSURFACESTYLE", [optStr(`${form.name || "Forma"} ACI`), ".BOTH.", `(${writer.ref(rendering)})`]);
  const presentationStyle = writer.add("IFCPRESENTATIONSTYLEASSIGNMENT", [`(${writer.ref(surfaceStyle)})`]);
  writer.add("IFCSTYLEDITEM", [writer.ref(itemId), `(${writer.ref(presentationStyle)})`, "$"]);
}

function addExtrusion(writer, state, extrusion, profile, params, context, ownerHistory) {
  const depth = Math.max(evalValue(extrusion.depth, params), 0.001);
  const offset = Number(extrusion.offset) || 0;
  const position = extrusion.position || {};
  // The extrusion's world offset (form.position, e.g. from dragging the
  // element) is the LOCAL PLACEMENT's translation; the solid's own Position
  // stays at the origin of that same frame. Profile points and the offset
  // (extrusion start height) are stored raw/unshifted, so this is the only
  // translation applied - giving each element exactly one placement, not two
  // stacked ones (which previously double-counted a translation and also
  // silently dropped form.position from the export entirely).
  const origin = writer.add("IFCCARTESIANPOINT", [
    `(${num(Number(position.x) || 0)},${num(Number(position.y) || 0)},${num(Number(position.z) || 0)})`,
  ]);
  const axisZ = writer.add("IFCDIRECTION", ["(0.,0.,1.)"]);
  const axisX = writer.add("IFCDIRECTION", ["(1.,0.,0.)"]);
  const placement3d = writer.add("IFCAXIS2PLACEMENT3D", [writer.ref(origin), writer.ref(axisZ), writer.ref(axisX)]);
  const localPlacement = writer.add("IFCLOCALPLACEMENT", [writer.ref(context.storeyPlacement), writer.ref(placement3d)]);
  const pointIds = profile.points.map((point) =>
    writer.add("IFCCARTESIANPOINT", [`(${num(point.x)},${num(point.y)})`]),
  );
  if (pointIds[0] !== pointIds.at(-1)) pointIds.push(pointIds[0]);
  const polyline = writer.add("IFCPOLYLINE", [writer.refs(pointIds)]);
  const innerCurves = (profile.holes || []).map((loop) => {
    const ids = loop.map((point) => writer.add("IFCCARTESIANPOINT", [`(${num(point.x)},${num(point.y)})`]));
    ids.push(ids[0]);
    return writer.add("IFCPOLYLINE", [writer.refs(ids)]);
  });
  const profileDef = innerCurves.length
    ? writer.add("IFCARBITRARYPROFILEDEFWITHVOIDS", [".AREA.", optStr(profile.name), writer.ref(polyline), writer.refs(innerCurves)])
    : writer.add("IFCARBITRARYCLOSEDPROFILEDEF", [".AREA.", optStr(profile.name), writer.ref(polyline)]);
  const solidOrigin = writer.add("IFCCARTESIANPOINT", [`(0.,0.,${num(offset)})`]);
  const solidPlacement = writer.add("IFCAXIS2PLACEMENT3D", [writer.ref(solidOrigin), writer.ref(axisZ), writer.ref(axisX)]);
  const direction = writer.add("IFCDIRECTION", ["(0.,0.,1.)"]);
  const solid = writer.add("IFCEXTRUDEDAREASOLID", [writer.ref(profileDef), writer.ref(solidPlacement), writer.ref(direction), num(depth)]);
  addSurfaceColorStyle(writer, solid, extrusion);
  const representation = writer.add("IFCSHAPEREPRESENTATION", [
    writer.ref(context.context),
    "'Body'",
    "'SweptSolid'",
    writer.refs([solid]),
  ]);
  const productShape = writer.add("IFCPRODUCTDEFINITIONSHAPE", ["$", "$", writer.refs([representation])]);
  return createElement(writer, state, extrusion, localPlacement, productShape, ownerHistory);
}
function triangulateGeometry(geometry) {
  const position = geometry?.attributes?.position;
  if (!position || position.count < 3) return [];
  const index = geometry.index?.array;
  const triangles = [];
  const readPoint = (vertexIndex) => ({
    x: position.getX(vertexIndex) * 1000,
    y: position.getY(vertexIndex) * 1000,
    z: position.getZ(vertexIndex) * 1000,
  });
  const pushTriangle = (a, b, c) => {
    const points = [readPoint(a), readPoint(b), readPoint(c)];
    const area = Math.hypot(
      (points[1].y - points[0].y) * (points[2].z - points[0].z) - (points[1].z - points[0].z) * (points[2].y - points[0].y),
      (points[1].z - points[0].z) * (points[2].x - points[0].x) - (points[1].x - points[0].x) * (points[2].z - points[0].z),
      (points[1].x - points[0].x) * (points[2].y - points[0].y) - (points[1].y - points[0].y) * (points[2].x - points[0].x),
    ) / 2;
    if (area > 1e-6) triangles.push(points);
  };
  if (index) {
    for (let i = 0; i + 2 < index.length; i += 3) pushTriangle(index[i], index[i + 1], index[i + 2]);
  } else {
    for (let i = 0; i + 2 < position.count; i += 3) pushTriangle(i, i + 1, i + 2);
  }
  return triangles;
}

function addFacetedBrep(writer, triangles) {
  const faces = triangles.map((triangle) => {
    const pointIds = triangle.map((point) =>
      writer.add("IFCCARTESIANPOINT", [`(${num(point.x)},${num(point.y)},${num(point.z)})`]),
    );
    const loop = writer.add("IFCPOLYLOOP", [writer.refs(pointIds)]);
    const bound = writer.add("IFCFACEOUTERBOUND", [writer.ref(loop), ".T."]);
    return writer.add("IFCFACE", [`(${writer.ref(bound)})`]);
  });
  const shell = writer.add("IFCCLOSEDSHELL", [writer.refs(faces)]);
  return writer.add("IFCFACETEDBREP", [writer.ref(shell)]);
}

function addMeshForm(writer, state, form, context, ownerHistory) {
  const geometry = buildGeometry(state, form);
  const triangles = triangulateGeometry(geometry);
  geometry?.dispose?.();
  if (!triangles.length) return null;
  const axisPoint = writer.add("IFCCARTESIANPOINT", ["(0.,0.,0.)"]);
  const axisZ = writer.add("IFCDIRECTION", ["(0.,0.,1.)"]);
  const axisX = writer.add("IFCDIRECTION", ["(1.,0.,0.)"]);
  const placement3d = writer.add("IFCAXIS2PLACEMENT3D", [writer.ref(axisPoint), writer.ref(axisZ), writer.ref(axisX)]);
  const localPlacement = writer.add("IFCLOCALPLACEMENT", [writer.ref(context.storeyPlacement), writer.ref(placement3d)]);
  const brep = addFacetedBrep(writer, triangles);
  addSurfaceColorStyle(writer, brep, form);
  const representation = writer.add("IFCSHAPEREPRESENTATION", [
    writer.ref(context.context),
    "'Body'",
    "'Brep'",
    writer.refs([brep]),
  ]);
  const productShape = writer.add("IFCPRODUCTDEFINITIONSHAPE", ["$", "$", writer.refs([representation])]);
  return createElement(writer, state, form, localPlacement, productShape, ownerHistory);
}
function createModel(writer, state) {
  const ownerHistory = createOwnerHistory(writer);
  const context = writer.schema === IFC_SCHEMA.IFC4
    ? createIfc4SpatialStructure(writer, state.name, ownerHistory)
    : createIfc2x3SpatialStructure(writer, state.name, ownerHistory);
  const params = parameterMap(state);
  const elementIds = [];
  const forms = (state.forms?.length ? state.forms : state.extrusions).filter(
    (item) => item.visible !== false && (item.operation || "solid") === "solid" && (item.kind === undefined || isSolidKind(item.kind)),
  );
  for (const form of forms) {
    const profile = state.profiles.find((item) => item.id === form.profileId && item.visible !== false);
    if (!profile || profile.points.length < 3) continue;
    if (["extrusion", undefined].includes(form.kind)) {
      elementIds.push(addExtrusion(writer, state, form, profile, params, context, ownerHistory));
      continue;
    }
    const elementId = addMeshForm(writer, state, form, context, ownerHistory);
    if (elementId) elementIds.push(elementId);
  }
  if (!elementIds.length) {
    throw new Error("Crie ao menos uma forma sólida exportável antes de exportar IFC.");
  }
  writer.add("IFCRELCONTAINEDINSPATIALSTRUCTURE", [
    ...writer.rootArgs(ownerHistory, "Contenção espacial", "$", "$"),
    writer.refs(elementIds),
    writer.ref(context.storey),
  ]);
}

export function exportFamilyToIfc(state, schema = IFC_SCHEMA.IFC4) {
  if (!Object.values(IFC_SCHEMA).includes(schema)) {
    throw new Error("Escolha IFC2X3 ou IFC4.");
  }
  const writer = new IfcWriter(schema);
  createModel(writer, state);
  return [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('ViewDefinition [CoordinationView]','ExporterVersion ${IFC_EXPORTER_VERSION}'),'2;1');`,
    `FILE_NAME('${sanitize(state.name)}.ifc','${new Date().toISOString()}',('EngRodrigo'),('EngRodrigo'),'${APP_NAME}','${APP_NAME}','');`,
    `FILE_SCHEMA(('${schema}'));`,
    "ENDSEC;",
    "DATA;",
    ...writer.lines,
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}