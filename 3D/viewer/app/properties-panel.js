// Módulo "properties-panel" extraído de viewer-authenticated.js (mesma lógica, só reorganizada).
import { RACK_LENGTH_LIMIT_M, viewer } from "../viewer-authenticated.js";
import { quadroFeatureAllowed } from "./access.js";
import { closePropertyPanel, createQuadroSummaryHtml, createRackSummaryHtml, downloadQuadroScheduleAsExcel, downloadRackScheduleAsExcel, generatePanelScheduleForQuadro, generateRackSchedule, getQuadroAnnotations, getQuadroElectricalConfig, isQuadroName, isRackMetaObject } from "./electrical-schedules.js";
import { getCircuitTraceFeature } from "./explorer.js";
import { resolveMetaObject } from "./ifc-meta.js";
import { setupDraggablePanel } from "./panels.js";

export function showMaterialProperties(entity) {
    if (!entity?.id) {
        alert("Nenhuma entidade selecionada.");
        return;
    }
    const metaObject = resolveMetaObject(entity.id);

    if (!metaObject) {
        alert("Não há informações de metadados disponíveis para este objeto.");
        return;
    }

    let propriedades = `<div class="property-panel-meta">`;
    propriedades += `<div><span class="property-label">ID:</span> ${metaObject.id}</div>`;
    propriedades += `<div><span class="property-label">Tipo:</span> ${metaObject.type || "N/A"}</div>`;
    if (metaObject.name) {
        propriedades += `<div><span class="property-label">Nome:</span> ${metaObject.name}</div>`;
    }

    const aabb = viewer.scene.getAABB(entity.id);
    if (aabb) {
        const centerX = ((aabb[0] + aabb[3]) / 0.02).toFixed(3);
        const centerY = ((aabb[1] + aabb[4]) / 0.02).toFixed(3);
        const centerZ = (-(aabb[2] + aabb[5]) / 0.02).toFixed(3);
        propriedades += `
            <div class="property-panel-coordinates">
                <div class="property-label">Coordenadas (centro):</div>
                <div class="property-panel-coordinates-values">X: ${centerX} &nbsp; Y: ${centerZ} &nbsp; Z: ${centerY}</div>
            </div>
        `;
    }
    // --- Cria bloco de ação do quadro logo abaixo das coordenadas ---
    const quadroName = metaObject?.name || "";
    const showGenerateQuadroButton = quadroFeatureAllowed && isQuadroName(quadroName);
    // NOVO: rack de cabeamento estruturado (BD1, FD1, CD1…)
    const showRackButton = quadroFeatureAllowed && !showGenerateQuadroButton && isRackMetaObject(metaObject);
    if (showRackButton) {
        propriedades += `
            <div class="property-panel-actions">
                <button id="generateRackSummaryButton" class="property-panel-generate-button" type="button">
                    Gerar lista de pontos
                </button>
            </div>
            <div id="rackSummaryContainer"></div>
        `;
    }
    if (showGenerateQuadroButton) {
        propriedades += `
            <div class="property-panel-actions">
                <button id="generateQuadroSummaryButton" class="property-panel-generate-button" type="button">
                    Gerar quadro
                </button>
            </div>
            <div id="quadroSummaryContainer"></div>
        `;
    }

    const quadroAnnotations = getQuadroAnnotations(metaObject);
    if (quadroAnnotations.length > 0) {
        propriedades += `
            <div class="property-panel-section property-panel-annotation">
                <div class="property-panel-section-title">Anotação</div>
                ${quadroAnnotations.map((annotation) => `<div class="property-panel-annotation-text">${annotation}</div>`).join("")}
            </div>
        `;
    }

    // --- Varre todos os conjuntos de propriedades IFC ---
    if (metaObject.propertySets && metaObject.propertySets.length > 0) {
        for (const pset of metaObject.propertySets) {
            propriedades += `<div class="property-panel-section">`;
            propriedades += `<div class="property-panel-section-title">${pset.name}</div>`;
            if (pset.properties && pset.properties.length > 0) {
                propriedades += "<table class='property-panel-table'>";
                for (const prop of pset.properties) {
                    const key = prop.name || prop.id;
                    const val = prop.value !== undefined ? prop.value : "(vazio)";
                    propriedades += `<tr><td class="property-panel-key">${key}</td><td class="property-panel-value">${val}</td></tr>`;
                }
                propriedades += "</table>";
            }
            propriedades += `</div>`;
        }
    } else {
        propriedades += `<div class="property-panel-empty">Nenhum conjunto de propriedades encontrado.</div>`;
    }
    propriedades += `</div>`;

    // --- Cria ou atualiza o painel flutuante ---
    let painel = document.getElementById("propertyPanel");
    if (!painel) {
        painel = document.createElement("div");
        painel.id = "propertyPanel";
        painel.classList.add("property-panel");
        document.body.appendChild(painel);
    }

    // 🟢 Adiciona botão X para fechar
    painel.innerHTML = `
        <div class="property-panel-header">
            <div class="property-panel-title">
                <h3>Propriedades IFC</h3>
                <span class="property-panel-subtitle">Metadados do objeto selecionado</span>
            </div>
            <button id="closePropertyPanel"
                class="property-panel-close"
                title="Fechar painel">
                ✖
            </button>
        </div>
        </div>
        <div class="property-panel-body">
            ${propriedades}
        </div>
    `;

    // 🟢 Evento do botão X
    document.getElementById("closePropertyPanel").onclick = closePropertyPanel;

    if (showRackButton) {
        const rackButton = document.getElementById("generateRackSummaryButton");
        const rackContainer = document.getElementById("rackSummaryContainer");
        if (rackButton && rackContainer) {
            rackButton.onclick = () => {
                const result = generateRackSchedule(quadroName, metaObject);

                const render = () => {
                    rackContainer.innerHTML = createRackSummaryHtml(result);
                    rackContainer.querySelectorAll("tr[data-circuit-index]").forEach((rowElement) => {
                        rowElement.addEventListener("click", async () => {
                            const row = result.rows[Number(rowElement.dataset.circuitIndex)];
                            if (!row) return;
                            rackContainer.querySelectorAll("tr.is-traced").forEach((other) => other.classList.remove("is-traced"));
                            rowElement.classList.add("is-traced");
                            const feature = await getCircuitTraceFeature();
                            feature?.trace({ quadro: quadroName, circuito: row.circuito, panelId: entity.id, pointIds: row.pointIds });
                        });
                    });
                    if (!result.rows.length) return;

                    const actions = document.createElement("div");
                    actions.className = "property-panel-actions";
                    const lengthButton = document.createElement("button");
                    lengthButton.type = "button";
                    lengthButton.className = "property-panel-generate-button";
                    lengthButton.textContent = `Calcular comprimentos (${RACK_LENGTH_LIMIT_M} m)`;
                    lengthButton.onclick = async () => {
                        lengthButton.disabled = true;
                        lengthButton.textContent = "Calculando…";
                        try {
                            const feature = await getCircuitTraceFeature();
                            const circuits = Object.fromEntries(result.rows.map((row, index) => [String(index), row.pointIds]));
                            const lengths = await feature?.traceLengths({ quadro: quadroName, panelId: entity.id, circuits });
                            result.rows.forEach((row, index) => {
                                const measured = lengths?.[String(index)];
                                row.comprimento = measured ? measured.length : null;
                                row.semCaminho = Boolean(measured && !measured.reached);
                            });
                            render();
                        } catch (error) {
                            console.error("[rack]", error);
                            lengthButton.textContent = "Não foi possível calcular";
                        }
                    };
                    const downloadButton = document.createElement("button");
                    downloadButton.type = "button";
                    downloadButton.className = "property-panel-generate-button";
                    downloadButton.textContent = "Baixar Excel";
                    downloadButton.onclick = () => downloadRackScheduleAsExcel(result);
                    actions.append(lengthButton, downloadButton);
                    rackContainer.appendChild(actions);
                };
                render();
            };
        }
    }

    if (showGenerateQuadroButton) {
        const generateButton = document.getElementById("generateQuadroSummaryButton");
        const summaryContainer = document.getElementById("quadroSummaryContainer");
        if (generateButton && summaryContainer) {
            generateButton.onclick = () => {
                const electricalConfig = getQuadroElectricalConfig(metaObject);
                const result = generatePanelScheduleForQuadro(quadroName, electricalConfig);
                summaryContainer.innerHTML = createQuadroSummaryHtml(result);

                // NOVO: clicar em um circuito mostra o caminho dele (quadro → infraestrutura → pontos)
                summaryContainer.querySelectorAll("tr[data-circuit-index]").forEach((rowElement) => {
                    rowElement.addEventListener("click", async () => {
                        const row = result.rows[Number(rowElement.dataset.circuitIndex)];
                        if (!row) return;
                        summaryContainer.querySelectorAll("tr.is-traced").forEach((other) => other.classList.remove("is-traced"));
                        rowElement.classList.add("is-traced");
                        const feature = await getCircuitTraceFeature();
                        feature?.trace({ quadro: row.quadro || quadroName, circuito: row.circuito, panelId: entity.id });
                    });
                });

                if (result.rows.length) {
                    const downloadButton = document.createElement("button");
                    downloadButton.type = "button";
                    downloadButton.className = "property-panel-generate-button";
                    downloadButton.textContent = "Baixar Excel";
                    downloadButton.onclick = () => downloadQuadroScheduleAsExcel(result);

                    const actions = document.createElement("div");
                    actions.className = "property-panel-actions";
                    actions.appendChild(downloadButton);
                    summaryContainer.appendChild(actions);
                }
            };
        }
    }

    setupDraggablePanel({
        panel: painel,
        storageKey: `propertyPanelPosition:${window.location.pathname}`,
        ignoreSelectors: "button, a, input, textarea, select, table, td, th",
        handleSelector: ".property-panel-header"
    });
}
