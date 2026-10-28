(function (root) {
  "use strict";
  const URL_GESTAO = "/api/gestao-admin";
  let dados = null;
  const esc = (v) => String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[c]);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function periodo(tipo, agora = new Date()) {
    const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()), inicio = new Date(d), fim = new Date(d);
    if (tipo === "semana-atual" || tipo === "semana-anterior") { inicio.setDate(d.getDate() - ((d.getDay() + 6) % 7) - (tipo === "semana-anterior" ? 7 : 0)); fim.setTime(inicio.getTime()); fim.setDate(inicio.getDate() + 6); }
    if (tipo === "mes-atual" || tipo === "mes-anterior") { inicio.setMonth(d.getMonth() - (tipo === "mes-anterior" ? 1 : 0), 1); fim.setFullYear(inicio.getFullYear(), inicio.getMonth() + 1, 0); }
    return { inicio: iso(inicio), fim: iso(fim) };
  }
  function formatarPercentual(v) { return v === null || v === undefined ? "N/A" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`; }
  function formatarHoras(v) { return `${Number(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h`; }
  function ultima(o) { if (!o.ultimaMovimentacao) return "Nunca"; return o.diasSemMovimentacao === 0 ? "Hoje" : o.diasSemMovimentacao === 1 ? "Há 1 dia" : `Há ${o.diasSemMovimentacao} dias`; }
  function abrirHref(o, secao) { return `/admin/?obra=${encodeURIComponent(o.id)}&secao=${secao}`; }
  function metricas(resumo) { return [[resumo.obrasAtivas, "Obras ativas"], [resumo.projetosMovimentados, "Projetos movimentados"], [resumo.obrasSemMovimentacao, "Sem movimentação"], [resumo.fichasPendentes, "Fichas pendentes"], [resumo.projetosNaoSincronizados, "Projetos não sincronizados"], [resumo.benchmarkPendente, "Benchmark pendente"], [formatarHoras(resumo.horasRegistradas), "Horas registradas"], [formatarPercentual(resumo.coberturaPlannerMedia), "Cobertura Planner"]].map(([v, r]) => `<article class="admin-gestao-metric"><strong>${esc(v)}</strong><span>${r}</span></article>`).join(""); }
  function renderizar() {
    const filtro = document.getElementById("gestaoObra").value, obras = dados.obras.filter((o) => !filtro || o.id === filtro), ids = new Set(obras.map((o) => o.id));
    const atencao = dados.atencao.filter((a) => ids.has(a.obraId));
    const resumo = filtro ? { obrasAtivas: obras.filter((o) => o.ativo).length, projetosMovimentados: obras.reduce((s, o) => s + o.projetosMovimentados, 0), obrasSemMovimentacao: obras.filter((o) => o.diasSemMovimentacao >= 7).length, fichasPendentes: obras.filter((o) => o.pendenciasFicha.length).length, projetosNaoSincronizados: obras.reduce((s, o) => s + o.projetosPendentes.length, 0), benchmarkPendente: obras.filter((o) => o.benchmarkPendente).length, horasRegistradas: obras.reduce((s, o) => s + o.horasRegistradas, 0), coberturaPlannerMedia: obras[0]?.coberturaPlanner ?? null } : dados.resumo;
    const frase = `${resumo.obrasAtivas} obra(s) ativa(s). ${resumo.obrasSemMovimentacao} sem movimentação há pelo menos 7 dias, ${resumo.fichasPendentes} com Ficha Técnica pendente e ${resumo.projetosNaoSincronizados} projeto(s) detectado(s) ainda não sincronizado(s).`;
    const alertas = atencao.length ? atencao.map((a) => `<article class="admin-gestao-alert"><div><span class="admin-badge warning">${esc(a.tipo.replaceAll("_", " "))}</span><h4>${esc(a.obra)}</h4><p>${esc(a.mensagem)}</p>${a.detalhe ? `<small>Faltam: ${esc(a.detalhe)}</small>` : ""}</div><a class="admin-row-action" href="${esc(a.href)}">${esc(a.acao)} <i class="fa-solid fa-arrow-right"></i></a></article>`).join("") : '<p class="admin-empty">Nenhuma pendência administrativa relevante foi identificada para os filtros selecionados.</p>';
    const qualidade = [["Fase classificada", dados.qualidade.fase], ["Item classificado", dados.qualidade.item], ["Planner estruturado", dados.qualidade.planner], ["Intervalos válidos", dados.qualidade.intervalosValidos], ["Fichas caracterizadas", dados.qualidade.fichasCaracterizadas], ["Benchmark avaliado", dados.qualidade.benchmarkAvaliado]];
    const pendencias = obras.filter((o) => o.pendenciasFicha.length).map((o) => `<tr><td><strong>${esc(o.nome)}</strong></td><td>${o.completude}%</td><td>${esc(o.pendenciasFicha.map((p) => p.label).join(", "))}</td><td><a href="${abrirHref(o, "identificacao")}" class="admin-row-action">Completar ficha</a></td></tr>`).join("");
    const linhas = obras.map((o) => `<tr><td><span class="admin-work-code">${esc(o.codigo)}</span><strong>${esc(o.nome)}</strong></td><td>${o.completude}%</td><td><span class="admin-badge ${o.classificacaoCobertura}">${formatarPercentual(o.coberturaPlanner)}</span></td><td>${o.projetosCadastrados} <small>${o.projetosPendentes.length ? `· ${o.projetosPendentes.length} pendente(s)` : ""}</small></td><td>${ultima(o)}</td><td>${esc(o.benchmarkStatus === "nao_avaliado" ? "Não avaliado" : o.benchmarkStatus === "incluir" ? "Incluir" : "Excluir")}</td><td><a class="admin-row-action" href="${abrirHref(o, "identificacao")}">Abrir</a></td></tr>`).join("");
    document.getElementById("gestaoConteudo").innerHTML = `<div class="admin-gestao-metrics">${metricas(resumo)}</div><p class="admin-gestao-summary">${esc(frase)}</p><section class="admin-gestao-attention"><h3>Requer atenção</h3><div>${alertas}</div></section><section class="admin-gestao-quality"><h3>Qualidade dos dados</h3><p class="admin-helper">Coberturas de Fase e Item são ponderadas pelas horas válidas registradas; não representam produtividade.</p><div>${qualidade.map(([r, v]) => `<article><span>${r}</span><strong>${formatarPercentual(v)}</strong><div class="admin-gestao-progress"><i style="width:${v || 0}%"></i></div></article>`).join("")}</div></section><section class="admin-gestao-enrichment"><h3>Pendências de cadastro</h3>${pendencias ? `<div class="admin-responsive-table"><table><thead><tr><th>Obra</th><th>Completude</th><th>Falta</th><th>Ação</th></tr></thead><tbody>${pendencias}</tbody></table></div>` : '<p class="admin-empty">Nenhuma pendência de cadastro.</p>'}</section><section class="admin-gestao-works"><h3>Obras em acompanhamento</h3><div class="admin-responsive-table"><table><thead><tr><th>Obra</th><th>Ficha</th><th>Planner</th><th>Projetos</th><th>Última movimentação</th><th>Benchmark</th><th>Ação</th></tr></thead><tbody>${linhas}</tbody></table></div></section>`;
  }
  async function carregar() {
    const tipo = document.getElementById("gestaoPeriodo").value, personalizado = tipo === "personalizado";
    document.querySelectorAll(".gestao-personalizado").forEach((x) => { x.hidden = !personalizado; });
    const p = personalizado ? { inicio: document.getElementById("gestaoInicio").value, fim: document.getElementById("gestaoFim").value } : periodo(tipo);
    if (!p.inicio || !p.fim) return;
    document.getElementById("gestaoConteudo").innerHTML = '<p class="admin-empty">Carregando indicadores...</p>';
    const response = await fetch(`${URL_GESTAO}?inicio=${p.inicio}&fim=${p.fim}`), json = await response.json(); if (!response.ok) throw new Error(json.error || "Não foi possível carregar a Gestão.");
    dados = json; root.GESTAO_ADMIN_DADOS = json;
    const select = document.getElementById("gestaoObra"), atual = select.value; select.innerHTML = '<option value="">Todas</option>' + json.obras.map((o) => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join(""); select.value = atual;
    renderizar();
  }
  function inicializar() { ["gestaoPeriodo", "gestaoInicio", "gestaoFim"].forEach((id) => document.getElementById(id)?.addEventListener("change", () => carregar().catch(exibirErro))); document.getElementById("gestaoObra")?.addEventListener("change", renderizar); }
  function exibirErro(e) { document.getElementById("gestaoConteudo").innerHTML = `<p class="admin-message error">${esc(e.message)}</p>`; }
  root.GESTAO_ADMIN = { carregar, inicializar, periodo, renderizar };
})(globalThis);