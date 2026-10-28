const assert = require("assert");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");

const root = path.join(__dirname, "..");
const viewerSource = require("./_viewer-source").readAuthenticatedViewerSource(root);
const excelSource = fs.readFileSync(path.join(root, "3D/excel-export.js"), "utf8");

function decodeXml(value) {
    return value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");
}

async function readAssociaRows() {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(root, "base_de_dados.xlsx")));
    const sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
    const sharedStrings = Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g), (match) =>
        decodeXml(Array.from(match[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g), (text) => text[1]).join(""))
    );
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
    const rows = Array.from(sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g), (rowMatch) => {
        const cells = {};
        for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
            const column = cellMatch[1].match(/r="([A-Z]+)\d+"/)?.[1];
            const value = cellMatch[2].match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
            const isSharedString = /t="s"/.test(cellMatch[1]);
            cells[column] = isSharedString ? sharedStrings[Number(value)] : decodeXml(value);
        }
        return cells;
    });
    const [header, ...data] = rows;
    const descriptionColumn = Object.keys(header).find((column) => /descri/i.test(header[column]));
    const unitColumn = Object.keys(header).find((column) => /unidade/i.test(header[column]));
    return data.map((row) => ({ description: row[descriptionColumn] || "", unit: row[unitColumn] || "" }));
}

(async () => {
    const rows = await readAssociaRows();
    const cable = rows.find((row) => row.description.includes("Cabo Unipolar") && row.description.includes("1.5 mm²") && row.description.includes("Amarelo"));
    const conduit = rows.find((row) => row.description.includes("Eletroduto PVC") && row.description.includes("vara 3,0m") && row.description.includes('1"'));
    const unitMaterial = rows.find((row) => String(row.unit).trim().toLowerCase() === "un");

    assert.ok(cable, "o cabo do caso de regressão deve existir na aba Associa");
    assert.strictEqual(cable.unit.trim().toLowerCase(), "m");
    assert.strictEqual(25110 / 100, 251.1, "o quantitativo linear deve ser convertido de cm para m");
    assert.ok(conduit, "o eletroduto linear deve existir na aba Associa");
    assert.strictEqual(conduit.unit.trim().toLowerCase(), "m");
    assert.ok(unitMaterial, "a aba Associa deve continuar contendo materiais UN");

    assert.match(viewerSource, /await ensureMaterialsClassificationReady\(\);[\s\S]*?const items = collectQuantitativeMaterials\(\);/);
    assert.match(viewerSource, /isIfcLengthMeasure\(prop\?\.value\)[\s\S]*?isExplicitLinearMaterial/);
    assert.match(viewerSource, /quantity: numericValue \/ 100,[\s\S]*?unitLabel: "metro\(s\)"/);
    assert.match(viewerSource, /quantity: numericValue,[\s\S]*?unitLabel: "item\(ns\)"/);
    assert.match(viewerSource, /await generateAndRenderMaterialsList\(\);/);
    assert.match(viewerSource, /const associatedMaterials = await openMaterialsPanelAndFilterByBudgetReference/);
    assert.match(excelSource, /item\.quantity[\s\S]*?item\.unitLabel/);
    assert.match(excelSource, /const workbookLoadPromises = new Map\(\)/);

    console.log("materials classification and lazy-loading regression: ok");
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});