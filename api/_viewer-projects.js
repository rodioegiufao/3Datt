// Cadastro dos projetos do visualizador 3D.
// Cada entrada vira uma página /3D/<slug>, montada a partir de 3D/viewer.html.
// Para criar um projeto novo: cadastre os modelos em 3D/viewer/project-config.js
// e acrescente uma linha aqui (slug = endereço, project = chave do project-config).

const BUDGET_PANEL = (name) => `
    <div id="budgetPanel" hidden>
        <div class="budget-panel-header">
            <div>
                <div class="budget-panel-title">Orçamento da ${name}</div>
                <div class="budget-panel-subtitle">Planilha orçamentária interna com cálculo automático de total por item</div>
            </div>
            <button id="closeBudgetPanel" type="button" aria-label="Fechar painel">✕</button>
        </div>
        <p id="budgetStatus" class="budget-status">Carregando orçamento...</p>
        <div class="budget-table-wrapper" aria-label="Tabela do orçamento da ${name}">
            <table id="budgetTable" class="budget-table" hidden>
                <thead>
                    <tr>
                        <th>Item</th>
                        <th>Código</th>
                        <th>Banco</th>
                        <th>Descrição</th>
                        <th>Und</th>
                        <th>Quant.</th>
                        <th>Valor Unit</th>
                        <th>Valor Unit com BDI</th>
                        <th>Total</th>
                        <th>Peso (%)</th>
                    </tr>
                </thead>
                <tbody id="budgetTableBody"></tbody>
            </table>
        </div>
    </div>`;

const ROTATE_HELP = "<kbd>J</kbd> — Rotacionar a peça selecionada em 90°";

/**
 * slug        endereço da página (/3D/<slug>), sensível a maiúsculas
 * project     chave do projeto em project-config.js (vai no data-project do <body>)
 * name        nome exibido no título da aba e no compartilhamento
 * description texto da prévia ao compartilhar o link (opcional)
 * image       imagem da prévia (1200×630), caminho a partir da raiz do site (opcional)
 * help        atalhos extras na Ajuda (opcional)
 * budget      true = inclui o painel de orçamento do projeto (opcional)
 */
const VIEWER_PROJECTS = [
    { slug: "TCE", project: "tce", name: "TCE", description: "Modelo BIM 3D do TCE com todas as disciplinas de projeto.", image: "/3D/img/og-tce.jpg" },
    { slug: "iper", project: "iper", name: "IPER" },
    { slug: "lacen", project: "lacen", name: "LACEN" },
    { slug: "policlinica", project: "policlinica", name: "Policlínica" },
    { slug: "farmacia", project: "farmacia", name: "Farmácia do Jânio" },
    { slug: "fecomercio", project: "fecomercio", name: "Fecomercio" },
    { slug: "esc_canaa", project: "esc_canaa", name: "Escola Canaã", budget: true, help: ["<kbd>Z</kbd> — Mostrar orçamento da Escola Canaã", ROTATE_HELP] },
    { slug: "esc_modelo", project: "esc_modelo", name: "ESC Modelo" },
    { slug: "sebrae-rr", project: "sebrae_rr", name: "Sebrae RR", help: [ROTATE_HELP] },
    { slug: "sesc_centro_ecologico", project: "sesc_centro_ecologico", name: "SESC Centro Ecológico" },
    { slug: "psb", project: "psb", name: "Posto São Bento" }
];

function findViewerProject(slug) {
    const value = String(slug || "").replace(/\.html$/i, "");
    return VIEWER_PROJECTS.find((p) => p.slug === value)
        || VIEWER_PROJECTS.find((p) => p.slug.toLowerCase() === value.toLowerCase())
        || null;
}

module.exports = { VIEWER_PROJECTS, findViewerProject, BUDGET_PANEL };
