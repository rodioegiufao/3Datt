// memorial-export.js
// Memorial descritivo por IFC: pega o modelo aberto no viewer (ou o escolhido, se houver
// mais de um), lê o nome da obra no IfcProject, filtra os materiais desse IFC, cruza com
// memorial_descritivo.xlsx (textos) e base_de_dados.xlsx (códigos SINAPI) e baixa o Word
// gerado por /api/gerar-memorial-word no timbrado da empresa.

import { loadAssociationDefinitionsFromExcel, loadWorkbookFromExcel } from "./excel-export.js";
import { ABAS_OBRIGATORIAS, filtrarItensPorModelo, formatarDataEmissao, lerConfiguracao, montarMemorial, nomeIfcUtil, normalizarTexto } from "./memorial-core.js";

const MEMORIAL_XLSX = "/3D/memorial_descritivo.xlsx";
const BASE_XLSX = "./base_de_dados.xlsx";
const ENDPOINT = "/api/gerar-memorial-word";

let dialogo = null;
const formularioPorModelo = new Map();

function metaObjetosDoTipo(viewer, tipo, modeloId) {
    const metaScene = viewer?.metaScene;
    if (!metaScene) return [];
    const doModelo = (mo) => mo?.metaModel?.id === modeloId || (Array.isArray(mo?.metaModels) && mo.metaModels.some((m) => m?.id === modeloId));
    const porTipo = metaScene.metaObjectsByType?.[tipo];
    const candidatos = porTipo ? Object.values(porTipo) : Object.values(metaScene.metaObjects || {}).filter((mo) => mo?.type === tipo);
    return candidatos.filter(doModelo);
}

/** Lê do IFC carregado: nome da obra (IfcProject → IfcBuilding → IfcSite) e nome do arquivo. */
export function lerInfoIfc(viewer, modelo) {
    const arquivo = String(modelo.src || modelo.id || "").split(/[\\/]/).pop().replace(/\.(xkt|ifc|glb|gltf)$/i, "");
    // Muitos IFC exportados do Revit trazem no IfcProject só o código do arquivo (ex.: IFC-ELE-DRL):
    // nesse caso o nome não serve como obra e passamos para o próximo candidato.
    const pareceCodigo = (nome) => /^(ifc|xkt)[-_ ]/i.test(nome) || normalizarTexto(nome) === normalizarTexto(arquivo);
    const primeiroNome = (tipo) => metaObjetosDoTipo(viewer, tipo, modelo.id)
        .map((mo) => nomeIfcUtil(mo.name))
        .find((nome) => nome && !pareceCodigo(nome)) || "";
    return {
        obra: primeiroNome("IfcProject") || primeiroNome("IfcBuilding") || primeiroNome("IfcSite"),
        disciplina: String(modelo.displayName || modelo.label || "").trim(),
        arquivoIfc: arquivo
    };
}

async function carregarConfiguracao() {
    const workbook = await loadWorkbookFromExcel(MEMORIAL_XLSX);
    const abas = {};
    ABAS_OBRIGATORIAS.forEach((nome) => {
        const sheet = workbook.Sheets[nome];
        if (sheet) abas[nome] = window.XLSX.utils.sheet_to_json(sheet, { defval: "" });
    });
    return lerConfiguracao(abas);
}

