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
    assert.ok(config.regras.length > 80, "a aba Classificacao deve ter as regras iniciais");
    ["ELE", "ALIM", "LOG", "CFTV", "SDAI", "SPDA", "FV", "GERAL"].forEach((c) => assert.ok(config.disciplinas.some((d) => d.codigo === c), `falta a disciplina ${c}`));
    assert.ok(config.atributos.length > 30, "a aba Atributos deve ter os atributos iniciais");
    const roteiros = new Set(config.disciplinas.map((d) => d.estrutura));
    roteiros.forEach((r) => assert.ok(config.estrutura.some((l) => l.estruturas.includes(r)), `roteiro ${r} sem linhas na aba Estrutura`));
    assert.throws(() => core.lerConfiguracao({ Geral: [] }), /Disciplinas/);

    // todo grupo usado nas regras precisa aparecer listado em algum título do roteiro GERAL
    const grupos = new Set(config.regras.map((r) => r.grupo));
    const listadoNoGeral = (g) => config.estrutura.some((l) => l.estruturas.includes("GERAL") && l.listar.some((f) => (f.endsWith("*") ? g.startsWith(f.slice(0, -1)) : f === g)));
    assert.deepStrictEqual([...grupos].filter((g) => !listadoNoGeral(g)), [], "grupos sem lugar no roteiro GERAL");

    // --- todas as linhas das bases de dados precisam cair em algum grupo ---
    for (const base of ["3D/base_de_dados.xlsx", "3D/base_de_dados_sic.xlsx"]) {
        const associa = (await lerAbas(path.join(root, base))).Associa;
        const semGrupo = associa.map((l) => l["DESCRIÇÃO"]).filter((d) => d && !core.classificarMaterial(d, config.regras));
        assert.deepStrictEqual(semGrupo, [], `${base}: materiais sem regra no memorial`);
    }

    // --- regras específicas antes das genéricas ---
    const grupo = (nome) => core.classificarMaterial(nome, config.regras);
    assert.strictEqual(grupo("Cabo unipolar - Solar - Cobre - Isol. XLPE - 1,8KV - 6 mm² - Preto"), "FV_CABOS_CC");
    assert.strictEqual(grupo("Cabo Unipolar - cobre - Isol. XLPE - 0,6/1kV - 2.5 mm² - Azul claro"), "ELE_CONDUTORES");
    assert.strictEqual(grupo("Dispositivo de Proteção - Interruptor bipolar DR - fase/neutro - In 30mA"), "ELE_DR");
    assert.strictEqual(grupo("Dispositivo de Proteção - Dispositivo de proteção contra surto - 275 V - 40 KA"), "ELE_DPS");
    assert.strictEqual(grupo("Quadro distrib. chapa pintada - sobrepor - Barr. trif."), "ELE_QUADROS");
    assert.strictEqual(grupo("Aterramento - Barramento de equipotencialização - 11 terminais"), "ELE_ATERRAMENTO");
    assert.strictEqual(grupo("Acessórios Cabeamento - Metálico - Plugue - RJ45 - CM8v - Cat 6"), "LOG_CONECTORES");
    assert.strictEqual(grupo("Acessórios Cabeamento - Rack - Calha de tomadas - 10 tomadas 2P+T, 10A - 1U"), "LOG_RACK");
    assert.strictEqual(grupo("Acessórios Cabeamento - Metálico - Patch panel XLR - 24 posições"), "SOM");
    assert.strictEqual(grupo("Dispositivo Elétrico - embutido - Placa 4x4\" - Placa cega"), "INF_CAIXAS");
    assert.strictEqual(grupo("Acessórios uso geral - Arruela lisa galvan. - 1/4\""), "INF_FIXACAO");
    assert.strictEqual(grupo("Material inventado - xyz"), null);

    // --- disciplina pelo nome do IFC ---
    const disc = (m) => core.detectarDisciplina(m, config.disciplinas).codigo;
    assert.strictEqual(disc({ id: "IFC_LOG", displayName: "Cabeamento estruturado e telefonia", src: "/3D/drogaria/modelo-05.xkt" }), "LOG");
    assert.strictEqual(disc({ id: "IFC_ELE_380", displayName: "Instalações elétricas — 380 V" }), "ELE");
    assert.strictEqual(disc({ id: "modelo-09", arquivo: "IFC-ELE-DRL" }), "ELE");
    assert.strictEqual(disc({ id: "IFC_HID", displayName: "Hidráulica" }), "GERAL");
    assert.strictEqual(disc({ id: "IFC_SDAI", arquivo: "IFC-SDAI-TCE" }), "SDAI");
    assert.strictEqual(disc({ id: "IFC_SPDA", displayName: "SPDA" }), "SPDA");
    assert.strictEqual(disc({ id: "IFC_FV", displayName: "Sistema fotovoltaico" }), "FV");
    assert.strictEqual(disc({ id: "IFC_ALIM", displayName: "Alimentadores" }), "ALIM");

    // --- utilitários ---
    assert.deepStrictEqual(core.separarCor("Cabo - X - 2.5 mm² - Azul claro"), { base: "Cabo - X - 2.5 mm²", cor: "Azul claro" });
    assert.strictEqual(core.limparDescricao("- COMPOSIÇÃO PRÓPRIA - METROS - ELETRODUTO FLEXÍVEL CORRUGADO, 1\", INSTALADO NO PISO"), "ELETRODUTO FLEXÍVEL CORRUGADO, 1\", INSTALADO NO PISO");
    assert.strictEqual(core.unidadeDoModelo("metro(s)"), "m");
    const porModelo = [
        { name: "A", quantity: 10, unitLabel: "item(ns)", quantityByModel: new Map([["IFC_ELE", 7], ["IFC_HID", 3]]) },
        { name: "B", quantity: 5, unitLabel: "item(ns)", quantityByModel: new Map([["IFC_HID", 5]]) },
        { name: "C", quantity: 2, unitLabel: "item(ns)" }
    ];
    assert.deepStrictEqual(core.filtrarItensPorModelo(porModelo, "IFC_ELE").map((i) => [i.name, i.quantity]), [["A", 7], ["C", 2]]);
    assert.strictEqual(core.nomeIfcUtil("Project Name"), "");

    // --- memorial de cabeamento estruturado ---
    const itensLog = [
        { name: "Cabeamento estruturado - metálico - UTP-CAT.6 - 4", quantity: 1600.52, unitLabel: "metro(s)" },
        { name: "Acessórios Cabeamento - Metálico - Patch panel - 24 posições", quantity: 1, unitLabel: "item(ns)" },
        { name: "Intelbras - Equipamentos de Rede e Rack - Mini Rack de Parede - 12U unc 19” x 570mm MRD 1257", quantity: 1, unitLabel: "item(ns)" },
        { name: "Eletroduto PVC flexível - Eletroduto leve - 3/4\" - Forro", quantity: 101.72, unitLabel: "metro(s)" },
        { name: "Coisa sem regra <&>", quantity: 1, unitLabel: "item(ns)" }
    ];
    const associacoes = [{ codigo: "98297", base: "SINAPI", itemDescricao: itensLog[0].name }];
    const { payload, resumo } = core.montarMemorial({
        itens: itensLog, associacoes, config, disciplina: "LOG",
        dados: { obra: "Escola Modelo", cliente: "SEDUC", endereco: "Rua A, 10", local: "Boa Vista / RR", revisao: "R01", dataEmissao: "novembro de 2026", arquivoIfc: "IFC-LOG-ESC" }
    });
    const titulos = payload.titulos.map((t) => t.titulo);
    ["OBJETO", "NORMAS TÉCNICAS E LEGISLAÇÃO", "DOCUMENTOS DE REFERÊNCIA", "CONDIÇÕES GERAIS", "Arquitetura do sistema", "INFRAESTRUTURA DE ENCAMINHAMENTO", "Cabos de par trançado", "Patch panels", "Patch cords e line cords", "RACKS E ACESSÓRIOS", "CERTIFICAÇÃO E TESTES", "SEGURANÇA DO TRABALHO", "RECEBIMENTO E DOCUMENTAÇÃO DE ENTREGA", "CRITÉRIOS DE MEDIÇÃO", "CONSIDERAÇÕES FINAIS"]
        .forEach((t) => assert.ok(titulos.includes(t), `faltou o título ${t}`));
    ["Cabos ópticos", "TELEFONIA", "CIRCUITO FECHADO DE TV (CFTV)", "Eletrocalhas e leitos para cabos", "QUADROS DE DISTRIBUIÇÃO", "Eletrodutos flexíveis"]
        .forEach((t) => assert.ok(!titulos.includes(t), `título ${t} não deveria aparecer sem materiais`));
    // infraestrutura com um único subtítulo (eletrodutos flexíveis) vira um título só, com os dois textos
    const infra = payload.titulos.find((t) => t.titulo === "INFRAESTRUTURA DE ENCAMINHAMENTO");
    assert.strictEqual(infra.nivel, 1);
    assert.ok(infra.conteudo.some((b) => b.texto?.startsWith("**Especificação.** Eletrodutos de PVC corrugado")));
    assert.deepStrictEqual(infra.materiais, ["Eletroduto PVC flexível - Eletroduto leve - 3/4\" - Forro"]);
    assert.strictEqual(payload.titulos.find((t) => t.titulo === "Arquitetura do sistema").nivel, 2);
    assert.ok(payload.titulos[0].conteudo[0].texto.includes("cabeamento estruturado e telefonia da obra Escola Modelo, situada em Rua A, 10, para o cliente SEDUC."));
    assert.ok(payload.titulos.find((t) => t.titulo === "DOCUMENTOS DE REFERÊNCIA").conteudo.some((b) => b.tipo === "item" && b.texto.includes("IFC-LOG-ESC")));
    assert.ok(payload.titulos.find((t) => t.titulo === "NORMAS TÉCNICAS E LEGISLAÇÃO").conteudo.some((b) => b.tipo === "normas"));
    assert.ok(payload.normas.some((n) => n.norma === "NR-18"));
    assert.ok(payload.normas.some((n) => n.norma === "ABNT NBR 14565"));
    assert.ok(payload.normas.some((n) => n.norma === "ANSI/TIA-568.2-D"));
    assert.ok(!payload.normas.some((n) => n.norma === "ANSI/TIA-568.3-D"), "norma de fibra só com fibra no IFC");
    assert.ok(!payload.normas.some((n) => n.norma === "ABNT NBR 14136"), "norma de tomadas elétricas não entra no memorial de lógica");
    assert.deepStrictEqual(payload.titulos.find((t) => t.titulo === "Cabos de par trançado").materiais, ["Cabeamento estruturado - metálico - UTP-CAT.6 - 4"]);
    assert.strictEqual(payload.anexo.find((g) => g.titulo === "Cabos de par trançado").itens[0].referencia, "SINAPI 98297");
    assert.strictEqual(payload.anexo.at(-1).titulo, "Outros materiais do modelo");
    assert.strictEqual(resumo.pendentes.length, 1);

    // --- memorial elétrico ---
    const ele = core.montarMemorial({
        itens: [
            { name: "Cabo Unipolar - cobre - Isol. XLPE - 0,6/1kV - 2.5 mm² - Azul claro", quantity: 120.456, unitLabel: "metro(s)" },
            { name: "Cabo Unipolar - cobre - Isol. XLPE - 0,6/1kV - 2.5 mm² - Preto", quantity: 100, unitLabel: "metro(s)" },
            { name: "Dispositivo de Proteção - Disjuntor unipolar termomagnético - 220 V/127 V - DIN - Curva C - 20 A - 5 kA", quantity: 12, unitLabel: "item(ns)" }
        ], config, disciplina: "ELE", dados: { obra: "Escola Modelo", local: "Boa Vista / RR" }
    }).payload;
    const titulosEle = ele.titulos.map((t) => t.titulo);
    ["CONDUTORES ELÉTRICOS", "DISPOSITIVOS DE PROTEÇÃO E COMANDO", "ENSAIOS E VERIFICAÇÃO FINAL", "ATERRAMENTO E EQUIPOTENCIALIZAÇÃO"].forEach((t) => assert.ok(titulosEle.includes(t), `faltou ${t}`));
    ["ILUMINAÇÃO", "Condutores dos circuitos", "Disjuntores termomagnéticos"].forEach((t) => assert.ok(!titulosEle.includes(t), `não deveria ter ${t}`));
    assert.match(ele.titulos.find((t) => t.titulo === "CONDUTORES ELÉTRICOS").materiais[0], /\(cores: azul claro e preto\)$/);
    assert.strictEqual(ele.anexo.find((g) => g.titulo === "Condutores dos circuitos").itens[0].quantidade, 220.46);
    assert.ok(ele.titulos[0].conteudo[0].texto.includes("situada em Boa Vista / RR."), "sem endereço usa o local e sem cliente não cita cliente");
    assert.strictEqual(core.tituloFrase("CIRCUITO FECHADO DE TV (CFTV)"), "Circuito fechado de TV (CFTV)");
    assert.strictEqual(core.limparDescricao(".S.O.S CAIXA DE PASSAGEM - EMBUTIR NO PISO"), "CAIXA DE PASSAGEM - EMBUTIR NO PISO");

    // --- textos com as características dos materiais (aba Atributos) ---
    const comAtributos = core.montarMemorial({
        itens: [
            ...itensLog,
            { name: "Acessórios Cabeamento - Metálico - Conector - RJ45 - CM8v - Cat 6, para Patch Panel - Keystone", quantity: 5, unitLabel: "item(ns)" },
            { name: "Acessórios Cabeamento - Metálico - Switch - 10/100 - BaseTX - 48 portas", quantity: 2, unitLabel: "item(ns)" },
            { name: "Eletrocalha furada tipo U pré-galv. quen - Eletrocalha perfurada tipo U - 100x100mm chapa 18", quantity: 17.1, unitLabel: "metro(s)" },
            { name: "Eletroduto PVC flexível - Eletroduto pesado - 1.1/2\" - Piso", quantity: 3, unitLabel: "metro(s)" }
        ], config, disciplina: "LOG", dados: { obra: "Escola" }
    });
    const at = comAtributos.resumo.atributos;
    assert.strictEqual(at.CABO_CATEGORIA, "Categoria 6");
    assert.strictEqual(at.RACK, "mini rack de parede de 12U, 19\" x 570 mm de profundidade");
    assert.strictEqual(at.SWITCH, "48 portas 10/100 Mbps");
    assert.strictEqual(at.ELETROCALHA_DIM, "100x100 mm (chapa 18)");
    assert.strictEqual(at.ELETRODUTO_FLEX_DIAM, "3/4\" e 1 1/2\"", "diâmetros em ordem numérica e 1.1/2 -> 1 1/2");
    assert.strictEqual(at.PATCH_PANEL_PORTAS, "24 portas");
    const textoDe = (p, titulo) => p.titulos.find((t) => t.titulo === titulo).conteudo.map((b) => b.texto || "").join(" ");
    assert.match(textoDe(comAtributos.payload, "Cabos de par trançado"), /O cabeamento horizontal deste projeto será em cabo U\/UTP Categoria 6\./);
    assert.match(textoDe(comAtributos.payload, "RACKS E ACESSÓRIOS"), /Neste projeto está previsto mini rack de parede de 12U/);
    // sem fibra no IFC, o trecho opcional some (e não sobra "{FIBRA_TIPO}" nem "conforme projeto" solto)
    assert.ok(!/\{[A-Z0-9_]+\}|\[\[|\]\]/.test(JSON.stringify(comAtributos.payload)), "nenhum campo ou trecho opcional pode sobrar sem preencher");
    assert.ok(!/ {2}/.test(JSON.stringify(comAtributos.payload.titulos)), "sem espaços duplos quando um trecho opcional some");

    // FAIXA, SOMA e CONTAGEM
    const atr = core.calcularAtributos(config.atributos, [
        { nome: "Dispositivo de Proteção - Disjuntor tripolar termomagnético caixa moldada - 380/415 V - 32 A - 18 kA", grupo: "ELE_DISJUNTORES", quantidade: 2 },
        { nome: "Dispositivo de Proteção - Disjuntor unipolar termomagnético - 220 V/127 V - DIN - Curva C - 400 A - 4.5 kA", grupo: "ELE_DISJUNTORES", quantidade: 1 },
        { nome: "Elementos fotovoltaicos - Módulo fotovoltaico - Monocristalino - 238,4 x 130,3 x 3,5 cm - 670W", grupo: "FV_MODULOS", quantidade: 871 },
        { nome: "Elementos fotovoltaicos - Inversores fotovoltaicos - Inversor - trifásico - 110000W - 10SPMP", grupo: "FV_INVERSORES", quantidade: 6 }
    ]);
    assert.strictEqual(atr.DISJUNTOR_CORRENTE, "de 32 A a 400 A");
    assert.strictEqual(atr.DISJUNTOR_ICC, "de 4,5 kA a 18 kA");
    assert.strictEqual(atr.FV_POTENCIA_KWP, "583,57 kWp");
    assert.strictEqual(atr.FV_QTD_MODULOS, "871 módulos");
    assert.strictEqual(atr.FV_INVERSOR, "trifásico de 110 kW");
    assert.strictEqual(atr.CABO_CATEGORIA, "");

    // --- novos roteiros ---
    const sdai = core.montarMemorial({
        itens: [
            { name: "Cabeamento de Incêndio - Cabo Alarme De Incêndio 2x1,50mm² Blindado - 2", quantity: 100, unitLabel: "metro(s)" },
            { name: "Incêndio - Alarme de incêndio - Central de Alarme e Detecção", quantity: 1, unitLabel: "item(ns)" },
            { name: "Incêndio - Alarme de incêndio - Acionador manual de alarme de incêndio c/ sirene endereçável", quantity: 4, unitLabel: "item(ns)" }
        ], config, disciplina: "SDAI", dados: { obra: "Escola" }
    }).payload;
    const tSdai = sdai.titulos.map((t) => t.titulo);
    ["Central de detecção e alarme", "Acionadores manuais", "Avisadores sonoros e visuais", "CABEAMENTO DO SISTEMA", "ENSAIOS E COMISSIONAMENTO"].forEach((t) => assert.ok(tSdai.includes(t), `SDAI sem ${t}`));
    assert.deepStrictEqual(sdai.titulos.find((t) => t.titulo === "Acionadores manuais").materiais, ["Incêndio - Alarme de incêndio - Acionador manual de alarme de incêndio c/ sirene endereçável"]);
    assert.match(textoDe(sdai, "CABEAMENTO DO SISTEMA"), /cabos blindados de 2x1,50 mm², totalizando 100 m\./);
    assert.strictEqual(sdai.normas[0].norma, "ABNT NBR 17240", "norma própria do sistema vem primeiro");

    const spda = core.montarMemorial({
        itens: [
            { name: "Captores - Captor Franklin - H=250mm - 01 descida", quantity: 4, unitLabel: "item(ns)" },
            { name: "Condutores de proteção - SPDA - Cabo de cobre Nú - 7 fios - 50mm²", quantity: 300, unitLabel: "metro(s)" },
            { name: "Aterramento - Haste de aterramento - cobreada - 5/8\" x 2,40m", quantity: 12, unitLabel: "item(ns)" }
        ], config, disciplina: "SPDA", dados: { obra: "Escola" }
    }).payload;
    ["SUBSISTEMA DE CAPTAÇÃO", "SUBSISTEMA DE DESCIDA E CONDUTORES", "SUBSISTEMA DE ATERRAMENTO", "INSPEÇÃO, ENSAIOS E LAUDO"].forEach((t) => assert.ok(spda.titulos.some((x) => x.titulo === t), `SPDA sem ${t}`));
    assert.match(textoDe(spda, "SUBSISTEMA DE ATERRAMENTO"), /12 hastes de aço cobreado de 5\/8" x 2,40m/);
    assert.ok(spda.normas.some((n) => n.norma === "ABNT NBR 5419-3"));

    const fv = core.montarMemorial({
        itens: [
            { name: "Elementos fotovoltaicos - Módulo fotovoltaico - Monocristalino - 238,4 x 130,3 x 3,5 cm - 670W", quantity: 10, unitLabel: "item(ns)" },
            { name: "Cabo unipolar - Solar - Cobre - Isol. XLPE - 1,8KV - 6 mm² - Preto", quantity: 50, unitLabel: "metro(s)" }
        ], config, disciplina: "FV", dados: { obra: "Escola" }
    }).payload;
    assert.match(fv.titulos[0].conteudo[0].texto, /potência de pico de 6,7 kWp, com 10 módulos\.$/);
    assert.ok(!fv.titulos[0].conteudo[0].texto.includes("inversores"), "sem inversor no IFC a frase dos inversores some");
    assert.ok(fv.titulos.some((t) => t.titulo === "COMISSIONAMENTO"));
    assert.ok(fv.normas.some((n) => n.norma === "ABNT NBR 16274"));

    // --- servidor: validação ---
    const memorial = require("../api/_memorial-descritivo");
    assert.throws(() => memorial.normalizarMemorial({ ...payload, obra: " " }), /obra/);
    assert.throws(() => memorial.normalizarMemorial({ ...payload, titulos: [] }), /roteiro/);
    assert.strictEqual(memorial.formatarQuantidade(220.456, "m"), "220,46");
    assert.strictEqual(memorial.nomeArquivo({ obra: "Escola Modelo/Canaã", disciplina: "Elétrica", revisao: "R01" }), "memorial-descritivo-Escola-Modelo-Canaa-Eletrica-R01.docx");

    // --- servidor: geração do Word com o modelo real ---
    const { criarHandler } = require("../api/gerar-memorial-word");
    const handler = criarHandler({ requireUser: async () => ({ perfil: "admin" }) });
    const malicioso = JSON.parse(JSON.stringify(payload));
    malicioso.anexo[0].itens.push({ descricao: "Item <w:p>&\"quebra\"", referencia: "", unidade: "un", quantidade: 2 });
    const res = respostaFake();
    await handler({ method: "POST", body: malicioso }, res);
    assert.strictEqual(res.statusCode, 200, res.body && res.body.toString());
    assert.match(res.headers["content-disposition"], /memorial-descritivo-Escola-Modelo-Cabeamento-Estruturado-e-Telefonia-R01\.docx/);
    const docx = new PizZip(res.body);
    const xml = docx.file("word/document.xml").asText();
    assert.ok(!/\[[@#/]?[A-Z_]+\]/.test(xml.replace(/<[^>]+>/g, "")), "nenhum marcador pode sobrar no Word");
    assert.ok(xml.includes("CABEAMENTO ESTRUTURADO E TELEFONIA"), "disciplina na capa");
    assert.ok(xml.includes("SEDUC") && xml.includes("Rua A, 10"), "cliente e endereço na capa");
    assert.ok(xml.includes("ANEXO A — RELAÇÃO DE MATERIAIS"));
    assert.ok(xml.includes("Materiais previstos neste projeto:"));
    assert.ok(!xml.includes("**"), "marcação de negrito não pode vazar para o Word");
    assert.ok(xml.includes('<w:r><w:t xml:space="preserve">Cabeamento estruturado - metálico - UTP-CAT.6 - 4</w:t></w:r>'), "a lista de materiais usa o mesmo tamanho de letra do texto");
    assert.match(xml, /<w:b\/><w:bCs\/><\/w:rPr><w:t xml:space="preserve">Responsabilidades da contratada\.<\/w:t>/);
    assert.ok(xml.includes("Item &lt;w:p&gt;&amp;&quot;quebra&quot;"), "texto do usuário precisa ser escapado");
    assert.ok(docx.file("word/settings.xml").asText().includes("<w:updateFields"), "sumário atualiza ao abrir");

    // sem cliente/endereço as linhas da capa somem
    const semCliente = respostaFake();
    await handler({ method: "POST", body: { ...payload, cliente: "", endereco: "" } }, semCliente);
    const xmlSem = new PizZip(semCliente.body).file("word/document.xml").asText();
    assert.ok(!xmlSem.includes("Cliente:") && !xmlSem.includes("Endereço:"));

    const semAuth = criarHandler({ requireUser: async () => { const e = new Error("Sem acesso"); e.statusCode = 403; throw e; } });
    const res403 = respostaFake();
    await semAuth({ method: "POST", body: payload }, res403);
    assert.strictEqual(res403.statusCode, 403);

    if (process.env.MEMORIAL_SAIDA) fs.writeFileSync(process.env.MEMORIAL_SAIDA, res.body);
    console.log("memorial-descritivo: ok");
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
