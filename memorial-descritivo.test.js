// Memorial descritivo: regras da planilha, classificação dos materiais e geração do Word.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const JSZip = require("jszip");
const PizZip = require("pizzip");

const root = path.join(__dirname, "..");

function decodeXml(value) {
    return value
        .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function colunaParaIndice(col) {
    return [...col].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
}

// Leitor mínimo de .xlsx (equivale ao sheet_to_json do SheetJS usado no navegador)
async function lerAbas(arquivo) {
    const zip = await JSZip.loadAsync(fs.readFileSync(arquivo));
    const shared = zip.file("xl/sharedStrings.xml")
        ? Array.from((await zip.file("xl/sharedStrings.xml").async("string")).matchAll(/<si>([\s\S]*?)<\/si>/g), (m) =>
            decodeXml(Array.from(m[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g), (t) => t[1]).join("")))
        : [];
    const workbook = await zip.file("xl/workbook.xml").async("string");
    const rels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    const abas = {};
    for (const m of workbook.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
        const alvo = rels.match(new RegExp(`Id="${m[2]}"[^>]*Target="([^"]+)"`))?.[1]
            || rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${m[2]}"`))?.[1];
        const xml = await zip.file(`xl/${alvo.replace(/^\/?xl\//, "")}`).async("string");
        const linhas = Array.from(xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g), (row) => {
            const celulas = [];
            for (const c of row[1].matchAll(/<c([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
                const col = c[1].match(/r="([A-Z]+)\d+"/)[1];
                const corpo = c[2] || "";
                let valor = corpo.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
                if (/t="s"/.test(c[1])) valor = shared[Number(valor)];
                else if (/t="inlineStr"/.test(c[1])) valor = Array.from(corpo.matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g), (t) => t[1]).join("");
                celulas[colunaParaIndice(col)] = decodeXml(String(valor));
            }
            return celulas;
        });
        const [cabecalho = [], ...dados] = linhas;
        abas[decodeXml(m[1])] = dados.map((l) => Object.fromEntries(cabecalho.map((h, i) => [h, l[i] ?? ""])));
    }
    return abas;
}

function respostaFake() {
    return {
        statusCode: 0, headers: {}, body: null,
        setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
        status(c) { this.statusCode = c; return this; },
        send(b) { this.body = b; return this; }
    };
}

(async () => {
    const core = await import(pathToFileURL(path.join(root, "3D/memorial-core.js")).href);
    const abas = await lerAbas(path.join(root, "3D/memorial_descritivo.xlsx"));
    const config = core.lerConfiguracao(abas);

    // --- planilha de regras ---
    assert.ok(config.regras.length > 50, "a aba Classificacao deve ter as regras iniciais");
    assert.ok(config.secoes.length > 20, "a aba Secoes deve ter as seções iniciais");
    assert.ok(config.geral.APRESENTACAO.includes("{OBRA}"));
    const gruposSecoes = new Set(config.secoes.map((s) => s.grupo));
    config.regras.forEach((r) => assert.ok(gruposSecoes.has(r.grupo), `regra aponta para grupo inexistente: ${r.grupo}`));
    assert.throws(() => core.lerConfiguracao({ Geral: [] }), /Secoes/);

    // --- todas as linhas das bases de dados precisam cair em alguma seção ---
    for (const base of ["3D/base_de_dados.xlsx", "3D/base_de_dados_sic.xlsx"]) {
        const associa = (await lerAbas(path.join(root, base))).Associa;
        const semGrupo = associa.map((l) => l["DESCRIÇÃO"]).filter((d) => d && !core.classificarMaterial(d, config.regras));
        assert.deepStrictEqual(semGrupo, [], `${base}: materiais sem regra no memorial`);
    }

    // --- regras específicas antes das genéricas ---
    const grupo = (nome) => core.classificarMaterial(nome, config.regras);
    assert.strictEqual(grupo("Cabo unipolar - Solar - Cobre - Isol. XLPE - 1,8KV - 6 mm² - Preto"), "ELE_FOTOVOLTAICO");
    assert.strictEqual(grupo("Cabo Unipolar - cobre - Isol. XLPE - 0,6/1kV - 2.5 mm² - Azul claro"), "ELE_CONDUTORES");
    assert.strictEqual(grupo("Dispositivo Elétrico - embutido - Placa 2x4\" - Interruptor paralelo - 2 teclas"), "ELE_DISPOSITIVOS");
    assert.strictEqual(grupo("Dispositivo Telefônico - embutir - Tomada - Tomada RJ11"), "TEL_TELEFONIA");
    assert.strictEqual(grupo("Acessórios Cabeamento - Rack - Calha de tomadas - 10 tomadas 2P+T, 10A - 1U"), "TEL_CABEAMENTO");
    assert.strictEqual(grupo("Acessórios Cabeamento - Metálico - Amplificador de áudio profissional - 400W"), "TEL_SONORIZACAO");
    assert.strictEqual(grupo("Incêndio - Iluminação de emergência - Autônoma 30 LED's 100 lúmens"), "INC_ILUMINACAO");
    assert.strictEqual(grupo("Cobre - Barra - m - 30x5mm"), "ELE_QUADROS");
    assert.strictEqual(grupo("Material inventado - xyz"), null);

    // --- cores, unidades ---
    assert.deepStrictEqual(core.separarCor("Cabo - X - 2.5 mm² - Azul claro"), { base: "Cabo - X - 2.5 mm²", cor: "Azul claro" });
    assert.deepStrictEqual(core.separarCor("Placa - Bege - 2 módulos"), { base: "Placa - Bege - 2 módulos", cor: null });
    assert.strictEqual(core.unidadeDoModelo("metro(s)"), "m");
    assert.strictEqual(core.unidadeDoModelo("item(ns)"), "un");

    // --- um IFC por vez: quantidades por modelo e nome do IfcProject ---
    const porModelo = [
        { name: "A", quantity: 10, unitLabel: "item(ns)", quantityByModel: new Map([["IFC_ELE", 7], ["IFC_HID", 3]]) },
        { name: "B", quantity: 5, unitLabel: "item(ns)", quantityByModel: new Map([["IFC_HID", 5]]) },
        { name: "C", quantity: 2, unitLabel: "item(ns)" }
    ];
    assert.deepStrictEqual(core.filtrarItensPorModelo(porModelo, "IFC_ELE").map((i) => [i.name, i.quantity]), [["A", 7], ["C", 2]]);
    assert.deepStrictEqual(core.filtrarItensPorModelo(porModelo, "IFC_HID").map((i) => [i.name, i.quantity]), [["A", 3], ["B", 5], ["C", 2]]);
    assert.strictEqual(core.nomeIfcUtil("Project Name"), "");
    assert.strictEqual(core.nomeIfcUtil("  Escola Estadual Canaã "), "Escola Estadual Canaã");

    // --- montagem a partir de uma lista de materiais do modelo ---
    const itens = [
        { name: "Cabo Unipolar - cobre - Isol. XLPE - 0,6/1kV - ref. Prysmian Voltalene Ecolene - SINAPI - 2.5 mm² - Azul claro", quantity: 120.456, unitLabel: "metro(s)" },
        { name: "Cabo Unipolar - cobre - Isol. XLPE - 0,6/1kV - ref. Prysmian Voltalene Ecolene - SINAPI - 2.5 mm² - Preto", quantity: 100, unitLabel: "metro(s)" },
        { name: "Dispositivo de Proteção - Disjuntor unipolar termomagnético - 220 V/127 V - DIN - Curva C - 20 A - 5 kA", quantity: 12, unitLabel: "item(ns)" },
        { name: "PVC Esgoto - Tubo rígido c/ ponta lisa - 50 mm - 2\"", quantity: 33.2, unitLabel: "metro(s)" },
        { name: "Coisa sem regra <&>", quantity: 1, unitLabel: "item(ns)" }
    ];
    const associacoes = [
        { codigo: "91926", base: "SINAPI", descricao: "CABO 2,5", unidade: "M", itemDescricao: itens[0].name },
        { codigo: "91926", base: "SINAPI", descricao: "CABO 2,5", unidade: "M", itemDescricao: itens[1].name }
    ];
    const { payload, resumo } = core.montarMemorial({
        itens, associacoes, config,
        dados: { obra: "Escola Modelo", disciplina: "Instalações elétricas", arquivoIfc: "IFC-ELE-ESCOLA", local: "Boa Vista / RR", revisao: "R01", dataEmissao: "novembro de 2026" }
    });
    assert.strictEqual(resumo.pendentes.length, 1);
    assert.strictEqual(resumo.classificados, 4);
    assert.deepStrictEqual(payload.secoes.map((s) => s.titulo), ["Dispositivos de proteção, comando e medição", "Condutores elétricos", "Esgoto sanitário, ventilação e águas pluviais"], "seções em nível único, na ordem da planilha");
    assert.strictEqual(payload.disciplina, "Instalações elétricas");
    const condutores = payload.secoes.find((s) => s.titulo === "Condutores elétricos");
    assert.strictEqual(condutores.itens.length, 1, "cores do mesmo cabo viram uma linha só");
    assert.match(condutores.itens[0].descricao, /\(cores: azul claro e preto\)$/);
    assert.strictEqual(condutores.itens[0].referencia, "SINAPI 91926");
    assert.strictEqual(condutores.itens[0].quantidade, 220.46);
    assert.ok(payload.apresentacao[0].includes("Escola Modelo"));
    assert.ok(payload.apresentacao[0].includes("projeto de Instalações elétricas"));
    assert.ok(payload.apresentacao[1].includes("IFC-ELE-ESCOLA"));
    assert.ok(payload.normas.some((n) => n.norma === "ABNT NBR 5410"));
    assert.ok(payload.normas.some((n) => n.norma === "ABNT NBR 8160"));
    assert.ok(!payload.normas.some((n) => n.norma === "ABNT NBR 5419"), "norma de SPDA só entra com SPDA no modelo");

    // --- servidor: validação ---
    const memorial = require("../api/_memorial-descritivo");
    assert.throws(() => memorial.normalizarMemorial({ ...payload, obra: " " }), /obra/);
    assert.throws(() => memorial.normalizarMemorial({ ...payload, secoes: [] }), /Nenhum material/);
    assert.strictEqual(memorial.formatarQuantidade(220.456, "m"), "220,46");
    assert.strictEqual(memorial.formatarQuantidade(12, "un"), "12");
    assert.strictEqual(memorial.nomeArquivo({ obra: "Escola Modelo/Canaã", disciplina: "Elétrica", revisao: "R01" }), "memorial-descritivo-Escola-Modelo-Canaa-Eletrica-R01.docx");

    // --- servidor: geração do Word com o modelo real ---
    const { criarHandler } = require("../api/gerar-memorial-word");
    const handler = criarHandler({ requireUser: async () => ({ perfil: "admin" }) });
    const malicioso = JSON.parse(JSON.stringify(payload));
    malicioso.secoes[0].itens.push({ descricao: "Item <w:p>&\"quebra\"", referencia: "", unidade: "un", quantidade: 2 });
    const res = respostaFake();
    await handler({ method: "POST", body: malicioso }, res);
    assert.strictEqual(res.statusCode, 200, res.body && res.body.toString());
    assert.match(res.headers["content-disposition"], /memorial-descritivo-Escola-Modelo-Instalacoes-eletricas-R01\.docx/);
    const docx = new PizZip(res.body);
    const xml = docx.file("word/document.xml").asText();
    assert.ok(!/\[@?[A-Z_]+\]/.test(xml.replace(/<[^>]+>/g, "")), "nenhum marcador pode sobrar no Word");
    assert.ok(xml.includes("MEMORIAL DESCRITIVO"));
    assert.ok(xml.includes("Escola Modelo"));
    assert.ok(xml.includes("BOA VISTA / RR"));
    assert.ok(xml.includes("CONDUTORES ELÉTRICOS"));
    assert.ok(xml.includes("Instalações elétricas"), "disciplina na capa");
    assert.ok(xml.includes("Item &lt;w:p&gt;&amp;&quot;quebra&quot;"), "texto do usuário precisa ser escapado");
    assert.ok(!xml.includes("ANEXO"), "o memorial não leva os anexos do relatório de atividades");
    assert.ok(docx.file("word/settings.xml").asText().includes("<w:updateFields"), "sumário atualiza ao abrir");

    const semAuth = criarHandler({ requireUser: async () => { const e = new Error("Sem acesso"); e.statusCode = 403; throw e; } });
    const res403 = respostaFake();
    await semAuth({ method: "POST", body: payload }, res403);
    assert.strictEqual(res403.statusCode, 403);

    const resGet = respostaFake();
    await handler({ method: "GET" }, resGet);
    assert.strictEqual(resGet.statusCode, 405);

    if (process.env.MEMORIAL_SAIDA) fs.writeFileSync(process.env.MEMORIAL_SAIDA, res.body);
    console.log("memorial-descritivo: ok");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
