// memorial-core.js
// Lógica pura do memorial descritivo (sem DOM). Lê as regras da memorial_descritivo.xlsx,
// identifica a disciplina do IFC, classifica os materiais e monta o roteiro do memorial
// (títulos numerados, textos técnicos, normas e materiais) enviado para /api/gerar-memorial-word.

export const ABAS_OBRIGATORIAS = ["Geral", "Disciplinas", "Estrutura", "Classificacao", "Normas"];
export const ABAS_OPCIONAIS = ["Atributos"];

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

    // Atributos (aba opcional): características lidas dos nomes dos materiais, usadas nos textos como {NOME}
    const atributos = normalizarLinhas(abas.Atributos)
        .map((l) => {
            let regex = null;
            try { regex = new RegExp(String(l.PADRAO ?? ""), "i"); } catch (_) { regex = null; }
            return {
                nome: chaveColuna(l.NOME),
                grupos: listaCodigos(l.GRUPOS),
                regex,
                formato: String(l.FORMATO ?? "").trim() || "$1",
                modo: chaveColuna(l.MODO) || "LISTA",
                // a planilha corta espaços: " m" vira "m"; recoloca o espaço antes de unidades
                sufixo: (() => { const s = String(l.SUFIXO ?? "").trim(); return s && !/^[,.;:)]/.test(s) ? ` ${s}` : s; })(),
                fator: numero(l.FATOR, 1)
            };
        })
        .filter((a) => a.nome && a.regex && String(a.regex.source) !== "(?:)");

    return { geral, disciplinas, estrutura, regras, normas, atributos };
}

const formatarNumero = (n, casas = 2) => n.toLocaleString("pt-BR", { maximumFractionDigits: casas });
const paraNumero = (texto) => Number(String(texto).replace(",", "."));

function limparValorAtributo(valor) {
    return String(valor ?? "")
        .replace(/\(\s*[^)]*?\s*\$\d+\s*\)/g, "")   // grupo vazio entre parênteses
        .replace(/\s+-\s+/g, ", ")
        .replace(/(\d+)\.(\d+\/\d+)"/g, "$1 $2\"")           // 1.1/2" -> 1 1/2"
        .replace(/\b(\d+)\.(\d+)\b(?![\/\d])/g, "$1,$2") // 2.5 -> 2,5
        .replace(/\(\s*\)/g, "")
        .replace(/(\d)(mm²|mm|cm|kV|kA|Wp|V|A|W)(?![\wÀ-ú])/g, "$1 $2")
        .replace(/\b(\d{4,})\s*W\b/g, (_, w) => `${formatarNumero(Number(w) / 1000)} kW`)
        .replace(/\s+/g, " ")
        .replace(/\s+([,.)])/g, "$1")
        .replace(/\bfranklin\b/g, "Franklin")
        .trim();
}

