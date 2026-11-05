// memorial-core.js
// Lógica pura do memorial descritivo (sem DOM). Lê as regras da memorial_descritivo.xlsx,
// identifica a disciplina do IFC, classifica os materiais e monta o roteiro do memorial
// (títulos numerados, textos técnicos, normas e materiais) enviado para /api/gerar-memorial-word.

export const ABAS_OBRIGATORIAS = ["Geral", "Disciplinas", "Estrutura", "Classificacao", "Normas"];

const CORES = new Set([
    "amarelo", "branco", "azul", "azul claro", "azul-claro", "preto", "vermelho", "verde",
    "verde-amarelo", "verde/amarelo", "verde e amarelo", "cinza", "marrom", "laranja", "violeta", "roxo"
]);

const NOMES_GENERICOS = new Set(["", "project", "projeto", "project name", "project number", "default", "undefined",
    "unnamed", "sem nome", "building", "edificio", "site", "terreno"]);

export function normalizarTexto(valor) {
    return String(valor ?? "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

function chaveColuna(nome) {
    return normalizarTexto(nome).toUpperCase().replace(/[^A-Z0-9*]+/g, "_").replace(/^_|_$/g, "");
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

function listaCodigos(valor) {
    return String(valor ?? "").split(/[,;\n]/).map((g) => chaveColuna(g)).filter(Boolean);
}

function numero(valor, padrao) {
    const n = Number(valor);
    return String(valor ?? "").trim() !== "" && Number.isFinite(n) ? n : padrao;
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

    const disciplinas = normalizarLinhas(abas.Disciplinas)
        .map((l) => ({
            codigo: chaveColuna(l.CODIGO),
            nome: String(l.NOME ?? "").trim(),
            estrutura: chaveColuna(l.ESTRUTURA) || chaveColuna(l.CODIGO),
            identificar: String(l.IDENTIFICAR ?? "").split(/[,;\n]/).map((t) => normalizarTexto(t)).filter(Boolean)
        }))
        .filter((d) => d.codigo && d.nome);

    const estrutura = normalizarLinhas(abas.Estrutura)
        .map((l, i) => ({
            estruturas: listaCodigos(l.ESTRUTURAS),
            ordem: numero(l.ORDEM, 100000 + i),
            nivel: Math.min(3, Math.max(1, Math.round(numero(l.NIVEL, 1)))),
            titulo: String(l.TITULO ?? "").trim(),
            texto: String(l.TEXTO ?? ""),
            mostrarSe: listaCodigos(l.MOSTRAR_SE),
            listar: listaCodigos(l.LISTAR_ITENS)
        }))
        .filter((l) => l.titulo && l.estruturas.length);

    const regras = normalizarLinhas(abas.Classificacao)
        .map((l) => ({
            tipo: normalizarTexto(l.REGRA).startsWith("cont") ? "contem" : "comeca",
            texto: normalizarTexto(l.TEXTO),
            grupo: chaveColuna(l.GRUPO_MEMORIAL)
        }))
        .filter((r) => r.texto && r.grupo);

    const normas = normalizarLinhas(abas.Normas)
        .map((l) => ({
            estruturas: listaCodigos(l.ESTRUTURAS),
            norma: String(l.NORMA ?? "").trim(),
            descricao: String(l.DESCRICAO ?? "").trim(),
            mostrarSe: listaCodigos(l.MOSTRAR_SE)
        }))
        .filter((n) => n.norma && n.estruturas.length);

    return { geral, disciplinas, estrutura, regras, normas };
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

/** Identifica a disciplina pelas siglas/palavras do nome do modelo (id, nome exibido e arquivo). */
export function detectarDisciplina(modelo, disciplinas) {
    const textos = [modelo?.id, modelo?.displayName, modelo?.label, modelo?.src, modelo?.arquivo].map(normalizarTexto).join(" ");
    const tokens = new Set(textos.split(/[^a-z0-9]+/).filter(Boolean));
    let melhor = null;
    for (const d of disciplinas) {
        const pontos = d.identificar.reduce((soma, termo) => {
            if (!termo) return soma;
            if (termo.includes(" ")) return soma + (textos.includes(termo) ? 2 : 0);
            return soma + (tokens.has(termo) ? 3 : 0) + ([...tokens].some((t) => t.length > 4 && termo.length > 4 && t.startsWith(termo)) ? 1 : 0);
        }, 0);
        if (pontos > 0 && (!melhor || pontos > melhor.pontos)) melhor = { disciplina: d, pontos };
    }
    return melhor?.disciplina || disciplinas.find((d) => d.codigo === "GERAL") || disciplinas[0] || null;
}

export function separarCor(descricao) {
    const partes = String(descricao ?? "").split(" - ");
    if (partes.length < 2) return { base: String(descricao ?? "").trim(), cor: null };
    const ultima = partes[partes.length - 1].trim();
    if (!CORES.has(normalizarTexto(ultima))) return { base: String(descricao).trim(), cor: null };
    return { base: partes.slice(0, -1).join(" - ").trim(), cor: ultima };
}

/** Remove prefixos de origem ("- SINAPI - METROS - ", "- COMPOSIÇÃO PRÓPRIA - UNIDADES - ") da descrição. */
export function limparDescricao(descricao) {
    return String(descricao ?? "")
        .replace(/^\s*-\s*(SINAPI|COMPOSI[CÇ][AÃ]O PR[OÓ]PRIA)\s*-\s*(METROS|UNIDADES|M2|M3|KG)\s*-\s*/i, "")
        .replace(/\s*-\s*,\s*/g, ", ")
        .replace(/\s+/g, " ")
        .trim();
}

export function unidadeDoModelo(unitLabel) {
    const t = normalizarTexto(unitLabel);
    if (t.startsWith("metro")) return "m";
    if (t.startsWith("item")) return "un";
    return String(unitLabel ?? "").trim() || "un";
}

/** Quantidades de um único IFC (cada material guarda quantityByModel: Map modelId -> quantidade). */
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

function grupoBate(filtro, grupo) {
    return filtro.endsWith("*") ? grupo.startsWith(filtro.slice(0, -1)) : filtro === grupo;
}

function condicaoAtendida(mostrarSe, gruposPresentes) {
    if (!mostrarSe.length) return true;
    return mostrarSe.some((f) => [...gruposPresentes].some((g) => grupoBate(f, g)));
}

const comparar = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

/** Converte o TEXTO da planilha em parágrafos/marcadores; {NORMAS} marca o ponto da lista de normas. */
function converterTexto(texto, campos) {
    const blocos = [];
    aplicarCampos(texto, campos).split(/\n+/).map((l) => l.trim()).filter(Boolean).forEach((linha) => {
        if (linha === "{NORMAS}") blocos.push({ tipo: "normas" });
        else if (/^[-•–]\s+/.test(linha)) blocos.push({ tipo: "item", texto: linha.replace(/^[-•–]\s+/, "") });
        else blocos.push({ tipo: "paragrafo", texto: linha });
    });
    return blocos;
}

/**
 * @param {object} args
 * @param {Array<{name, quantity, unitLabel}>} args.itens  materiais de UM IFC (ver filtrarItensPorModelo)
 * @param {Array} args.associacoes  base_de_dados.xlsx (codigo, base, itemDescricao)
 * @param {ReturnType<typeof lerConfiguracao>} args.config
 * @param {string} args.disciplina  código da aba Disciplinas (ELE, LOG...)
 * @param {{obra,cliente,endereco,local,revisao,dataEmissao,arquivoIfc}} args.dados
 * @param {{mostrarQuantidades?:boolean, mostrarReferencias?:boolean}} args.opcoes
 */
export function montarMemorial({ itens = [], associacoes = [], config, disciplina, dados = {}, opcoes = {}, normalizarBusca } = {}) {
    if (!config) throw new Error("Configuração do memorial não carregada.");
    const normBusca = typeof normalizarBusca === "function" ? normalizarBusca : normalizarTexto;
    const disc = config.disciplinas.find((d) => d.codigo === chaveColuna(disciplina))
        || config.disciplinas.find((d) => d.codigo === "GERAL") || config.disciplinas[0];
    if (!disc) throw new Error("A aba Disciplinas está vazia.");
    const roteiro = disc.estrutura;

    const assocPorItem = new Map();
    associacoes.forEach((a) => {
        const chave = normBusca(a.itemDescricao || "");
        if (chave && !assocPorItem.has(chave)) assocPorItem.set(chave, a);
    });

    // ---- agrega os materiais do IFC por grupo (juntando cores do mesmo cabo) ----
    const porGrupo = new Map();
    const semRegra = [];
    itens.forEach((item) => {
        const nome = String(item?.name ?? "").trim();
        if (!nome) return;
        const grupo = classificarMaterial(nome, config.regras) || "SEM_GRUPO";
        if (grupo === "SEM_GRUPO") semRegra.push(nome);
        const assoc = assocPorItem.get(normBusca(nome));
        const unidade = unidadeDoModelo(item.unitLabel);
        const { base, cor } = separarCor(limparDescricao(nome));
        const chave = `${normalizarTexto(base)}|${unidade}`;
        if (!porGrupo.has(grupo)) porGrupo.set(grupo, new Map());
        const mapa = porGrupo.get(grupo);
        const atual = mapa.get(chave) || { base, cores: new Set(), referencias: new Set(), unidade, quantidade: 0 };
        atual.quantidade += Number.isFinite(item.quantity) ? item.quantity : 0;
        if (cor) atual.cores.add(cor);
        if (assoc?.codigo) atual.referencias.add(`${assoc.base ? `${assoc.base} ` : ""}${assoc.codigo}`);
        mapa.set(chave, atual);
    });

    const linhasDoGrupo = (grupo) => [...(porGrupo.get(grupo)?.values() || [])]
        .map((i) => {
            const cores = [...i.cores].sort(comparar).map((c) => c.toLocaleLowerCase("pt-BR"));
            return {
                descricao: cores.length ? `${i.base} (cores: ${juntarLista(cores)})` : i.base,
                referencia: [...i.referencias].sort(comparar).join(" / "),
                unidade: i.unidade,
                quantidade: Math.round(i.quantidade * 100) / 100
            };
        })
        .sort((a, b) => comparar(a.descricao, b.descricao));

    const gruposPresentes = new Set([...porGrupo.keys()].filter((g) => g !== "SEM_GRUPO"));
    const campos = {
        OBRA: String(dados.obra ?? "").trim(),
        CLIENTE: String(dados.cliente ?? "").trim(),
        LOCAL: String(dados.local ?? "").trim(),
        ENDERECO: String(dados.endereco ?? "").trim(),
        REVISAO: String(dados.revisao ?? "").trim(),
        ARQUIVO_IFC: String(dados.arquivoIfc ?? "").trim() || "do projeto",
        DISCIPLINA: disc.nome,
        DISCIPLINA_TEXTO: disc.nome.toLocaleLowerCase("pt-BR")
    };
    campos.ONDE = campos.ENDERECO || campos.LOCAL || "local indicado em projeto";
    campos.DISCIPLINAS = campos.DISCIPLINA;

    const normas = config.normas
        .filter((n) => n.estruturas.includes(roteiro) && condicaoAtendida(n.mostrarSe, gruposPresentes))
        .map((n) => ({ norma: n.norma, descricao: n.descricao }))
        .filter((n, i, lista) => lista.findIndex((m) => normalizarTexto(m.norma) === normalizarTexto(n.norma)) === i);

    // ---- roteiro: só as linhas desta estrutura cuja condição foi atendida ----
    const linhas = config.estrutura
        .filter((l) => l.estruturas.includes(roteiro) && condicaoAtendida(l.mostrarSe, gruposPresentes))
        .sort((a, b) => a.ordem - b.ordem);

    // um subtítulo não pode ficar mais de um nível abaixo do anterior (ex.: 2 sem 1 antes)
    let nivelAnterior = 0;
    const gruposListados = new Set();
    const anexo = [];
    const titulos = linhas.map((l) => {
        const nivel = Math.min(l.nivel, nivelAnterior + 1);
        nivelAnterior = nivel;
        const materiais = [];
        l.listar.forEach((filtro) => {
            [...gruposPresentes].filter((g) => grupoBate(filtro, g) && !gruposListados.has(g)).sort().forEach((g) => {
                gruposListados.add(g);
                materiais.push(...linhasDoGrupo(g));
            });
        });
        if (materiais.length) anexo.push({ titulo: l.titulo, itens: materiais });
        const conteudo = converterTexto(l.texto, campos);
        return { nivel, titulo: l.titulo, conteudo, materiais: materiais.map((m) => m.descricao) };
    });

    // materiais que não couberam em nenhum título do roteiro vão só para o anexo
    const foraDoRoteiro = [...gruposPresentes].filter((g) => !gruposListados.has(g)).sort();
    const outros = [...foraDoRoteiro, ...(porGrupo.has("SEM_GRUPO") ? ["SEM_GRUPO"] : [])].flatMap(linhasDoGrupo);
    if (outros.length) anexo.push({ titulo: "Outros materiais do modelo", itens: outros });

    const pendentes = [
        ...semRegra.map((nome) => ({ nome, motivo: "sem regra na aba Classificacao" })),
        ...foraDoRoteiro.flatMap((g) => linhasDoGrupo(g).map((i) => ({ nome: i.descricao, motivo: `grupo ${g} sem título no roteiro ${roteiro}` })))
    ];

    const payload = {
        obra: campos.OBRA,
        cliente: campos.CLIENTE,
        endereco: campos.ENDERECO,
        local: campos.LOCAL,
        revisao: campos.REVISAO,
        dataEmissao: String(dados.dataEmissao ?? "").trim(),
        disciplina: disc.nome,
        titulos,
        normas,
        anexo,
        opcoes: {
            mostrarQuantidades: opcoes.mostrarQuantidades !== false,
            mostrarReferencias: opcoes.mostrarReferencias !== false
        }
    };

    return {
        payload,
        resumo: {
            disciplina: disc.codigo,
            materiais: itens.length,
            titulos: titulos.length,
            linhas: anexo.reduce((s, g) => s + g.itens.length, 0),
            pendentes
        }
    };
}

export function formatarDataEmissao(data = new Date()) {
    const mes = data.toLocaleDateString("pt-BR", { month: "long" });
    return `${mes} de ${data.getFullYear()}`;
}
