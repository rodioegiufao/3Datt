// Regras das Instalações civis: sigla do arquivo → rede, sub-rede → composição.
const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

(async () => {
    const core = await import(pathToFileURL(path.join(__dirname, "../3D/viewer/features/civil/civil-core.js")).href);

    // Rede pela sigla do nome do arquivo/modelo
    assert.strictEqual(core.detectCivilDiscipline("IFC-HID-IPER-16-07-2026.ifc").code, "HID");
    assert.strictEqual(core.detectCivilDiscipline("IFC_IRRI").code, "IRRI");
    assert.strictEqual(core.detectCivilDiscipline("XKT-SAN-TCE.xkt").code, "SAN");
    assert.strictEqual(core.detectCivilDiscipline("modelos/PLU-v2.xkt").code, "PLU");
    assert.strictEqual(core.detectCivilDiscipline("IFC_INC").code, "INC");
    assert.strictEqual(core.detectCivilDiscipline("IFC_GLP_casa").code, "GLP");
    assert.strictEqual(core.detectCivilDiscipline("IFC_LOG_TEF"), null);
    assert.strictEqual(core.detectCivilDiscipline("IFC_ARQ", "Arquitetura"), null);
    assert.strictEqual(core.detectCivilDiscipline("HIDRAULICA_SEM_SIGLA"), null, "só a sigla isolada vale");

    const associa = [
        { "DESCRIÇÃO": "PVC rígido soldável - Tubos - 32 mm", "UNIDADE": "M", "REDE": "HIDRÁULICO", "SUBREDE": "ALIMENTAÇÃO" },
        { "DESCRIÇÃO": "PVC rígido soldável - Tubos - 32 mm", "UNIDADE": "M", "REDE": "HIDRÁULICO", "SUBREDE": "ÁGUA FRIA" },
        { "DESCRIÇÃO": "PVC rígido soldável - Tubos - 32 mm", "UNIDADE": "M", "REDE": "IRRIGAÇÃO", "SUBREDE": "" },
        { "DESCRIÇÃO": "PVC rígido soldável - Joelho 90º soldável - 32 mm", "UNIDADE": "UN", "REDE": "HIDRÁULICO", "SUBREDE": "ÁGUA FRIA" }
    ];
    const descricao = [
        { "CÓDIGO": "94649", "BASE": "SINAPI", "DESCRIÇÃO": "TUBO 32 RESERVAÇÃO", "UNIDADE": "M" },
        { "CÓDIGO": "89402", "BASE": "SINAPI", "DESCRIÇÃO": "TUBO 32 RAMAL", "UNIDADE": "M" },
        { "CÓDIGO": "89403", "BASE": "SINAPI", "DESCRIÇÃO": "TUBO 32 IRRIGAÇÃO", "UNIDADE": "M" },
        { "CÓDIGO": "89408", "BASE": "SINAPI", "DESCRIÇÃO": "JOELHO 32 RAMAL", "UNIDADE": "UN" }
    ];
    const db = core.buildCivilDatabase(associa, descricao);
    const HID = core.CIVIL_DISCIPLINES.find((d) => d.code === "HID");
    const IRRI = core.CIVIL_DISCIPLINES.find((d) => d.code === "IRRI");

    // Mesmo material, sub-redes diferentes → composições diferentes
    assert.strictEqual(core.resolveCivilItem(db, { material: "PVC rígido soldável - Tubos - 32 mm", network: "HIDRÁULICO", subnetwork: "Alimentação" }).entry.code, "94649");
    assert.strictEqual(core.resolveCivilItem(db, { material: "pvc rigido soldavel - tubos - 32 mm", network: "HIDRÁULICO", subnetwork: "Água fria" }).entry.code, "89402");
    // Rede sem sub-rede na base vale para qualquer sub-rede do modelo
    assert.strictEqual(core.resolveCivilItem(db, { material: "PVC rígido soldável - Tubos - 32 mm", network: "IRRIGAÇÃO", subnetwork: "Água fria" }).entry.code, "89403");
    // Existe na rede, mas em outra sub-rede → pendência com sugestão (não troca sozinho)
    const sub = core.resolveCivilItem(db, { material: "PVC rígido soldável - Joelho 90º soldável - 32 mm", network: "HIDRÁULICO", subnetwork: "Alimentação" });
    assert.strictEqual(sub.status, "subrede");
    assert.deepStrictEqual(sub.suggestions, ["ÁGUA FRIA"]);
    // Existe só em outra rede
    const other = core.resolveCivilItem(db, { material: "PVC rígido soldável - Joelho 90º soldável - 32 mm", network: "IRRIGAÇÃO", subnetwork: "Água fria" });
    assert.strictEqual(other.status, "ausente");
    assert.deepStrictEqual(other.otherNetworks, ["HIDRÁULICO"]);

    // Agregação: soma quantidades por composição e separa pendências
    const result = core.aggregateCivilPieces(db, [
        { objectId: "a", discipline: HID, subnetwork: "Água fria", material: "PVC rígido soldável - Tubos - 32 mm", quantity: 1.5, unitLabel: "metro(s)" },
        { objectId: "b", discipline: HID, subnetwork: "Água fria", material: "PVC rígido soldável - Tubos - 32 mm", quantity: 2, unitLabel: "metro(s)" },
        { objectId: "c", discipline: HID, subnetwork: "Alimentação", material: "PVC rígido soldável - Tubos - 32 mm", quantity: 4, unitLabel: "metro(s)" },
        { objectId: "d", discipline: IRRI, subnetwork: "Água fria", material: "PVC rígido soldável - Tubos - 32 mm", quantity: 1, unitLabel: "metro(s)" },
        { objectId: "e", discipline: IRRI, subnetwork: "Alimentação", material: "PVC rígido soldável - Tubos - 32 mm", quantity: 2, unitLabel: "metro(s)" },
        { objectId: "f", discipline: HID, subnetwork: "Alimentação", material: "PVC rígido soldável - Joelho 90º soldável - 32 mm", quantity: 1, unitLabel: "item(ns)" }
    ]);
    const byCode = Object.fromEntries(result.matched.map((m) => [m.code, m]));
    assert.strictEqual(byCode["89402"].quantity, 3.5);
    assert.strictEqual(byCode["94649"].quantity, 4);
    assert.strictEqual(byCode["89403"].quantity, 3, "irrigação soma as sub-redes do modelo");
    assert.strictEqual(byCode["89403"].subnetwork, "");
    assert.strictEqual(result.pending.length, 1);
    assert.match(core.describeCivilPending(result.pending[0]), /ÁGUA FRIA/);

    // Comprimento em cm convertido quando a composição é em metro
    assert.strictEqual(core.quantityInBaseUnit({ quantity: 250, unitLabel: "item(ns)" }, { unit: "M" }), 2.5);
    assert.strictEqual(core.quantityInBaseUnit({ quantity: 2.5, unitLabel: "metro(s)" }, { unit: "M" }), 2.5);
    assert.strictEqual(core.quantityInBaseUnit({ quantity: 3, unitLabel: "item(ns)" }, { unit: "UN" }), 3);

    // Aba Orçamento: rede → sub-rede → itens; rede sem sub-rede numera direto
    const rows = core.buildCivilBudgetRows(result.matched).map((row) => row.cells);
    assert.deepStrictEqual(rows.map((r) => r[0]), ["1.", "1.1", "1.1.1", "1.2", "1.2.1", "2.", "2.1"]);
    assert.deepStrictEqual(rows[0], ["1.", "", "", "INSTALAÇÕES HIDRÁULICAS", "", ""]);
    assert.strictEqual(rows[1][3], "ÁGUA FRIA");
    assert.deepStrictEqual(rows[2], ["1.1.1", "SINAPI", "89402", "TUBO 32 RAMAL", "M", 3.5]);
    assert.strictEqual(rows[3][3], "ALIMENTAÇÃO");
    assert.strictEqual(rows[5][3], "INSTALAÇÕES DE IRRIGAÇÃO");
    assert.deepStrictEqual(rows[6], ["2.1", "SINAPI", "89403", "TUBO 32 IRRIGAÇÃO", "M", 3]);

    console.log("instalações civis: ok");
})().catch((error) => { console.error(error); process.exitCode = 1; });