function injetarEstilo() {
    if (document.getElementById("memorial-dialog-style")) return;
    const style = document.createElement("style");
    style.id = "memorial-dialog-style";
    style.textContent = `
.memorial-dialog { width: min(560px, calc(100vw - 32px)); padding: 0; border: 1px solid var(--ui-border, rgba(255,255,255,.08)); border-radius: 12px; background: var(--ui-surface-solid, #1a1c20); color: var(--ui-text, #eceef1); font: 13px var(--ui-font, system-ui, sans-serif); box-shadow: 0 20px 60px rgba(0,0,0,.5); }
.memorial-dialog [hidden] { display: none !important; }
.memorial-dialog::backdrop { background: rgba(0,0,0,.55); }
.memorial-dialog form { display: grid; gap: 14px; padding: 20px; }
.memorial-dialog h2 { margin: 0; font-size: 16px; }
.memorial-dialog .memorial-sub { margin: -8px 0 0; opacity: .7; }
.memorial-dialog .memorial-campos { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.memorial-dialog label { display: grid; gap: 4px; font-weight: 600; }
.memorial-dialog label.memorial-largo { grid-column: 1 / -1; }
.memorial-dialog select, .memorial-dialog input[type=text] { height: 34px; padding: 0 10px; border-radius: 6px; border: 1px solid var(--ui-border, rgba(255,255,255,.08)); background: var(--ui-raised, rgba(255,255,255,.06)); color: inherit; font: inherit; font-weight: 400; }
.memorial-dialog select:focus, .memorial-dialog input[type=text]:focus { outline: 2px solid var(--ui-focus, #8fc1ff); outline-offset: 1px; }
.memorial-dialog .memorial-opcoes { display: flex; flex-wrap: wrap; gap: 6px 18px; }
.memorial-dialog .memorial-opcoes label { display: flex; align-items: center; gap: 6px; font-weight: 400; }
.memorial-dialog .memorial-resumo { padding: 10px 12px; border-radius: 8px; background: var(--ui-raised, rgba(255,255,255,.06)); line-height: 1.5; }
.memorial-dialog details { border: 1px solid rgba(255,196,0,.35); border-radius: 8px; padding: 8px 12px; background: rgba(255,196,0,.06); }
.memorial-dialog summary { cursor: pointer; font-weight: 600; }
.memorial-dialog details ul { max-height: 160px; overflow: auto; margin: 8px 0 0; padding-left: 18px; }
.memorial-dialog details li { margin: 2px 0; }
.memorial-dialog details small { opacity: .65; }
.memorial-dialog .memorial-erro { margin: 0; color: #ff8a80; }
.memorial-dialog .memorial-erro:empty { display: none; }
.memorial-dialog .memorial-botoes { display: flex; justify-content: flex-end; gap: 8px; }
.memorial-dialog button { height: 36px; padding: 0 16px; border-radius: 6px; border: 1px solid var(--ui-border, rgba(255,255,255,.08)); background: var(--ui-raised, rgba(255,255,255,.06)); color: inherit; font: 600 13px var(--ui-font, system-ui, sans-serif); cursor: pointer; }
.memorial-dialog button.memorial-primario { background: var(--ui-active-bg, #eceef1); color: var(--ui-surface-solid, #1a1c20); border-color: transparent; }
.memorial-dialog button:disabled { opacity: .5; cursor: default; }
@media (max-width: 520px) { .memorial-dialog .memorial-campos { grid-template-columns: 1fr; } }`;
    document.head.appendChild(style);
}

function criarDialogo() {
    injetarEstilo();
    const el = document.createElement("dialog");
    el.className = "memorial-dialog";
    el.setAttribute("aria-labelledby", "memorialDialogTitle");
    el.innerHTML = `
<form method="dialog" novalidate>
    <h2 id="memorialDialogTitle">Memorial descritivo (Word)</h2>
    <p class="memorial-sub">Gerado a partir dos materiais do IFC aberto, no timbrado da empresa.</p>
    <div class="memorial-campos">
        <label class="memorial-largo memorial-modelo">Modelo IFC<select name="modelo"></select></label>
        <label class="memorial-largo">Obra<input type="text" name="obra" maxlength="200" required autocomplete="off"></label>
        <label class="memorial-largo">Disciplina<input type="text" name="disciplina" maxlength="200" autocomplete="off"></label>
        <label>Local<input type="text" name="local" maxlength="200" autocomplete="off"></label>
        <label>Revisão<input type="text" name="revisao" maxlength="30" autocomplete="off"></label>
        <label class="memorial-largo">Data de emissão<input type="text" name="dataEmissao" maxlength="60" autocomplete="off"></label>
    </div>
    <div class="memorial-opcoes">
        <label><input type="checkbox" name="mostrarQuantidades" checked> Incluir quantitativos</label>
        <label><input type="checkbox" name="mostrarReferencias" checked> Incluir códigos de referência (SINAPI)</label>
    </div>
    <div class="memorial-resumo" aria-live="polite">Carregando regras do memorial…</div>
    <details class="memorial-pendentes" hidden><summary></summary><ul></ul></details>
    <p class="memorial-erro" role="alert"></p>
    <div class="memorial-botoes">
        <button type="button" data-acao="cancelar">Cancelar</button>
        <button type="submit" class="memorial-primario" data-acao="gerar" disabled>Gerar Word</button>
    </div>
</form>`;
    document.body.appendChild(el);
    el.querySelector('[data-acao="cancelar"]').addEventListener("click", () => el.close());
    return el;
}

