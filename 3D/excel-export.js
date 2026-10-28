// excel-export.js

export async function downloadMaterialsAsExcel(items, normalizeSearchText) {
    if (!Array.isArray(items) || !items.length) {
        return;
    }

    const normalizeFn =
        typeof normalizeSearchText === "function"
            ? normalizeSearchText
            : (s) => String(s ?? "").trim().toLowerCase();

    // ✅ Carrega as associações do Excel colocado na pasta pública do site
    // (mesma pasta/rota onde seus JS são servidos)
    const associationDefinitions = await loadAssociationDefinitionsFromExcel({
        excelPath: "./base_de_dados.xlsx",
    });

    const itemsByDescription = getItemsByDescription(items, normalizeFn);
    const { associationRows, matchedDescriptions } = buildAssociationRows(
        associationDefinitions,
        itemsByDescription,
        normalizeFn
    );

    const rows = items
        .map((item) => {
            const normalizedName = normalizeFn(item.name);
            const statusStyle = matchedDescriptions.has(normalizedName) ? "Matched" : "Unmatched";
            return `
        <Row ss:StyleID="${statusStyle}">
            <Cell><Data ss:Type="String">${sanitizeSpreadsheetCell(item.name)}</Data></Cell>
            <Cell><Data ss:Type="Number">${Number.isFinite(item.quantity) ? item.quantity : 0}</Data></Cell>
            <Cell><Data ss:Type="String">${sanitizeSpreadsheetCell(item.unitLabel)}</Data></Cell>
        </Row>
    `;
        })
        .join("");

    const spreadsheetXml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
    <Styles>
        <Style ss:ID="Matched">
            <Interior ss:Color="#C6EFCE" ss:Pattern="Solid" />
        </Style>
        <Style ss:ID="Unmatched">
            <Interior ss:Color="#FFF2CC" ss:Pattern="Solid" />
        </Style>
    </Styles>
    <Worksheet ss:Name="Materiais">
        <Table>
            <Row>
                <Cell><Data ss:Type="String">Descrição</Data></Cell>
                <Cell><Data ss:Type="String">Quantidade</Data></Cell>
                <Cell><Data ss:Type="String">Unidade</Data></Cell>
            </Row>
            ${rows}
        </Table>
    </Worksheet>
    <Worksheet ss:Name="Associacoes">
        <Table>
            <Row>
                <Cell><Data ss:Type="String">Item</Data></Cell>
                <Cell><Data ss:Type="String">Código</Data></Cell>
                <Cell><Data ss:Type="String">Banco</Data></Cell>
                <Cell><Data ss:Type="String">Descrição</Data></Cell>
                <Cell><Data ss:Type="String">Und</Data></Cell>
                <Cell><Data ss:Type="String">Quant.</Data></Cell>
            </Row>
            ${associationRows
                .map(
                    (association, index) => `
        <Row>
            <Cell><Data ss:Type="String">1.${index + 1}</Data></Cell>
            <Cell><Data ss:Type="String">${sanitizeSpreadsheetCell(association.codigo)}</Data></Cell>
            <Cell><Data ss:Type="String">${sanitizeSpreadsheetCell(association.base)}</Data></Cell>
            <Cell><Data ss:Type="String">${sanitizeSpreadsheetCell(association.descricao)}</Data></Cell>
            <Cell><Data ss:Type="String">${sanitizeSpreadsheetCell(association.unidade)}</Data></Cell>
            <Cell><Data ss:Type="Number">${association.quantidade}</Data></Cell>
        </Row>
    `
                )
                .join("")}
        </Table>
    </Worksheet>
</Workbook>`;

    const blob = new Blob([spreadsheetXml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const now = new Date();
    const dateStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
        now.getDate()
    ).padStart(2, "0")}`;

    link.href = url;
    link.download = `lista_materiais_${dateStamp}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function sanitizeSpreadsheetCell(value) {
    const text = String(value ?? "");
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
}

function getItemsByDescription(items, normalizeSearchText) {
    return items.reduce((acc, item) => {
        const normalizedName = normalizeSearchText(item.name);
        const quantity = Number.isFinite(item.quantity) ? item.quantity : 0;
        const unitLabel = item.unitLabel ? String(item.unitLabel).trim() : "";
        const displayName = item.name ? String(item.name).trim() : "";
        if (acc.has(normalizedName)) {
            const current = acc.get(normalizedName);
            current.quantity += quantity;
            if (!current.unitLabel && unitLabel) {
                current.unitLabel = unitLabel;
            }
            if (!current.displayName && displayName) {
                current.displayName = displayName;
            }
        } else {
            acc.set(normalizedName, {
                quantity,
                unitLabel,
                displayName,
            });
        }
        return acc;
    }, new Map());
}

function buildAssociationRows(associationDefinitions, itemsByDescription, normalizeSearchText) {
    const aggregated = new Map();
    const matchedDescriptions = new Set();
    const targetItemNormalized = normalizeSearchText(
        'Dispositivo Elétrico - embutido - Placa 4x4" - Interruptor 2 teclas simples'
    );

    associationDefinitions.forEach((association) => {
        const normalizedDescription = normalizeSearchText(association.itemDescricao || "");
        const matchData = itemsByDescription.get(normalizedDescription);
        const quantidade = matchData?.quantity || 0;
        if (quantidade <= 0) {
            return;
        }

        matchedDescriptions.add(normalizedDescription);

        const key = association.codigo
            ? `codigo:${association.codigo}`
            : `descricao:${association.descricao}|${association.base}|${association.unidade}`;
        const current = aggregated.get(key);

        if (current) {
            current.quantidade += quantidade;
            return;
        }

        aggregated.set(key, {
            codigo: association.codigo,
            base: association.base,
            descricao: association.descricao,
            unidade: association.unidade,
            quantidade,
            matchStatus: "matched",
        });
    });

    const targetMatch = itemsByDescription.get(targetItemNormalized);
    const targetQuantity = targetMatch?.quantity || 0;
    if (targetQuantity > 0) {
        matchedDescriptions.add(targetItemNormalized);
        const specialKey = "codigo:91974";
        const specialQuantity = targetQuantity / 2;
        const existingSpecial = aggregated.get(specialKey);

        if (existingSpecial) {
            existingSpecial.quantidade += specialQuantity;
        } else {
            aggregated.set(specialKey, {
                codigo: "91974",
                base: "SINAPI",
                descricao:
                    "INTERRUPTOR SIMPLES (4 MÓDULOS), 10A/250V, INCLUINDO SUPORTE E PLACA - FORNECIMENTO E INSTALAÇÃO. AF_03/2023",
                unidade: "UN",
                quantidade: specialQuantity,
                matchStatus: "matched",
            });
        }
    }

    return {
        associationRows: Array.from(aggregated.values()),
        matchedDescriptions,
    };
}

/* ===========================
   ✅ Leitura do base_de_dados.xlsx
   - Aba "Descricao": CÓDIGO, BASE, DESCRIÇÃO, UNIDADE
   - Aba "Associa":  Descrição (vira itemDescricao)
   Obs: por padrão, casa por CÓDIGO se existir na aba Associa; se não, casa por índice de linha.
   =========================== */

let cachedAssociationDefinitions = null;
let cachedExcelPath = null;
let cachedAssociaUnits = null;
let cachedAssociaUnitsPath = null;
let xlsxLoadPromise = null;
const workbookLoadPromises = new Map();

async function ensureXLSXLoaded() {
    if (window.XLSX) return;

    if (!xlsxLoadPromise) {
        xlsxLoadPromise = new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
            script.onload = resolve;
            script.onerror = () => {
                xlsxLoadPromise = null;
                reject(new Error("Falha ao carregar a biblioteca XLSX (SheetJS)."));
            };
            document.head.appendChild(script);
        });
    }
    await xlsxLoadPromise;
}

function pickHeader(rowObj, headerNames) {
    if (!rowObj) return undefined;

    const keys = Object.keys(rowObj);
    const normalizedMap = new Map(keys.map((k) => [String(k).trim().toLowerCase(), k]));

    for (const h of headerNames) {
        const foundKey = normalizedMap.get(String(h).trim().toLowerCase());
        if (foundKey) return rowObj[foundKey];
    }
    return undefined;
}

async function loadWorkbookFromExcel(excelPath) {
    if (workbookLoadPromises.has(excelPath)) {
        return workbookLoadPromises.get(excelPath);
    }

    const loadPromise = (async () => {
        await ensureXLSXLoaded();
        const res = await fetch(excelPath, { cache: "no-store" });
        if (!res.ok) {
            throw new Error(`Não foi possível carregar "${excelPath}" (status ${res.status}).`);
        }
        const arrayBuffer = await res.arrayBuffer();
        return window.XLSX.read(arrayBuffer, { type: "array" });
    })();

    workbookLoadPromises.set(excelPath, loadPromise);
    loadPromise.catch(() => {
        if (workbookLoadPromises.get(excelPath) === loadPromise) {
            workbookLoadPromises.delete(excelPath);
        }
    });
    return loadPromise;
}

export async function loadAssociationDefinitionsFromExcel({ excelPath = "./base_de_dados.xlsx" } = {}) {
    // cache para não buscar/parsear toda hora
    if (cachedAssociationDefinitions && cachedExcelPath === excelPath) {
        return cachedAssociationDefinitions;
    }

    const workbook = await loadWorkbookFromExcel(excelPath);

    // No arquivo que você enviou:
    // - "Descricao" tem CÓDIGO/BASE/DESCRIÇÃO/UNIDADE
    // - "Associa" tem Descrição (itemDescricao)
    const sheetDetails =
        workbook.Sheets["Descricao"] ||
        workbook.Sheets["DESCRICAO"] ||
        workbook.Sheets[workbook.SheetNames[0]];

    const sheetItems =
        workbook.Sheets["Associa"] ||
        workbook.Sheets["ASSOCIA"] ||
        workbook.Sheets[workbook.SheetNames[1]];

    const detailsRows = window.XLSX.utils.sheet_to_json(sheetDetails, { defval: "" });
    const itemRows = sheetItems ? window.XLSX.utils.sheet_to_json(sheetItems, { defval: "" }) : [];

    // Se a aba "Associa" tiver CÓDIGO, tenta casar por código; senão, usa índice de linha.
    const itemByCode = new Map();
    for (const r of itemRows) {
        const codigo = pickHeader(r, ["CÓDIGO", "CODIGO", "codigo"]);
        const itemDesc = pickHeader(r, ["Descrição", "DESCRIÇÃO", "descricao", "Item", "itemDescricao"]);
        if (codigo) itemByCode.set(String(codigo).trim(), String(itemDesc || "").trim());
    }

    const associationDefinitions = detailsRows
        .map((r, idx) => {
            const codigo = String(pickHeader(r, ["CÓDIGO", "CODIGO", "codigo"]) || "").trim();
            const base = String(pickHeader(r, ["BASE", "base"]) || "").trim();
            const descricao = String(pickHeader(r, ["DESCRIÇÃO", "DESCRICAO", "descricao"]) || "").trim();
            const unidade = String(pickHeader(r, ["UNIDADE", "unidade"]) || "").trim();

            let itemDescricao = "";
            if (codigo && itemByCode.has(codigo)) {
                itemDescricao = itemByCode.get(codigo);
            } else if (itemRows[idx]) {
                itemDescricao = String(
                    pickHeader(itemRows[idx], ["Descrição", "DESCRIÇÃO", "descricao", "Item", "itemDescricao"]) || ""
                ).trim();
            }

            return { codigo, base, descricao, unidade, itemDescricao };
        })
        .filter((x) => x.codigo || x.descricao || x.itemDescricao);

    cachedAssociationDefinitions = associationDefinitions;
    cachedExcelPath = excelPath;

    return associationDefinitions;
}

export async function loadAssociaUnitsFromExcel({ excelPath = "./base_de_dados.xlsx" } = {}) {
    if (cachedAssociaUnits && cachedAssociaUnitsPath === excelPath) {
        return cachedAssociaUnits;
    }

    const workbook = await loadWorkbookFromExcel(excelPath);

    const sheetItems =
        workbook.Sheets["Associa"] ||
        workbook.Sheets["ASSOCIA"] ||
        workbook.Sheets[workbook.SheetNames[1]];

    if (!sheetItems) {
        cachedAssociaUnits = [];
        cachedAssociaUnitsPath = excelPath;
        return cachedAssociaUnits;
    }

    const itemRows = window.XLSX.utils.sheet_to_json(sheetItems, { defval: "" });
    const associationUnits = itemRows
        .map((row) => {
            const descricao = String(
                pickHeader(row, ["Descrição", "DESCRIÇÃO", "descricao", "Item", "itemDescricao"]) || ""
            ).trim();
            const unidade = String(pickHeader(row, ["Unidade", "UNIDADE", "unidade"]) || "").trim();
            return { descricao, unidade };
        })
        .filter((row) => row.descricao);

    cachedAssociaUnits = associationUnits;
    cachedAssociaUnitsPath = excelPath;

    return associationUnits;
}
