// memorial-core.js
// Lógica pura do memorial descritivo (sem DOM): lê as regras da memorial_descritivo.xlsx,
// classifica os materiais de UM modelo IFC e monta o JSON enviado para /api/gerar-memorial-word.

export const ABAS_OBRIGATORIAS = ["Geral", "Secoes", "Classificacao", "Normas"];

const CORES = new Set([
    "amarelo", "branco", "azul", "azul claro", "azul-claro", "preto", "vermelho", "verde",
    "verde-amarelo", "verde/amarelo", "verde e amarelo", "cinza", "marrom", "laranja", "violeta", "roxo"
]);

export function normalizarTexto(valor) {
    return String(valor ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function chaveColuna(nome) {
    return normalizarTexto(nome).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizarLinhas(linhas) {
    return (Array.isArray(linhas) ? linhas : []).map((linha) => {
        const saida = {};
        Object.entries(linha || {}).forEach(([k, v]) => {
            saida[chaveColuna(k)] = typeof v === "string" ? v.replace(/\r\n?/g, "\n").trim() : v;
        });
        return saida;
    });
}

function simNao(valor, padrao = true) {
    const t = normalizarTexto(valor);
    if (!t) return padrao;
    return !["nao", "n", "false", "0", "no"].includes(t);
}

export function lerConfiguracao(abas = {}) {
    const faltando = ABAS_OBRIGATORIAS.filter((nome) => !Array.isArray(abas[nome]));
    if (faltando.length) {
        throw new Error(`A memorial_descritivo.xlsx está sem a(s) aba(s): ${faltando.join(", ")}.`);
    }

    const geral = {};
    normalizarLinhas(abas.Geral).forEach((l) => {
        const chave = chaveColuna(l.CHAVE);
        if (chave) geral[chave] = String(l.TEXTO ?? "");
    });

    const secoes = normalizarLinhas(abas.Secoes)
        .map((l, i) => ({
            ordem: Number.isFinite(Number(l.ORDEM)) && String(l.ORDEM).trim() !== "" ? Number(l.ORDEM) : 10000 + i,
            grupo: chaveColuna(l.GRUPO_MEMORIAL),
            titulo: String(l.TITULO ?? "").trim(),
            texto: String(l.TEXTO ?? ""),
            listarItens: simNao(l.LISTAR_ITENS, true),
            ativo: simNao(l.ATIVO, true)
        }))
        .filter((s) => s.grupo && s.titulo);

    const regras = normalizarLinhas(abas.Classificacao)
        .map((l) => ({
            tipo: normalizarTexto(l.REGRA).startsWith("cont") ? "contem" : "comeca",
            texto: normalizarTexto(l.TEXTO),
            grupo: chaveColuna(l.GRUPO_MEMORIAL)
        }))
        .filter((r) => r.texto && r.grupo);

    const normas = normalizarLinhas(abas.Normas)
        .map((l) => ({
            norma: String(l.NORMA ?? "").trim(),
            titulo: String(l.TITULO ?? "").trim(),
            grupos: String(l.GRUPOS ?? "").split(/[,;\n]/).map((g) => chaveColuna(g.replace("*", "_ASTERISCO_"))).filter(Boolean)
        }))
        .filter((n) => n.norma);

    return { geral, secoes, regras, normas };
}

export function classificarMaterial(nome, regras) {
    const alvo = normalizarTexto(nome);
    if (!alvo) return null;
    for (const regra of regras) {
        const bate = regra.tipo === "contem" ? alvo.includes(regra.texto) : alvo.startsWith(regra.texto);
        if (bate) return regra.grupo;
    }
    return null;
}

export function separarCor(descricao) {
    const partes = String(descricao ?? "").split(" - ");
    if (partes.length < 2) return { base: String(descricao ?? "").trim(), cor: null };
    const ultima = partes[partes.length - 1].trim();
    if (!CORES.has(normalizarTexto(ultima))) return { base: String(descricao).trim(), cor: null };
    return { base: partes.slice(0, -1).join(" - ").trim(), cor: ultima };
}

export function unidadeDoModelo(unitLabel) {
    const t = normalizarTexto(unitLabel);
    if (t.startsWith("metro")) return "m";
    if (t.startsWith("item")) return "un";
    return String(unitLabel ?? "").trim() || "un";
}

/**
 * Quantidades de um único IFC. Cada material consolidado guarda quantityByModel
 * (Map modelId -> quantidade); se a lista não tiver essa informação, usa o total.
 */
export function filtrarItensPorModelo(itens, modeloId) {
    if (!modeloId) return [...itens];
    return itens
        .map((item) => {
            const porModelo = item?.quantityByModel;
            if (!(porModelo instanceof Map) || !porModelo.size) return item;
            const quantidade = porModelo.get(modeloId);
            return Number.isFinite(quantidade) && quantidade > 0 ? { ...item, quantity: quantidade } : null;
        })
        .filter(Boolean);
}

const NOMES_GENERICOS = new Set(["", "project", "projeto", "project name", "project number", "default", "undefined", "unnamed", "sem nome", "building", "edificio", "site", "terreno"]);

/** Nome útil de um IfcProject/IfcBuilding/IfcSite (descarta os nomes-padrão do Revit e afins). */
export function nomeIfcUtil(valor) {
    const texto = String(valor ?? "").trim();
    return NOMES_GENERICOS.has(normalizarTexto(texto)) ? "" : texto;
}

function juntarLista(lista) {
    if (lista.length <= 1) return lista.join("");
    return `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}

function aplicarCampos(texto, campos) {
    return String(texto ?? "").replace(/\{([A-Z_]+)\}/g, (inteiro, nome) => (nome in campos ? campos[nome] : inteiro));
}

function paragrafos(texto, campos) {
    return aplicarCampos(texto, campos).split(/\n+/).map((p) => p.trim()).filter(Boolean);
}

function normaSeAplica(norma, gruposPresentes) {
    if (!norma.grupos.length) return true;
    return norma.grupos.some((g) => {
        if (g.endsWith("_ASTERISCO")) {
            const prefixo = g.replace(/ASTERISCO$/, "");
            return [...gruposPresentes].some((p) => p.startsWith(prefixo));
        }
        return gruposPresentes.has(g);
    });
}

const comparar = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

/**
 * @param {object} args
 * @param {Array<{name:string, quantity:number, unitLabel:string}>} args.itens  materiais de UM IFC (ver filtrarItensPorModelo)
 * @param {Array<{codigo,base,descricao,unidade,itemDescricao}>} args.associacoes  base_de_dados.xlsx
 * @param {ReturnType<typeof lerConfiguracao>} args.config
 * @param {{obra,local,revisao,dataEmissao,disciplina,arquivoIfc}} args.dados
 * @param {{mostrarQuantidades?:boolean, mostrarReferencias?:boolean}} args.opcoes
 * @param {(s:string)=>string} [args.normalizarBusca]  mesma normalização usada no Excel de orçamento
 */
export function montarMemorial({ itens = [], associacoes = [], config, dados = {}, opcoes = {}, normalizarBusca } = {}) {
    if (!config) throw new Error("Configuração do memorial não carregada.");
    const normBusca = typeof normalizarBusca === "function" ? normalizarBusca : normalizarTexto;

    const assocPorItem = new Map();
    associacoes.forEach((a) => {
        const chave = normBusca(a.itemDescricao || "");
        if (chave && !assocPorItem.has(chave)) assocPorItem.set(chave, a);
    });

    const secoesAtivas = new Map();
    config.secoes.filter((s) => s.ativo).forEach((s) => {
        if (!secoesAtivas.has(s.grupo)) secoesAtivas.set(s.grupo, s);
    });

    const pendentes = [];
    const porGrupo = new Map(); // grupo -> Map(chaveItem -> item agregado)

    itens.forEach((item) => {
        const nome = String(item?.name ?? "").trim();
        if (!nome) return;
        const grupo = classificarMaterial(nome, config.regras);
        if (!grupo) {
            pendentes.push({ nome, motivo: "sem regra na aba Classificacao" });
            return;
        }
        if (!secoesAtivas.has(grupo)) {
            pendentes.push({ nome, motivo: `grupo ${grupo} sem seção ativa na aba Secoes` });
            return;
        }

        const assoc = assocPorItem.get(normBusca(nome));
        const referencia = assoc?.codigo ? `${assoc.base ? `${assoc.base} ` : ""}${assoc.codigo}` : "";
        const unidade = unidadeDoModelo(item.unitLabel);
        const quantidade = Number.isFinite(item.quantity) ? item.quantity : 0;
        const { base, cor } = separarCor(nome);
        const chave = `${normalizarTexto(base)}|${unidade}`;

        if (!porGrupo.has(grupo)) porGrupo.set(grupo, new Map());
        const mapa = porGrupo.get(grupo);
        const atual = mapa.get(chave) || { base, cores: new Set(), referencias: new Set(), unidade, quantidade: 0 };
        atual.quantidade += quantidade;
        if (cor) atual.cores.add(cor);
        if (referencia) atual.referencias.add(referencia);
        mapa.set(chave, atual);
    });

    const gruposPresentes = new Set(porGrupo.keys());
    const campos = {
        OBRA: String(dados.obra ?? "").trim(),
        LOCAL: String(dados.local ?? "").trim(),
        REVISAO: String(dados.revisao ?? "").trim(),
        DISCIPLINA: String(dados.disciplina ?? "").trim() || "instalações",
        ARQUIVO_IFC: String(dados.arquivoIfc ?? "").trim()
    };
    campos.DISCIPLINAS = campos.DISCIPLINA; // compatibilidade com textos antigos

    let totalLinhas = 0;
    const secoesPayload = [...secoesAtivas.values()]
        .filter((s) => gruposPresentes.has(s.grupo))
        .sort((a, b) => a.ordem - b.ordem)
        .map((s) => {
            const itensSecao = s.listarItens
                ? [...porGrupo.get(s.grupo).values()]
                    .map((i) => {
                        const cores = [...i.cores].sort(comparar);
                        return {
                            descricao: cores.length ? `${i.base} (cores: ${juntarLista(cores.map((c) => c.toLocaleLowerCase("pt-BR")))})` : i.base,
                            referencia: [...i.referencias].sort(comparar).join(" / "),
                            unidade: i.unidade,
                            quantidade: Math.round(i.quantidade * 100) / 100
                        };
                    })
                    .sort((a, b) => comparar(a.descricao, b.descricao))
                : [];
            totalLinhas += itensSecao.length;
            return { titulo: s.titulo, paragrafos: paragrafos(s.texto, campos), itens: itensSecao };
        });

    const payload = {
        obra: campos.OBRA,
        local: campos.LOCAL,
        revisao: campos.REVISAO,
        disciplina: String(dados.disciplina ?? "").trim(),
        dataEmissao: String(dados.dataEmissao ?? "").trim(),
        apresentacao: paragrafos(config.geral.APRESENTACAO, campos),
        disposicoesGerais: paragrafos(config.geral.DISPOSICOES_GERAIS, campos),
        consideracoesFinais: paragrafos(config.geral.CONSIDERACOES_FINAIS, campos),
        normas: config.normas.filter((n) => normaSeAplica(n, gruposPresentes)).map(({ norma, titulo }) => ({ norma, titulo })),
        secoes: secoesPayload,
        opcoes: {
            mostrarQuantidades: opcoes.mostrarQuantidades !== false,
            mostrarReferencias: opcoes.mostrarReferencias !== false
        }
    };

    return {
        payload,
        resumo: {
            materiais: itens.length,
            classificados: itens.length - pendentes.length,
            secoes: secoesPayload.length,
            linhas: totalLinhas,
            pendentes
        }
    };
}

export function formatarDataEmissao(data = new Date()) {
    const mes = data.toLocaleDateString("pt-BR", { month: "long" });
    return `${mes} de ${data.getFullYear()}`;
}