function lerFormulario(form) {
    return {
        obra: form.obra.value.trim(),
        disciplina: form.disciplina.value.trim(),
        local: form.local.value.trim(),
        revisao: form.revisao.value.trim(),
        dataEmissao: form.dataEmissao.value.trim(),
        mostrarQuantidades: form.mostrarQuantidades.checked,
        mostrarReferencias: form.mostrarReferencias.checked
    };
}

function preencherFormulario(form, valores) {
    form.obra.value = valores.obra || "";
    form.disciplina.value = valores.disciplina || "";
    form.local.value = valores.local || "";
    form.revisao.value = valores.revisao || "R00";
    form.dataEmissao.value = valores.dataEmissao || "";
    form.mostrarQuantidades.checked = valores.mostrarQuantidades !== false;
    form.mostrarReferencias.checked = valores.mostrarReferencias !== false;
}

function renderizarResumo(el, resumo) {
    const caixa = el.querySelector(".memorial-resumo");
    caixa.textContent = resumo.secoes
        ? `${resumo.classificados} de ${resumo.materiais} materiais deste IFC entram no memorial, em ${resumo.secoes} seção(ões) (${resumo.linhas} linha(s) de especificação).`
        : resumo.materiais
            ? "Nenhum material deste IFC corresponde às regras da memorial_descritivo.xlsx."
            : "Este IFC não tem materiais na lista. Gere a lista de materiais com ele carregado.";

    const detalhes = el.querySelector(".memorial-pendentes");
    const lista = detalhes.querySelector("ul");
    lista.innerHTML = "";
    detalhes.hidden = !resumo.pendentes.length;
    if (!resumo.pendentes.length) return;
    detalhes.querySelector("summary").textContent =
        `${resumo.pendentes.length} material(is) ficarão de fora — complete a aba Classificacao`;
    resumo.pendentes.slice(0, 300).forEach(({ nome, motivo }) => {
        const li = document.createElement("li");
        li.textContent = nome;
        const small = document.createElement("small");
        small.textContent = ` (${motivo})`;
        li.appendChild(small);
        lista.appendChild(li);
    });
}

function nomeDoArquivo(resposta, padrao) {
    const cabecalho = resposta.headers.get("Content-Disposition") || "";
    const m = cabecalho.match(/filename="?([^";]+)"?/i);
    return m ? m[1] : padrao;
}

