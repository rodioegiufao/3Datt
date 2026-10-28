import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { buildGeometryCached } from "./geometry-engine.js";

// Voids are modeling tools (they only exist to be subtracted from a solid via
// CSG) - the family's actual geometry, and the only thing worth exporting to a
// mesh format for reuse elsewhere, is its visible solids. Their geometry is
// already the final, CSG-cut result (the same instances rendered in the 3D
// view), fetched through the shared cache rather than rebuilt from scratch.
function buildExportGroup(state) {
  const group = new THREE.Group();
  const solids = (state.forms || state.extrusions || []).filter(
    (form) => form.operation !== "void" && form.visible !== false,
  );
  for (const form of solids) {
    let geometry;
    try {
      geometry = buildGeometryCached(state, form);
    } catch {
      continue;
    }
    if (!geometry) continue;
    const material = new THREE.MeshStandardMaterial({ color: form.material?.color || "#4aa3df" });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = (form.name || form.id).replace(/[^\w.-]+/g, "_");
    group.add(mesh);
  }
  if (!group.children.length) throw new Error("Nenhuma forma sólida visível para exportar.");
  return group;
}

// Resolves with an ArrayBuffer containing a single-file binary glTF (.glb) -
// simplest to hand off as one download, with geometry, materials and node
// names embedded (no separate .bin/texture files to keep track of).
export function exportToGlb(state) {
  const group = buildExportGroup(state);
  const exporter = new GLTFExporter();
  return new Promise((resolve, reject) => {
    exporter.parse(group, resolve, reject, { binary: true });
  });
}

export function exportToObj(state) {
  const group = buildExportGroup(state);
  return new OBJExporter().parse(group);
}
