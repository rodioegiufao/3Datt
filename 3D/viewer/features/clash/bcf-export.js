// Exportação das interferências para um único arquivo .bcfzip (BCF 2.1).
// Cada interferência vira um tópico com: título, descrição dos dois elementos,
// foto no modo isolamento, peças selecionadas (GUID do IFC), cores A/B e câmera.
// Abre no Revit, Navisworks, BIMcollab, Solibri, QiVisus Collab etc.
import { ensureJSZip } from "./bcf-import.js";

const xml = (value) => String(value ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
}));

// Visualizador (Y para cima) → IFC/BCF (Z para cima)
const toBcf = (v) => [v[0], -v[2], v[1]];
const num = (n) => Number(n).toFixed(6).replace(/\.?0+$/, "") || "0";
const point = (tag, v) => `<${tag}><X>${num(v[0])}</X><Y>${num(v[1])}</Y><Z>${num(v[2])}</Z></${tag}>`;

const STATUS = {
    novo: "Active",
    revisao: "Active",
    aceito: "Active",
    resolvido: "Closed",
    ignorado: "Closed"
};

function objectGuid(object) {
    return object?.originalSystemId || object?.guid || object?.objectId || "";
}

function objectLabel(object) {
    const name = object.name && object.name !== object.type ? `${object.name} (${object.type})` : object.type;
    return `${name} | ${object.modelLabel || object.modelId}`;
}

function markupXml({ topicGuid, viewpointGuid, index, clash, meta, statusLabel, url, snapshotName }) {
    const title = `Interferência ${index + 1} - ${clash.objectA.type} x ${clash.objectB.type}`;
    const position = Array.isArray(clash.position) ? clash.position.map((n) => Number(n).toFixed(3)).join(" / ") : "-";
    const description = [
        `${meta.modeLabel} entre ${meta.groupA} e ${meta.groupB}.`,
        `A: ${objectLabel(clash.objectA)} | ID: ${objectGuid(clash.objectA)}`,
        `B: ${objectLabel(clash.objectB)} | ID: ${objectGuid(clash.objectB)}`,
        `Posição X / Y / Z no visualizador (m): ${position}`,
        `Status no visualizador: ${statusLabel}`
    ].join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<Markup>
  <Topic Guid="${topicGuid}" TopicType="Clash" TopicStatus="${STATUS[clash.status] || "Active"}">
    ${url ? `<ReferenceLink>${xml(url)}</ReferenceLink>` : ""}
    <Title>${xml(title)}</Title>
    <Priority>Normal</Priority>
    <Index>${index + 1}</Index>
    <Labels>Compatibilização</Labels>
    <Labels>${xml(`${meta.groupA} x ${meta.groupB}`)}</Labels>
    <CreationDate>${meta.createdAt}</CreationDate>
    <CreationAuthor>${xml(meta.author)}</CreationAuthor>
    <Description>${xml(description)}</Description>
  </Topic>
  <Viewpoints Guid="${viewpointGuid}">
    <Viewpoint>viewpoint.bcfv</Viewpoint>
    ${snapshotName ? `<Snapshot>${snapshotName}</Snapshot>` : ""}
  </Viewpoints>
</Markup>
`;
}

function viewpointXml({ viewpointGuid, clash, camera }) {
    const guidA = objectGuid(clash.objectA);
    const guidB = objectGuid(clash.objectB);
    const selection = [guidA, guidB].filter(Boolean).map((g) => `<Component IfcGuid="${xml(g)}" />`).join("");
    let cameraXml = "";
    if (camera?.eye && camera?.look) {
        const eye = toBcf(camera.eye);
        const look = toBcf(camera.look);
        const dir = [look[0] - eye[0], look[1] - eye[1], look[2] - eye[2]];
        const len = Math.hypot(...dir) || 1;
        const up = toBcf(camera.up || [0, 1, 0]);
        cameraXml = `
  <PerspectiveCamera>
    ${point("CameraViewPoint", eye)}
    ${point("CameraDirection", dir.map((d) => d / len))}
    ${point("CameraUpVector", up)}
    <FieldOfView>${num(camera.fov || 60)}</FieldOfView>
  </PerspectiveCamera>`;
    }
    return `<?xml version="1.0" encoding="UTF-8"?>
<VisualizationInfo Guid="${viewpointGuid}">
  <Components>
    <Selection>${selection}</Selection>
    <Visibility DefaultVisibility="true" />
    <Coloring>
      ${guidA ? `<Color Color="FFFFC400"><Component IfcGuid="${xml(guidA)}" /></Color>` : ""}
      ${guidB ? `<Color Color="FFEB3C14"><Component IfcGuid="${xml(guidB)}" /></Color>` : ""}
    </Coloring>
  </Components>${cameraXml}
</VisualizationInfo>
`;
}

function dataUrlToBytes(dataUrl) {
    const [head, data] = String(dataUrl).split(",");
    const binary = atob(data || "");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, isPng: /image\/png/.test(head) };
}

/**
 * Monta o .bcfzip.
 * @param {object} options
 * @param {Array} options.clashes interferências (com status)
 * @param {Function} options.capture async (clash, index) => { image, url, camera } | null
 * @param {object} options.meta { project, groupA, groupB, modeLabel, author }
 * @param {Function} [options.statusLabelOf]
 * @param {Function} [options.onProgress] (atual, total)
 * @returns {Promise<Blob>}
 */
export async function buildClashBcfZip({ clashes, capture, meta, statusLabelOf = (s) => s, onProgress = () => {} }) {
    const JSZip = await ensureJSZip();
    const zip = new JSZip();
    const createdAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const info = { ...meta, createdAt };

    zip.file("bcf.version", `<?xml version="1.0" encoding="UTF-8"?>
<Version VersionId="2.1">
  <DetailedVersion>2.1</DetailedVersion>
</Version>
`);
    zip.file("project.bcfp", `<?xml version="1.0" encoding="UTF-8"?>
<ProjectExtension>
  <Project ProjectId="${uuid()}">
    <Name>${xml(meta.project)}</Name>
  </Project>
  <ExtensionSchema></ExtensionSchema>
</ProjectExtension>
`);

    for (let i = 0; i < clashes.length; i++) {
        onProgress(i + 1, clashes.length);
        const clash = clashes[i];
        const topicGuid = uuid();
        const viewpointGuid = uuid();
        let shot = null;
        try {
            shot = await capture(clash, i);
        } catch (error) {
            console.warn("[BCF] Falha ao capturar a interferência", i + 1, error);
        }
        let snapshotName = null;
        if (shot?.image) {
            const { bytes, isPng } = dataUrlToBytes(shot.image);
            snapshotName = isPng ? "snapshot.png" : "snapshot.jpg";
            zip.file(`${topicGuid}/${snapshotName}`, bytes);
        }
        zip.file(`${topicGuid}/markup.bcf`, markupXml({
            topicGuid, viewpointGuid, index: i, clash, meta: info,
            statusLabel: statusLabelOf(clash.status), url: shot?.url, snapshotName
        }));
        zip.file(`${topicGuid}/viewpoint.bcfv`, viewpointXml({ viewpointGuid, clash, camera: shot?.camera }));
    }
    return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