async function baixarWord(payload) {
    const resposta = await fetch(ENDPOINT, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!resposta.ok) {
        let mensagem = `Falha ao gerar o Word (status ${resposta.status}).`;
        try { mensagem = (await resposta.json()).error || mensagem; } catch (_) { /* resposta não-JSON */ }
        throw new Error(mensagem);
    }
    const blob = await resposta.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = nomeDoArquivo(resposta, "memorial-descritivo.docx");
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {object} args
 * @param {Array} args.itens  materiais consolidados (materialsAllResults), com quantityByModel
 * @param {Array<{id,src,displayName}>} args.modelos  modelos IFC carregados no viewer
 * @param {object} [args.viewer]  viewer xeokit, para ler IfcProject do modelo
 * @param {(s:string)=>string} [args.normalizarBusca]
 * @param {string} [args.obraPadrao]  nome do projeto no site, se o IFC não tiver nome útil
 */
export async function abrirGeradorMemorial({ itens = [], modelos = [], viewer, normalizarBusca, obraPadrao = "" } = {}) {
    if (!Array.isArray(itens) || !itens.length) {
        window.alert("Gere a lista de materiais antes de criar o memorial.");
        return;
    }
    if (!modelos.length) {
        window.alert("Nenhum modelo IFC carregado.");
        return;
    }

    dialogo ||= criarDialogo();
    const form = dialogo.querySelector("form");
    const botaoGerar = dialogo.querySelector('[data-acao="gerar"]');
    const erro = dialogo.querySelector(".memorial-erro");
    erro.textContent = "";
    botaoGerar.disabled = true;
    botaoGerar.textContent = "Gerar Word";

    // Seletor de IFC (some quando só há um modelo aberto)
    form.modelo.innerHTML = "";
    modelos.forEach((m) => {
        const opcao = document.createElement("option");
        opcao.value = m.id;
        opcao.textContent = m.displayName || m.id;
        form.modelo.appendChild(opcao);
    });
    dialogo.querySelector(".memorial-modelo").hidden = modelos.length < 2;

    dialogo.querySelector(".memorial-resumo").textContent = "Carregando regras do memorial…";
    dialogo.querySelector(".memorial-pendentes").hidden = true;
    if (!dialogo.open) dialogo.showModal();

    let config;
    let associacoes;
    try {
        [config, associacoes] = await Promise.all([
            carregarConfiguracao(),
            loadAssociationDefinitionsFromExcel({ excelPath: BASE_XLSX }).catch((e) => {
                console.warn("[memorial] base_de_dados.xlsx indisponível; seguindo sem códigos.", e);
                return [];
            })
        ]);
    } catch (e) {
        console.error("[memorial] Falha ao carregar regras:", e);
        dialogo.querySelector(".memorial-resumo").textContent = "Não foi possível carregar a memorial_descritivo.xlsx.";
        erro.textContent = e.message;
        return;
    }

    const modeloAtual = () => modelos.find((m) => m.id === form.modelo.value) || modelos[0];
    const itensDoModelo = () => {
        const filtrados = filtrarItensPorModelo(itens, modeloAtual().id);
        // Lista sem quantidade por modelo e só um IFC aberto: tudo é dele
        return !filtrados.length && modelos.length === 1 ? itens : filtrados;
    };

    const preencherPeloIfc = () => {
        const modelo = modeloAtual();
        const salvo = formularioPorModelo.get(modelo.id);
        const ifc = lerInfoIfc(viewer, modelo);
        preencherFormulario(form, salvo || {
            obra: ifc.obra || obraPadrao,
            disciplina: ifc.disciplina,
            local: config.geral.LOCAL_PADRAO || "",
            dataEmissao: formatarDataEmissao()
        });
        form.dataset.arquivoIfc = ifc.arquivoIfc;
    };

    const calcular = () => {
        const valores = lerFormulario(form);
        return montarMemorial({
            itens: itensDoModelo(),
            associacoes,
            config,
            normalizarBusca,
            dados: { ...valores, arquivoIfc: form.dataset.arquivoIfc || "" },
            opcoes: { mostrarQuantidades: valores.mostrarQuantidades, mostrarReferencias: valores.mostrarReferencias }
        });
    };

    const atualizarResumo = () => {
        const { resumo } = calcular();
        renderizarResumo(dialogo, resumo);
        botaoGerar.disabled = !resumo.secoes;
    };

    form.modelo.onchange = () => {
        erro.textContent = "";
        preencherPeloIfc();
        atualizarResumo();
    };
    preencherPeloIfc();
    atualizarResumo();

    form.onsubmit = async (event) => {
        event.preventDefault();
        erro.textContent = "";
        const valores = lerFormulario(form);
        if (!valores.obra) {
            erro.textContent = "Informe o nome da obra.";
            form.obra.focus();
            return;
        }
        const { payload } = calcular();
        botaoGerar.disabled = true;
        botaoGerar.textContent = "Gerando…";
        try {
            await baixarWord(payload);
            formularioPorModelo.set(modeloAtual().id, valores);
            dialogo.close();
        } catch (e) {
            console.error("[memorial] Falha ao gerar Word:", e);
            erro.textContent = e.message;
        } finally {
            botaoGerar.disabled = false;
            botaoGerar.textContent = "Gerar Word";
        }
    };
}