/** "3/4\"" -> 0,75; "1 1/2\"" -> 1,5; "2,5" -> 2,5; "100x100 mm (chapa 18)" -> 100. Outros textos -> NaN. */
function valorNumerico(valor) {
    const v = String(valor).trim();
    let m = v.match(/^(\d+)(?:\s+(\d+)\/(\d+))?"$/);
    if (m) return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
    m = v.match(/^(\d+)\/(\d+)"$/);
    if (m) return Number(m[1]) / Number(m[2]);
    m = v.match(/^(\d+)x(\d+)/);
    if (m) return Number(m[1]) * 10000 + Number(m[2]);
    m = v.match(/^\d+(?:,\d+)?$/);
    if (m) return Number(v.replace(",", "."));
    return NaN;
}

/** Calcula os atributos (características dos materiais) a partir dos itens do IFC já classificados. */
export function calcularAtributos(atributos = [], itensClassificados = []) {
    const valores = {};
    const porNome = new Map();
    atributos.forEach((a) => {
        if (!porNome.has(a.nome)) porNome.set(a.nome, []);
        porNome.get(a.nome).push(a);
    });
    porNome.forEach((linhas, nome) => {
        const lista = [];
        let total = 0;
        let achou = false;
        const sufixo = linhas[0].sufixo;
        const modo = linhas[0].modo;
        linhas.forEach((a) => {
            itensClassificados.filter((i) => a.grupos.some((f) => grupoBate(f, i.grupo))).forEach((item) => {
                const m = item.nome.match(a.regex);
                if (!m) return;
                achou = true;
                if (modo === "CONTAGEM") { total += item.quantidade; return; }
                if (modo === "SOMA") { total += item.quantidade * paraNumero(m[1]) * a.fator; return; }
                const bruto = a.formato.replace(/\$(L?)(\d)/g, (_, minusculo, n) => {
                    const v = m[Number(n)];
                    if (v === undefined) return `$${n}`;
                    return minusculo ? v.toLocaleLowerCase("pt-BR") : v;
                });
                const valor = limparValorAtributo(bruto);
                if (valor && !lista.some((v) => normalizarTexto(v) === normalizarTexto(valor))) lista.push(valor);
            });
        });
        if (!achou) { valores[nome] = ""; return; }
        if (modo === "CONTAGEM" || modo === "SOMA") {
            valores[nome] = `${formatarNumero(total, modo === "SOMA" ? 2 : 0)}${sufixo}`;
            return;
        }
        if (modo === "FAIXA") {
            const numeros = lista.map(paraNumero).filter(Number.isFinite).sort((x, y) => x - y);
            if (!numeros.length) { valores[nome] = ""; return; }
            const [min, max] = [numeros[0], numeros[numeros.length - 1]];
            valores[nome] = min === max ? `de ${formatarNumero(min)}${sufixo}` : `de ${formatarNumero(min)}${sufixo} a ${formatarNumero(max)}${sufixo}`;
            return;
        }
        const numeros = lista.map(valorNumerico);
        const ordenada = numeros.every(Number.isFinite)
            ? lista.map((v, i) => [v, numeros[i]]).sort((x, y) => x[1] - y[1]).map(([v]) => v)
            : [...lista].sort(comparar);
        // valores que já têm vírgula (ex.: "cabo de cobre nu, 50 mm²") são separados por ponto e vírgula
        const juntos = ordenada.some((v) => v.includes(","))
            ? (ordenada.length > 1 ? `${ordenada.slice(0, -1).join("; ")} e ${ordenada[ordenada.length - 1]}` : ordenada[0])
            : juntarLista(ordenada);
        valores[nome] = ordenada.length ? `${juntos}${sufixo}` : "";
    });
    return valores;
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
        .replace(/^\s*\.S\.O\.S\s+/i, "")
        .replace(/^\s*\./, "")
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
    const normal = normalizarTexto(texto);
    // nomes-padrão dos exportadores (Revit, ArchiCAD...): "IfcBuilding", "Default Site", "Edifício 1"...
    if (NOMES_GENERICOS.has(normal)) return "";
    if (/^(ifc)?\s*(building|site|project|edificio|edificacao|projeto|terreno)(\s*\d+)?$/.test(normal)) return "";
    if (/^(default|my|meu|novo|new)\s+(building|site|project|edificio|projeto)$/.test(normal)) return "";
    return texto;
}

function juntarLista(lista) {
    if (lista.length <= 1) return lista.join("");
    return `${lista.slice(0, -1).join(", ")} e ${lista[lista.length - 1]}`;
}

function aplicarCampos(texto, campos) {
    // [[ ... ]] = trecho opcional: só aparece se todos os campos dentro dele tiverem valor
    const comOpcionais = String(texto ?? "").replace(/\[\[([\s\S]*?)\]\]/g, (_, trecho) => {
        const nomes = [...trecho.matchAll(/\{([A-Z0-9_]+)\}/g)].map((m) => m[1]);
        return nomes.every((n) => String(campos[n] ?? "").trim()) ? trecho : "";
    });
    return comOpcionais.replace(/\{([A-Z0-9_]+)\}/g, (inteiro, nome) => {
        if (!(nome in campos)) return inteiro;
        return String(campos[nome] ?? "").trim() || (campos.__atributos?.has(nome) ? "conforme projeto" : "");
    });
}

function grupoBate(filtro, grupo) {
    return filtro.endsWith("*") ? grupo.startsWith(filtro.slice(0, -1)) : filtro === grupo;
}

function condicaoAtendida(mostrarSe, gruposPresentes) {
    if (!mostrarSe.length) return true;
    return mostrarSe.some((f) => [...gruposPresentes].some((g) => grupoBate(f, g)));
}

const SIGLAS = new Set(["CFTV", "SPDA", "DR", "DPS", "TV", "LED", "PVC", "GLP", "UTP", "IFC", "BEP", "QDC", "PE", "SINAPI"]);

/** "QUADROS DE DISTRIBUIÇÃO" -> "Quadros de distribuição" (mantém siglas); títulos já em minúsculas ficam iguais. */
export function tituloFrase(titulo) {
    const texto = String(titulo ?? "").trim();
    if (texto !== texto.toLocaleUpperCase("pt-BR")) return texto;
    const frase = texto.split(/(\s+|[()/,–-])/).map((parte) => {
        const limpo = parte.replace(/[^A-ZÀ-Ú0-9]/gi, "");
        return SIGLAS.has(limpo) ? parte : parte.toLocaleLowerCase("pt-BR");
    }).join("");
    return frase.charAt(0).toLocaleUpperCase("pt-BR") + frase.slice(1);
}

const comparar = (a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" });

/** Converte o TEXTO da planilha em parágrafos/marcadores; {NORMAS} marca o ponto da lista de normas. */
function converterTexto(texto, campos) {
    const blocos = [];
    aplicarCampos(texto, campos).split(/\n+/).map((l) => l.replace(/[ \t]{2,}/g, " ").trim()).filter(Boolean).forEach((linha) => {
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
    const itensClassificados = [];
    itens.forEach((item) => {
        const nome = String(item?.name ?? "").trim();
        if (!nome) return;
        const grupo = classificarMaterial(nome, config.regras) || "SEM_GRUPO";
        itensClassificados.push({ nome, grupo, quantidade: Number.isFinite(item.quantity) ? item.quantity : 0 });
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
    campos.CLIENTE_FRASE = campos.CLIENTE ? `, para o cliente ${campos.CLIENTE}` : "";
    campos.DISCIPLINAS = campos.DISCIPLINA;
    const atributos = calcularAtributos(config.atributos || [], itensClassificados);
    Object.assign(campos, atributos);
    Object.defineProperty(campos, "__atributos", { value: new Set(Object.keys(atributos)), enumerable: false });

    // normas próprias do roteiro primeiro; as comuns a vários roteiros (infraestrutura, NRs) depois
    const normas = config.normas
        .filter((n) => n.estruturas.includes(roteiro) && condicaoAtendida(n.mostrarSe, gruposPresentes))
        .map((n, i) => ({ n, i, comum: n.estruturas.length > 1 ? 1 : 0 }))
        .sort((a, b) => a.comum - b.comum || a.i - b.i)
        .map(({ n }) => n)
        .map((n) => ({ norma: n.norma, descricao: n.descricao }))
        .filter((n, i, lista) => lista.findIndex((m) => normalizarTexto(m.norma) === normalizarTexto(n.norma)) === i);

    // ---- roteiro: só as linhas desta estrutura cuja condição foi atendida ----
    const linhas = config.estrutura
        .filter((l) => l.estruturas.includes(roteiro) && condicaoAtendida(l.mostrarSe, gruposPresentes))
        .sort((a, b) => a.ordem - b.ordem);

    // Um título com um único subtítulo vira um título só (texto do pai + texto do filho),
    // evitando a subdivisão única "8. Condutores / 8.1 Condutores dos circuitos".
    const linhasRoteiro = [];
    for (let i = 0; i < linhas.length; i += 1) {
        const l = linhas[i];
        const filhos = [];
        for (let j = i + 1; j < linhas.length && linhas[j].nivel > l.nivel; j += 1) {
            if (linhas[j].nivel === l.nivel + 1) filhos.push(j);
        }
        const unicoFilho = filhos.length === 1 && (filhos[0] === linhas.length - 1 || linhas[filhos[0] + 1]?.nivel <= l.nivel)
            ? linhas[filhos[0]] : null;
        if (unicoFilho && unicoFilho.nivel === l.nivel + 1) {
            linhasRoteiro.push({ ...l, texto: `${l.texto}\n${unicoFilho.texto}`, listar: [...l.listar, ...unicoFilho.listar], tituloAnexo: unicoFilho.listar.length && !l.listar.length ? unicoFilho.titulo : l.titulo });
            i = filhos[0];
            continue;
        }
        linhasRoteiro.push(l);
    }

    // um subtítulo não pode ficar mais de um nível abaixo do anterior (ex.: 2 sem 1 antes)
    let nivelAnterior = 0;
    const gruposListados = new Set();
    const anexo = [];
    const titulos = linhasRoteiro.map((l) => {
        const nivel = Math.min(l.nivel, nivelAnterior + 1);
        nivelAnterior = nivel;
        const materiais = [];
        l.listar.forEach((filtro) => {
            [...gruposPresentes].filter((g) => grupoBate(filtro, g) && !gruposListados.has(g)).sort().forEach((g) => {
                gruposListados.add(g);
                materiais.push(...linhasDoGrupo(g));
            });
        });
        if (materiais.length) anexo.push({ titulo: tituloFrase(l.tituloAnexo || l.titulo), itens: materiais });
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
            pendentes,
            atributos
        }
    };
}

export function formatarDataEmissao(data = new Date()) {
    const mes = data.toLocaleDateString("pt-BR", { month: "long" });
    return `${mes} de ${data.getFullYear()}`;
}
