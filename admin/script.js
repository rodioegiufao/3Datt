const AUTH_URL = "/api/auth";
const USUARIOS_URL = "/api/usuarios";
const OBRAS_ADMIN_URL = "/api/obras-admin";
const OBRAS_URL = "/api/obras";
const PLANNER_URL = "/api/planner-checklist";
let obrasAdmin = [];
let obraAberta = null;
let usuariosAdmin = [];
let ultimoFocoModal = null;
let observadorSecoes = null;
let visaoRapidaObras = "todas";

function getProfileLabel(profile) {
  if (profile === "admin") return "Administrador";
  if (profile === "cliente") return "Cliente";
  return "Colaborador";
}
const adminPanel = document.getElementById("adminPanel");
const accessDeniedPanel = document.getElementById("accessDeniedPanel");
const cadastroForm = document.getElementById("cadastroForm");
const usuariosLista = document.getElementById("usuariosLista");
const btnLogout = document.getElementById("btnLogout");
const btnPerfil = document.getElementById("btnPerfil");
const userMenu = document.getElementById("userMenu");
const userMenuTrigger = document.getElementById("userMenuTrigger");
const userMenuPanel = document.getElementById("userMenuPanel");
const usuarioIniciais = document.getElementById("usuarioIniciais");
const usuarioIniciaisMenu = document.getElementById("usuarioIniciaisMenu");
const usuarioLogado = document.getElementById("usuarioLogado");
const usuarioPerfil = document.getElementById("usuarioPerfil");
const adminLink = document.getElementById("adminLink");
const passwordModal = document.getElementById("passwordModal");
const passwordForm = document.getElementById("passwordForm");

inicializarAdmin();

async function inicializarAdmin() {
  cadastroForm.addEventListener("submit", cadastrarUsuario);
  document.getElementById("novoUsuario").addEventListener("click", () => abrirModal("cadastroModal", "cadastroNome"));
  document.getElementById("usuariosBusca").addEventListener("input", renderizarUsuarios);
  document.getElementById("usuariosPerfil").addEventListener("change", renderizarUsuarios);
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => fecharModal(button.dataset.closeModal)));
  document.querySelectorAll(".admin-modal").forEach((modal) => modal.addEventListener("click", (event) => { if (event.target === modal) fecharModal(modal.id); }));
  btnLogout.addEventListener("click", sair);
  btnPerfil?.addEventListener("click", abrirPerfil);
  userMenuTrigger.addEventListener("click", alternarMenuUsuario);
  usuariosLista.addEventListener("click", tratarAcaoUsuario);
  passwordForm.addEventListener("submit", salvarNovaSenha);
  document.getElementById("passwordModalClose").addEventListener("click", fecharModalSenha);
  document.getElementById("passwordCancel").addEventListener("click", fecharModalSenha);
  passwordModal.addEventListener("click", (event) => { if (event.target === passwordModal) fecharModalSenha(); });
  document.addEventListener("click", fecharMenuUsuarioAoClicarFora);
  document.addEventListener("keydown", fecharMenuUsuarioComTeclado);
  initThemeSelector();
  inicializarModuloObras();
  globalThis.GESTAO_ADMIN?.inicializar();
  await verificarAcessoAdmin();
}

async function verificarAcessoAdmin() {
  try {
    const data = await fetch(AUTH_URL).then(validarResposta);
    const user = data.user;
    if (user?.perfil === "cliente") {
      window.location.replace("/3D/?acesso=negado");
      return;
    }
    const adminLogado = user?.perfil === "admin";

    aplicarUsuarioNoMenu(user);
    adminPanel.hidden = !adminLogado;
    accessDeniedPanel.hidden = adminLogado;

    if (adminLogado) { await carregarUsuarios(); const params = new URLSearchParams(location.search); if (params.get("obra")) ativarAba("obras"); else if (params.get("tab") === "gestao") ativarAba("gestao"); }
  } catch (_erro) {
    aplicarUsuarioNoMenu(null);
    adminPanel.hidden = true;
    accessDeniedPanel.hidden = false;
  }
}

function aplicarUsuarioNoMenu(user) {
  const adminLogado = user?.perfil === "admin";
  userMenu.hidden = !user;
  adminLink.hidden = !adminLogado;
  usuarioLogado.textContent = user?.nome || "";
  usuarioPerfil.textContent = user?.perfil || "";
  const iniciais = obterIniciais(user?.nome);
  usuarioIniciais.textContent = iniciais;
  usuarioIniciaisMenu.textContent = iniciais;
  if (!user) fecharMenuUsuario();
}

function obterIniciais(nome) {
  const partes = String(nome || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!partes.length) return "?";

  const primeira = partes[0][0] || "";
  const ultima = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] || "");
  return `${primeira}${ultima}`.toUpperCase();
}

function alternarMenuUsuario(event) {
  event.stopPropagation();
  const abrir = userMenuPanel.hidden;
  userMenuPanel.hidden = !abrir;
  userMenuTrigger.setAttribute("aria-expanded", String(abrir));
}

function fecharMenuUsuario() {
  userMenuPanel.hidden = true;
  userMenuTrigger.setAttribute("aria-expanded", "false");
}

function fecharMenuUsuarioAoClicarFora(event) {
  if (userMenu.hidden || userMenu.contains(event.target)) return;
  fecharMenuUsuario();
}

function fecharMenuUsuarioComTeclado(event) {
  if (event.key === "Escape") {
    fecharMenuUsuario();
    fecharModalPerfil();
    fecharModalSenha();
    ["cadastroModal", "obraModal", "confirmarObraModal"].forEach(fecharModal);
  }
}


function garantirModalPerfil() {
  let modal = document.getElementById("profileModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "profileModal";
  modal.className = "profile-modal";
  modal.hidden = true;
  modal.innerHTML = `
    <div class="profile-modal-card" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle">
      <button type="button" class="profile-modal-close" id="profileModalClose" aria-label="Fechar perfil">×</button>
      <h2 id="profileModalTitle">Perfil</h2>
      <p class="profile-modal-help">Atualize seu nome, login ou senha. Deixe a nova senha em branco se não quiser alterá-la.</p>
      <form id="profileForm" class="profile-form">
        <label>Nome<input type="text" id="profileNome" required></label>
        <label>Login<input type="text" id="profileUsuario" autocomplete="username" required></label>
        <label>Senha atual <small>(necessária para trocar a senha)</small><span class="profile-password-field"><input type="password" id="profileSenhaAtual" autocomplete="current-password"><button type="button" class="profile-password-toggle" data-target="profileSenhaAtual" aria-label="Mostrar senha atual" aria-pressed="false">👁</button></span></label>
        <label>Nova senha<span class="profile-password-field"><input type="password" id="profileNovaSenha" autocomplete="new-password" minlength="6"><button type="button" class="profile-password-toggle" data-target="profileNovaSenha" aria-label="Mostrar nova senha" aria-pressed="false">👁</button></span></label>
        <div class="profile-modal-actions">
          <button type="button" id="profileCancel">Cancelar</button>
          <button type="submit">Salvar perfil</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener("click", (event) => { if (event.target === modal) fecharModalPerfil(); });
  document.getElementById("profileModalClose")?.addEventListener("click", fecharModalPerfil);
  document.getElementById("profileCancel")?.addEventListener("click", fecharModalPerfil);
  document.getElementById("profileForm")?.addEventListener("submit", salvarPerfil);
  modal.querySelectorAll(".profile-password-toggle").forEach((button) => {
    button.addEventListener("click", alternarVisibilidadeSenhaPerfil);
  });
  return modal;
}
function obterIconeSenhaPerfil(estaVisivel) {
  return estaVisivel
    ? `<svg class="profile-password-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5c5.05 0 8.63 4.06 10 7-1.37 2.94-4.95 7-10 7S3.37 14.94 2 12c1.37-2.94 4.95-7 10-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><circle cx="12" cy="12" r="2.15"/></svg>`
    : `<svg class="profile-password-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m3.28 2 18.72 18.72-1.28 1.28-3.3-3.3A10.7 10.7 0 0 1 12 20C6.95 20 3.37 15.94 2 13c.7-1.49 2.01-3.28 3.8-4.71L2 4.49 3.28 2Zm6.22 9.43a3 3 0 0 0 3.91 3.91L9.5 11.43Zm2.5-6.43c5.05 0 8.63 4.06 10 7a13.53 13.53 0 0 1-3.1 4.17l-2.84-2.84A4 4 0 0 0 10.67 7.94L8.85 6.12A10.1 10.1 0 0 1 12 5Z"/></svg>`;
}

function atualizarBotaoSenhaPerfil(button, estaVisivel) {
  button.setAttribute("aria-pressed", String(estaVisivel));
  button.setAttribute("aria-label", `${estaVisivel ? "Ocultar" : "Mostrar"} ${button.dataset.target === "profileSenhaAtual" ? "senha atual" : "nova senha"}`);
  button.innerHTML = obterIconeSenhaPerfil(estaVisivel);
}
function alternarVisibilidadeSenhaPerfil(event) {
  const button = event.currentTarget;
  const input = document.getElementById(button.dataset.target);
  if (!input) return;
  const mostrarSenha = input.type === "password";
  input.type = mostrarSenha ? "text" : "password";
  atualizarBotaoSenhaPerfil(button, false);
}

function redefinirVisibilidadeSenhasPerfil() {
  document.querySelectorAll("#profileSenhaAtual, #profileNovaSenha").forEach((input) => { input.type = "password"; });
  document.querySelectorAll(".profile-password-toggle").forEach((button) => {
    atualizarBotaoSenhaPerfil(button, false);
  });
}
async function abrirPerfil() {
  const data = await fetch(AUTH_URL).then(validarResposta);
  const modal = garantirModalPerfil();
  document.getElementById("profileNome").value = data.user?.nome || "";
  document.getElementById("profileUsuario").value = data.user?.usuario || "";
  document.getElementById("profileSenhaAtual").value = "";
  document.getElementById("profileNovaSenha").value = "";
  redefinirVisibilidadeSenhasPerfil();
  fecharMenuUsuario();
  modal.hidden = false;
  document.getElementById("profileNome")?.focus();
}

function fecharModalPerfil() {
  const modal = document.getElementById("profileModal");
  if (modal) modal.hidden = true;
}

async function salvarPerfil(event) {
  event.preventDefault();
  try {
    const data = await fetch(AUTH_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: document.getElementById("profileNome").value,
        usuario: document.getElementById("profileUsuario").value,
        senhaAtual: document.getElementById("profileSenhaAtual").value,
        novaSenha: document.getElementById("profileNovaSenha").value
      })
    }).then(validarResposta);
    aplicarUsuarioNoMenu(data.user);
    fecharModalPerfil();
    mostrarToast("Perfil atualizado com sucesso.");
  } catch (erro) {
    mostrarToast(`Não foi possível atualizar o perfil: ${erro.message}`, true);
  }
}

async function cadastrarUsuario(event) {
  event.preventDefault();
  try {
    const data = await fetch(USUARIOS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: document.getElementById("cadastroNome").value,
        usuario: document.getElementById("cadastroUsuario").value,
        senha: document.getElementById("cadastroSenha").value,
        perfil: document.getElementById("cadastroPerfil").value
      })
    }).then(validarResposta);

    cadastroForm.reset();
    fecharModal("cadastroModal");
    mostrarToast(`Usuário ${data.nome} cadastrado com sucesso.`);
    await carregarUsuarios();
  } catch (erro) {
    mostrarToast(`Não foi possível cadastrar: ${erro.message}`, true);
  }
}

async function carregarUsuarios() {
  try {
    usuariosAdmin = await fetch(USUARIOS_URL).then(validarResposta);
    document.getElementById("usuariosTabCount").textContent = usuariosAdmin.length;
    renderizarUsuarios();
  } catch (erro) {
    usuariosLista.innerHTML = `<p class="admin-empty">${escapeHtml(erro.message)}</p>`;
  }
}
function renderizarUsuarios() {
  const busca = document.getElementById("usuariosBusca").value.trim().toLowerCase();
  const perfil = document.getElementById("usuariosPerfil").value;
  const lista = usuariosAdmin.filter((user) => (!busca || `${user.nome} ${user.usuario}`.toLowerCase().includes(busca)) && (!perfil || user.perfil === perfil));
  const ativos = usuariosAdmin.filter((user) => user.ativo).length;
  const admins = usuariosAdmin.filter((user) => user.perfil === "admin").length;
  document.getElementById("usuariosMetricas").innerHTML = [[usuariosAdmin.length, "Usuários", ""], [ativos, "Ativos", "success"], [admins, "Administradores", "blue"]].map(([numero, rotulo, classe]) => `<article class="admin-metric-card ${classe}"><strong>${numero}</strong><span>${rotulo}</span></article>`).join("");
  if (!lista.length) { usuariosLista.innerHTML = '<p class="admin-empty">Nenhum usuário encontrado.</p>'; return; }
  usuariosLista.innerHTML = `<table><thead><tr><th>Usuário</th><th>Perfil</th><th>Status</th><th>Ações</th></tr></thead><tbody>${lista.map((user) => `<tr><td><div class="admin-user-identity"><span class="admin-user-avatar">${obterIniciais(user.nome)}</span><span><strong>${escapeHtml(user.nome)}</strong><small>${escapeHtml(user.usuario)}</small></span></div></td><td><span class="admin-badge ${escapeHtml(user.perfil)}">${getProfileLabel(user.perfil)}</span></td><td><span class="admin-badge admin-status-dot ${user.ativo ? "success" : "danger"}">${user.ativo ? "Ativo" : "Inativo"}</span></td><td><button type="button" class="admin-row-action user-password-button" data-user-id="${escapeHtml(user.id)}" data-user-name="${escapeHtml(user.nome)}"><i class="fa-solid fa-key"></i> Alterar senha</button></td></tr>`).join("")}</tbody></table>`;
}
function tratarAcaoUsuario(event) {
  const button = event.target.closest(".user-password-button");
  if (!button) return;

  ultimoFocoModal = button;
  passwordForm.reset();
  document.getElementById("passwordUserId").value = button.dataset.userId;
  document.getElementById("passwordUserName").textContent = button.dataset.userName;
  passwordModal.hidden = false;
  document.getElementById("passwordNew").focus();
}

function fecharModalSenha() {
  const estavaAberto = !passwordModal.hidden;
  passwordModal.hidden = true;
  passwordForm.reset();
  if (estavaAberto) ultimoFocoModal?.focus?.();
}

async function salvarNovaSenha(event) {
  event.preventDefault();
  const senha = document.getElementById("passwordNew").value;
  const confirmacao = document.getElementById("passwordConfirm").value;

  if (senha !== confirmacao) {
    mostrarToast("As senhas informadas não coincidem.", true);
    return;
  }

  try {
    const data = await fetch(USUARIOS_URL, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: document.getElementById("passwordUserId").value,
        senha
      })
    }).then(validarResposta);

    fecharModalSenha();
    mostrarToast(`Senha de ${data.nome} alterada com sucesso.`);
  } catch (erro) {
    mostrarToast(`Não foi possível alterar a senha: ${erro.message}`, true);
  }
}
function abrirModal(id, focoId) {
  const modal = document.getElementById(id);
  ultimoFocoModal = document.activeElement;
  modal.hidden = false;
  requestAnimationFrame(() => document.getElementById(focoId)?.focus());
}
function fecharModal(id) {
  const modal = document.getElementById(id);
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  ultimoFocoModal?.focus?.();
}
function mostrarToast(mensagem, erro = false) {
  const toast = document.createElement("div");
  toast.className = `admin-toast ${erro ? "error" : ""}`;
  toast.textContent = `${erro ? "⚠" : "✓"} ${mensagem}`;
  document.getElementById("adminToasts").appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}
async function sair() {
  await fetch(AUTH_URL, { method: "DELETE" }).catch(() => null);
  window.location.href = "/atividades/";
}

async function validarResposta(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || "Erro inesperado na comunicação com o servidor.");
  }
  return data;
}

function escapeHtml(valor) {
  return String(valor || "").replace(/[&<>'"]/g, (caractere) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[caractere]);
}

function initThemeSelector() {
  const themeToggle = document.getElementById("theme-toggle");
  if (!themeToggle) return;

  const html = document.documentElement;
  const savedTheme = localStorage.getItem("theme") || "dark";
  html.setAttribute("data-theme", savedTheme);
  themeToggle.checked = savedTheme === "light";

  themeToggle.addEventListener("change", function () {
    const theme = this.checked ? "light" : "dark";
    html.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  });
}
const TIPOLOGIAS_SEGMENTO = {
  "Saúde": ["Hospital", "Clínica", "UBS", "UPA", "Laboratório", "Centro de Diagnóstico", "Hemocentro", "Outro"], "Educação": ["Creche", "Escola", "Universidade", "Centro de Formação", "Campus", "Outro"],
  "Institucional": ["Administrativo", "Tribunal", "Fórum", "Órgão Público", "Prefeitura", "Câmara", "Outro"], "Penitenciário": ["Penitenciária", "Cadeia Pública", "Centro de Detenção", "Bloco Prisional", "Outro"],
  "Comercial": ["Loja", "Shopping", "Supermercado", "Restaurante", "Posto de Combustível", "Escritório", "Outro"], "Industrial": ["Indústria", "Fábrica", "Oficina", "Galpão Industrial", "Outro"],
  "Residencial": ["Residência", "Edifício Residencial", "Condomínio", "Outro"], "Hotelaria": ["Hotel", "Pousada", "Resort", "Outro"], "Cultural": ["Teatro", "Auditório", "Museu", "Biblioteca", "Centro Cultural", "Outro"],
  "Esportivo": ["Ginásio", "Estádio", "Quadra", "Centro Esportivo", "Outro"], "Laboratorial": ["Laboratório de Pesquisa", "Laboratório Clínico", "Biotério", "Planta Piloto", "Outro"], "Infraestrutura": ["Subestação", "Rede Externa", "Urbanização", "Via", "Loteamento", "Outro"], "Outro": ["Outro"]
};
const INTERVENCOES_ADMIN = ["Obra nova", "Reforma", "Ampliação", "Retrofit", "Adequação", "Regularização", "As built", "Outro"];
const rotuloStatus = { cadastro_minimo: "Cadastro mínimo", parcial: "Parcial", caracterizada: "Caracterizada", nao_aplicavel: "Não aplicável" };
const rotuloCategoria = { empreendimento: "Empreendimento físico", interno: "Atividade interna", estudo: "Estudo / oportunidade", outro: "Outro" };
const statusClasse = { cadastro_minimo: "neutral", parcial: "warning", caracterizada: "success", nao_aplicavel: "neutral" };

function inicializarModuloObras() {
  document.querySelectorAll("[data-admin-tab]").forEach((button) => button.addEventListener("click", () => ativarAba(button.dataset.adminTab)));
  ["obrasBusca", "obrasFiltroFicha", "obrasFiltroCategoria", "obrasFiltroNatureza", "obrasFiltroBenchmark", "obrasFiltroAtivo", "obrasOrdenacao"].forEach((id) => document.getElementById(id)?.addEventListener("input", renderizarObras));
  document.getElementById("novaObra")?.addEventListener("click", () => abrirModal("obraModal", "novaObraNome"));
  document.getElementById("obraForm")?.addEventListener("submit", criarObraAdmin);
  document.getElementById("confirmarAlternarObra")?.addEventListener("click", alternarObra);
  document.getElementById("limparFiltros")?.addEventListener("click", limparFiltrosObras);
  document.getElementById("obrasTabela")?.addEventListener("click", (event) => { const id = event.target.closest("[data-obra-id]")?.dataset.obraId; if (id) abrirFicha(id); });
  document.getElementById("obrasVisoesRapidas")?.addEventListener("click", (event) => { const botao = event.target.closest("[data-visao]"); if (!botao) return; visaoRapidaObras = botao.dataset.visao; event.currentTarget.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === botao)); renderizarObras(); });
}
async function ativarAba(aba) {
  document.querySelectorAll("[data-admin-tab]").forEach((item) => { const ativa = item.dataset.adminTab === aba; item.classList.toggle("active", ativa); item.setAttribute("aria-selected", String(ativa)); });
  document.getElementById("adminUsuarios").hidden = aba !== "usuarios";
  document.getElementById("adminObras").hidden = aba !== "obras";
  document.getElementById("adminGestao").hidden = aba !== "gestao";
  if (aba === "obras" && !obrasAdmin.length) await carregarObras();
  if (aba === "gestao") { history.replaceState(null, "", "?tab=gestao"); await globalThis.GESTAO_ADMIN?.carregar(); }
}
async function carregarObras() {
  document.getElementById("obrasTabela").innerHTML = '<p class="admin-empty">Carregando obras...</p>';
  try {
    obrasAdmin = await fetch(OBRAS_ADMIN_URL).then(validarResposta);
    document.getElementById("obrasTabCount").textContent = obrasAdmin.length;
    renderizarIndicadores(); renderizarObras();
    const direta = new URLSearchParams(location.search).get("obra");
    if (direta && (!obraAberta || obraAberta.id !== direta)) await abrirFicha(direta);
  } catch (erro) { document.getElementById("obrasTabela").innerHTML = `<p class="admin-message error">${escapeHtml(erro.message)}</p>`; }
}
function renderizarIndicadores() {
  const contagem = (status) => obrasAdmin.filter((obra) => obra.statusFicha === status).length;
  const dados = [[obrasAdmin.length, "Total", ""], [contagem("cadastro_minimo"), "Cadastro mínimo", "neutral"], [contagem("parcial"), "Parciais", "warning"], [contagem("caracterizada"), "Caracterizadas", "success"], [contagem("nao_aplicavel"), "Não aplicáveis", "neutral"], [obrasAdmin.filter((o) => o.caracteristica?.benchmark_status === "incluir").length, "Benchmark", "blue"]];
  document.getElementById("obrasIndicadores").innerHTML = dados.map(([n, r, classe]) => `<article class="admin-metric-card ${classe}"><strong>${n}</strong><span>${r}</span></article>`).join("");
}
function badge(texto, classe = "") { return `<span class="admin-badge ${classe}">${escapeHtml(texto)}</span>`; }
function renderizarObras() {
  const busca = valor("obrasBusca").trim().toLowerCase(), ficha = valor("obrasFiltroFicha"), categoria = valor("obrasFiltroCategoria"), natureza = valor("obrasFiltroNatureza"), benchmark = valor("obrasFiltroBenchmark"), ativo = valor("obrasFiltroAtivo");
  const gestao = new Map((globalThis.GESTAO_ADMIN_DADOS?.obras || []).map((o) => [o.id, o]));
  const atendeVisao = (o) => { const g=gestao.get(o.id)||{}; if(visaoRapidaObras==="todas")return true;if(visaoRapidaObras==="sem-movimentacao")return g.diasSemMovimentacao>=7;if(visaoRapidaObras==="ficha")return o.pendenciasFicha?.length;if(visaoRapidaObras==="benchmark")return (o.caracteristica?.benchmark_status||"nao_avaliado")==="nao_avaliado";if(visaoRapidaObras==="projetos")return o.projetosDetectados?.length;if(visaoRapidaObras==="atencao")return (globalThis.GESTAO_ADMIN_DADOS?.atencao||[]).some((a)=>a.obraId===o.id);return true; };
  const lista = obrasAdmin.filter((o) => (!busca || `${o.codigo} ${o.nome}`.toLowerCase().includes(busca)) && (!ficha || o.statusFicha === ficha) && (!categoria || o.caracteristica?.categoria_registro === categoria) && (!natureza || o.caracteristica?.natureza === natureza) && (!benchmark || (o.caracteristica?.benchmark_status || "nao_avaliado") === benchmark) && (ativo === "" || String(o.ativo) === ativo) && atendeVisao(o));
  const ordem=valor("obrasOrdenacao"), numero=(o,c)=>Number(gestao.get(o.id)?.[c]??0); lista.sort((a,b)=>ordem==="codigo"?a.codigo.localeCompare(b.codigo):ordem==="ultima"?String(gestao.get(b.id)?.ultimaMovimentacao||"").localeCompare(String(gestao.get(a.id)?.ultimaMovimentacao||"")):ordem==="completude-asc"?a.completude-b.completude:ordem==="completude-desc"?b.completude-a.completude:ordem==="benchmark"?Number((b.caracteristica?.benchmark_status||"nao_avaliado")==="nao_avaliado")-Number((a.caracteristica?.benchmark_status||"nao_avaliado")==="nao_avaliado"):ordem==="projetos"?numero(b,"projetosCadastrados")-numero(a,"projetosCadastrados"):a.nome.localeCompare(b.nome));
  if (!lista.length) { document.getElementById("obrasTabela").innerHTML = '<p class="admin-empty">Nenhuma obra encontrada.</p>'; return; }
  const benchmarkTexto = { nao_avaliado: "Não avaliado", incluir: "Incluído", excluir: "Excluído" };
  document.getElementById("obrasTabela").innerHTML = `<table><thead><tr><th>Obra</th><th>Caracterização</th><th>Planner</th><th>Última movimentação</th><th>Benchmark</th><th>Projetos</th><th>Ação</th></tr></thead><tbody>${lista.map((o) => {const g=gestao.get(o.id);return `<tr><td><span class="admin-work-code">${escapeHtml(o.codigo)}</span><strong class="admin-work-name">${escapeHtml(o.nome)}</strong></td><td>${badge(`Ficha ${o.completude}%`, statusClasse[o.statusFicha])}<small>${o.pendenciasFicha?.length||0} pendência(s)</small></td><td>${badge(g?.coberturaPlanner==null?"N/A":`${g.coberturaPlanner}%`,g?.classificacaoCobertura||"")}</td><td>${g? (g.ultimaMovimentacao ? (g.diasSemMovimentacao===0?"Hoje":`Há ${g.diasSemMovimentacao} dias`):"Nunca") : "Abra Gestão"}</td><td>${badge(benchmarkTexto[o.caracteristica?.benchmark_status || "nao_avaliado"], o.caracteristica?.benchmark_status === "incluir" ? "blue" : "")}</td><td>${badge(`${o.quantidadeProjetos || 0} projetos`)}</td><td><button class="admin-row-action" data-obra-id="${o.id}">${o.statusFicha === "cadastro_minimo" ? "Caracterizar" : "Abrir ficha"} <i class="fa-solid fa-arrow-right"></i></button></td></tr>`;}).join("")}</tbody></table>`;
}
function limparFiltrosObras() { ["obrasBusca", "obrasFiltroFicha", "obrasFiltroCategoria", "obrasFiltroNatureza", "obrasFiltroBenchmark"].forEach((id) => { document.getElementById(id).value = ""; }); document.getElementById("obrasFiltroAtivo").value = "true"; renderizarObras(); }
async function criarObraAdmin(event) {
  event.preventDefault(); const nome = valor("novaObraNome").trim(); if (!nome) return;
  const botao = event.submitter; botao.disabled = true; botao.textContent = "Criando...";
  try { const obra = await fetch(OBRAS_ADMIN_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "criar", nome }) }).then(validarResposta); fecharModal("obraModal"); event.target.reset(); await carregarObras(); await abrirFicha(obra.id); mostrarToast("Obra criada com sucesso."); }
  catch (erro) { mostrarToast(erro.message, true); } finally { botao.disabled = false; botao.textContent = "Criar obra"; }
}
async function abrirFicha(id) {
  try { obraAberta = await fetch(`${OBRAS_ADMIN_URL}?id=${encodeURIComponent(id)}`).then(validarResposta); const secao=new URLSearchParams(location.search).get("secao"); history.replaceState(null, "", `?obra=${encodeURIComponent(id)}${secao?`&secao=${encodeURIComponent(secao)}`:""}`); renderizarFicha(); if(secao) requestAnimationFrame(()=>document.getElementById(`sec-${secao}`)?.scrollIntoView({block:"start"})); }
  catch (erro) { mostrarToast(erro.message, true); }
}
function opcoes(valores, atual = "") { return `<option value="">Selecione</option>${valores.map((v) => `<option ${v === atual ? "selected" : ""}>${escapeHtml(v)}</option>`).join("")}`; }
function cabecalhoSecao(numero, titulo, descricao, icone, acao = "") { return `<div class="admin-section-title"><div><h3><i class="fa-solid ${icone}"></i> ${numero}. ${titulo}</h3><p>${descricao}</p></div>${acao}</div>`; }
function renderizarCabecalhoFicha(o) { const g=(globalThis.GESTAO_ADMIN_DADOS?.obras||[]).find((x)=>x.id===o.id); const faltas=o.pendenciasFicha||[]; return `<header class="admin-obra-header"><div class="admin-obra-title"><button type="button" id="voltarObras" class="admin-back"><i class="fa-solid fa-arrow-left"></i> Obras</button><span class="admin-work-code">${escapeHtml(o.codigo)}</span><h2>${escapeHtml(o.nome)}</h2>${badge(rotuloStatus[o.statusFicha], statusClasse[o.statusFicha])}</div><div class="admin-obra-progress"><div class="admin-obra-progress-label"><span>Ficha técnica</span><strong>${o.completude}%</strong></div><div class="admin-obra-progress-track"><div class="admin-obra-progress-bar" style="width:${Math.max(0, Math.min(100, o.completude))}%"></div></div><small>${faltas.length?`Faltam ${faltas.length}: ${escapeHtml(faltas.map((p)=>p.label).join(", "))}`:"Ficha caracterizada"}</small>${g?`<div class="admin-planner-coverage"><span>Cobertura do Planner</span><strong>${g.coberturaPlanner==null?"N/A":`${g.coberturaPlanner}%`}</strong><small>${g.horasPlanner} h de ${g.horasRegistradas} h estruturadas</small></div>`:""}<span id="saveState" class="admin-save-state">Tudo salvo</span></div><div class="admin-obra-actions"><button type="button" id="alternarObra" class="admin-danger">${o.ativo ? "Desativar obra" : "Reativar obra"}</button><button class="primary" id="salvarFicha"><i class="fa-solid fa-floppy-disk"></i> Salvar alterações</button></div></header><div id="obraMensagem"></div>`; }
function renderizarIdentificacao(o) { return `<section id="sec-identificacao" class="admin-obra-section">${cabecalhoSecao(1,"Identificação","Dados básicos do cadastro da obra.","fa-circle-info")}<div class="admin-readonly-grid"><div class="admin-readonly-block"><span>Código</span><div class="admin-readonly-value admin-work-code">${escapeHtml(o.codigo)}</div></div><div class="admin-readonly-block"><span>Status</span><div class="admin-readonly-value">${o.ativo ? "● Ativa" : "● Inativa"}</div></div></div><label for="fNome">Nome da obra<input id="fNome" value="${escapeHtml(o.nome)}" required></label></section>`; }
function renderizarClassificacao(o, c, principal, complementares) { return `<section id="sec-classificacao" class="admin-obra-section">${cabecalhoSecao(2,"Classificação","Tipologia e contexto principal do registro.","fa-tags")}<div class="admin-obra-ficha-grid"><label>Este registro representa<select id="fCategoria">${[["","Selecione"],["empreendimento","Empreendimento físico"],["interno","Atividade interna / administrativa"],["estudo","Estudo / oportunidade"],["outro","Outro"]].map(([v,r])=>`<option value="${v}" ${c.categoria_registro===v?"selected":""}>${r}</option>`).join("")}</select></label><label>Natureza<select id="fNatureza"><option value="">Selecione</option>${[["publico","Público"],["privado","Privado"],["misto","Misto"],["nao_informado","Não informado"]].map(([v,r])=>`<option value="${v}" ${c.natureza===v?"selected":""}>${r}</option>`).join("")}</select></label><label>Segmento principal<select id="fSegmento">${opcoes(Object.keys(TIPOLOGIAS_SEGMENTO), principal.segmento)}</select></label><label>Tipologia principal<select id="fTipologia"></select></label><label class="admin-span-full">Tipologias complementares<input id="fComplementares" value="${escapeHtml(complementares)}" placeholder="Ex.: Clínica, Laboratório"><small class="admin-helper">Separe múltiplas tipologias por vírgulas.</small></label></div><label class="admin-check-callout"><input type="checkbox" id="fNaoAplicavel" ${c.caracterizacao_nao_aplicavel?"checked":""}><span><strong>Caracterização física não aplicável</strong><small class="admin-helper">Marque quando áreas e estrutura não se aplicarem ao registro.</small></span></label></section>`; }
function campoArea(id, rotulo, valorCampo) { return `<label class="admin-input-suffix">${rotulo}<input id="${id}" type="number" min="0" step="any" value="${valorCampo ?? ""}"><span>m²</span></label>`; }
function renderizarCaracteristicasFisicas(c) { return `<section id="sec-caracteristicas" class="admin-obra-section">${cabecalhoSecao(3,"Características físicas","Áreas e estrutura da edificação.","fa-ruler-combined")}<h4 class="admin-subsection">Áreas</h4><div class="admin-obra-ficha-grid">${campoArea("fAreaTotal","Área total construída",c.area_total_construida)}${campoArea("fAreaIntervencao","Área de intervenção",c.area_intervencao)}${campoArea("fAreaExterna","Área externa",c.area_externa_intervencao)}${campoArea("fAreaCobertura","Área de cobertura",c.area_cobertura)}</div><h4 class="admin-subsection">Estrutura da edificação</h4><div class="admin-obra-ficha-grid"><label>Pavimentos acima do solo<input id="fPavimentos" type="number" min="0" step="1" value="${c.pavimentos_acima??""}"></label><label>Subsolos<input id="fSubsolos" type="number" min="0" step="1" value="${c.subsolos??""}"></label><label>Blocos / edificações<input id="fBlocos" type="number" min="0" step="1" value="${c.numero_blocos??""}"></label></div></section>`; }
function renderizarIntervencoesFicha(o) { return `<section id="sec-intervencoes" class="admin-obra-section">${cabecalhoSecao(4,"Intervenções","Selecione todas as intervenções realizadas.","fa-hammer")}<div class="admin-intervention-grid">${INTERVENCOES_ADMIN.map((v)=>`<label class="admin-intervention-option"><input type="checkbox" name="intervencao" value="${v}" ${o.intervencoes.includes(v)?"checked":""}><span>${v}</span></label>`).join("")}</div></section>`; }
function resumoProjeto(p) { const partes = [p.codigo_projeto, p.area_intervencao ? `${p.area_intervencao} m²` : "", p.pavimentos_atendidos ? `${p.pavimentos_atendidos} pavimentos` : ""].filter(Boolean); return partes.join(" · ") || "Dados do projeto"; }
function linhaProjeto(p = {}) { return `<article class="admin-projeto-row"><div class="admin-project-card-header"><button type="button" class="admin-project-toggle" aria-expanded="true"><strong>${escapeHtml(p.projeto || "Novo projeto")}</strong><small>${escapeHtml(resumoProjeto(p))}</small></button><button type="button" class="admin-project-remove removerProjeto" aria-label="Remover projeto"><i class="fa-solid fa-trash"></i></button></div><div class="admin-project-fields"><label>Projeto<input class="pNome" list="projetosCanonicos" placeholder="Nome do projeto" value="${escapeHtml(p.projeto||"")}"></label><label>Código<input class="pCodigo" placeholder="PRJ-..." value="${escapeHtml(p.codigo_projeto||"")}"></label><label>Área de intervenção<input class="pArea" type="number" min="0" step="any" value="${p.area_intervencao??""}"></label><label>Área externa<input class="pExterna" type="number" min="0" step="any" value="${p.area_externa??""}"></label><label>Área de cobertura<input class="pCobertura" type="number" min="0" step="any" value="${p.area_cobertura??""}"></label><label>Pavimentos<input class="pPavimentos" type="number" min="0" step="1" value="${p.pavimentos_atendidos??""}"></label><label class="admin-span-full">Observações<input class="pObs" value="${escapeHtml(p.observacoes||"")}"></label><input class="pOrigem" type="hidden" value="${escapeHtml(p.origem||"manual")}"></div></article>`; }
function renderizarProjetosFicha(o) { const canonicos=(globalThis.PROJETOS_PLANNER||[]).map((p)=>`<option value="${escapeHtml(p.projeto)}" data-codigo="${escapeHtml(p.codigoProjeto)}"></option>`).join(""); const acao='<button type="button" id="adicionarProjeto" class="admin-row-action"><i class="fa-solid fa-plus"></i> Adicionar projeto</button>'; const detectados=o.projetosDetectados.length?`<aside class="admin-detected-projects"><div class="admin-detected-head"><div><strong>Projetos detectados automaticamente</strong><p class="admin-helper">${o.projetosDetectados.length} projetos encontrados nas atividades e no Planner.</p></div>${badge(String(o.projetosDetectados.length),"blue")}</div><div class="admin-project-chips">${o.projetosDetectados.map((p)=>`<span class="admin-project-chip">${escapeHtml(p.projeto)}</span>`).join("")}</div><button type="button" id="sincronizarProjetos" class="admin-row-action"><i class="fa-solid fa-rotate"></i> Sincronizar projetos detectados</button></aside>`:""; return `<section id="sec-projetos" class="admin-obra-section">${cabecalhoSecao(5,"Projetos da obra","Escopos associados e projetos encontrados no histórico.","fa-diagram-project",acao)}<datalist id="projetosCanonicos">${canonicos}</datalist>${detectados}<div id="projetosFicha" class="admin-projects-list">${o.projetos.map(linhaProjeto).join("")}</div></section>`; }
function renderizarBenchmarkFicha(c) { return `<section id="sec-benchmark" class="admin-obra-section">${cabecalhoSecao(6,"Elegibilidade para análises históricas","Defina se este cadastro poderá construir referências de prazo e esforço.","fa-chart-line")}<div class="admin-benchmark-card"><div class="admin-obra-ficha-grid"><label>Benchmark<select id="fBenchmark"><option value="nao_avaliado" ${(!c.benchmark_status||c.benchmark_status==='nao_avaliado')?'selected':''}>Não avaliado</option><option value="incluir" ${c.benchmark_status==='incluir'?'selected':''}>Incluir no Benchmark</option><option value="excluir" ${c.benchmark_status==='excluir'?'selected':''}>Excluir do Benchmark</option></select></label><label id="motivoWrap">Motivo<select id="fMotivo">${[["","Selecione"],["atividade_interna","Atividade interna"],["dados_incompletos","Dados históricos incompletos"],["projeto_excepcional","Projeto excepcional"],["escopo_nao_comparavel","Escopo não comparável"],["projeto_cancelado","Projeto cancelado"],["outro","Outro"]].map(([v,r])=>`<option value="${v}" ${c.benchmark_motivo===v?'selected':''}>${r}</option>`).join("")}</select></label><label id="motivoOutroWrap" class="admin-span-full">Outro motivo<input id="fMotivoOutro" value="${escapeHtml(c.benchmark_motivo_outro||"")}"></label></div></div></section>`; }
function formatarMinutosAdmin(minutos) { const total=Math.max(0,Math.round(Number(minutos)||0)),h=Math.floor(total/60),m=total%60;return `${h}h${m?String(m).padStart(2,"0"):""}`; }
function renderizarAnaliseTemporal() { return `<section id="sec-analise-temporal" class="admin-obra-section admin-gantt-analysis">${cabecalhoSecao(8,"Análise temporal","Histórico real de execução derivado das atividades vinculadas ao Planner.","fa-chart-gantt")}<div class="admin-gantt-toolbar"><label>Projeto<select id="adminGanttProjeto"><option value="">Todos</option></select></label><label>Fase<select id="adminGanttFase"><option value="">Todas</option></select></label><label>Colaborador<select id="adminGanttColaborador"><option value="">Todos</option></select></label><label>Escala<select id="adminGanttEscala"><option value="mes">Mês</option><option value="semana">Semana</option><option value="tudo">Tudo</option></select></label><label>Detalhe<select id="adminGanttModo"><option value="sintetico">Sintético</option><option value="analitico">Analítico</option></select></label><button type="button" id="adminGanttAnterior">◀</button><strong id="adminGanttPeriodo">Período</strong><button type="button" id="adminGanttProximo">▶</button></div><div id="adminGanttConteudo" class="admin-gantt-content"><p class="admin-empty">Carregando execução real...</p></div></section>`; }
let adminGanttReferencia=null;
async function carregarAnaliseTemporal() { const alvo=document.getElementById("adminGanttConteudo");if(!alvo||!obraAberta)return;try{const dados=await fetch(`${PLANNER_URL}?analiseTemporal=1&obraId=${encodeURIComponent(obraAberta.id)}`).then(validarResposta);renderizarGanttAdmin(dados.checklists||[]);}catch(erro){alvo.innerHTML=`<p class="admin-message error">${escapeHtml(erro.message)}</p>`;} }
function periodoAdmin(global,escala){if(escala==="tudo")return global;const d=new Date(`${adminGanttReferencia||global.fim}T12:00:00`),i=new Date(d),f=new Date(d);if(escala==="semana"){i.setDate(i.getDate()-((i.getDay()+6)%7));f.setTime(i.getTime());f.setDate(f.getDate()+6);}else{i.setDate(1);f.setMonth(f.getMonth()+1,0);}return{inicio:PLANNER_GANTT.dataCivilIso(i),fim:PLANNER_GANTT.dataCivilIso(f)};}
function tooltipGerencial(no,periodo){const m=no.metricas;return [`${no.nome}`,`Período analisado: ${periodo.inicio} a ${periodo.fim}`,`Esforço no período: ${formatarMinutosAdmin(m.minutosNoPeriodo)}`,`Esforço acumulado: ${formatarMinutosAdmin(m.minutosAcumulados)}`,`Dias ativos: ${m.diasAtivos}`,`Janela de execução: ${m.diasJanela} dias corridos (contagem inclusiva)`,`Cadência temporal: ${Math.round(m.cadencia*100)}%`,`Maior lacuna: ${m.maiorLacuna.dias} dias sem movimentação`,m.maiorLacuna.inicio?`${m.maiorLacuna.inicio} → ${m.maiorLacuna.fim}`:"",`Itens/processos movimentados: ${m.itensMovimentados}`,`Colaboradores: ${m.colaboradores.join(" · ")||"—"}`].filter(Boolean).join("\n");}
function renderizarGanttAdmin(checklists){const projetoFiltro=valor("adminGanttProjeto"),faseFiltro=valor("adminGanttFase"),colaboradorFiltro=valor("adminGanttColaborador");[["adminGanttProjeto",checklists.map((c)=>c.projeto)],["adminGanttFase",checklists.flatMap((c)=>c.itens||[]).map((i)=>i.etapa)],["adminGanttColaborador",checklists.flatMap((c)=>c.itens||[]).flatMap((i)=>i.atividadesVinculadas||[]).map((a)=>a.colaborador)]].forEach(([id,valores])=>{const el=document.getElementById(id),atual=el.value;if(el.options.length===1)[...new Set(valores.filter(Boolean))].sort().forEach((v)=>el.insertAdjacentHTML("beforeend",`<option>${escapeHtml(v)}</option>`));el.value=atual;});checklists=checklists.filter((c)=>!projetoFiltro||c.projeto===projetoFiltro).map((c)=>({...c,itens:(c.itens||[]).filter((i)=>!faseFiltro||i.etapa===faseFiltro).map((i)=>({...i,atividadesVinculadas:(i.atividadesVinculadas||[]).filter((a)=>!colaboradorFiltro||a.colaborador===colaboradorFiltro)}))}));const alvo=document.getElementById("adminGanttConteudo"),global=PLANNER_GANTT.obterIntervaloGlobalGantt(checklists);if(!global){alvo.innerHTML='<p class="admin-empty">Nenhuma atividade real vinculada foi encontrada nesta obra.</p>';return;}const escala=document.getElementById("adminGanttEscala").value,modo=document.getElementById("adminGanttModo").value,periodo=periodoAdmin(global,escala),dias=PLANNER_GANTT.listarDias(periodo.inicio,periodo.fim),estrutura=PLANNER_GANTT.construirEstruturaGantt(checklists,{periodo}),raiz=estrutura[0],linhas=PLANNER_GANTT.filtrarLinhasHierarquia(estrutura,{modo});document.getElementById("adminGanttPeriodo").textContent=escala==="mes"?new Date(`${periodo.inicio}T12:00`).toLocaleDateString("pt-BR",{month:"long",year:"numeric"}):`${periodo.inicio} — ${periodo.fim}`;const itens=raiz.projetos.flatMap((p)=>p.filhos).flatMap((f)=>f.filhos).filter((n)=>n.metricas.diasAtivos).length,projetos=raiz.projetos.filter((n)=>n.metricas.diasAtivos).length;alvo.innerHTML=`<div class="admin-gantt-summary">${[[formatarMinutosAdmin(raiz.metricas.minutosNoPeriodo),"Esforço no período"],[raiz.metricas.diasAtivos,"Dias ativos"],[projetos,"Projetos movimentados"],[itens,"Itens movimentados"],[`${raiz.metricas.maiorLacuna.dias} dias`,"Maior lacuna"],[raiz.metricas.colaboradores.length,"Colaboradores envolvidos"]].map(([v,r])=>`<article class="admin-gantt-metric"><strong>${v}</strong><span>${r}</span></article>`).join("")}</div><div class="admin-gantt-scroll"><div class="admin-gantt-grid" style="--days:${dias.length}"><header><b>Processo</b><b>Esforço</b><b>Dias</b><div class="admin-gantt-days">${dias.map((d)=>`<span>${d.slice(8)}</span>`).join("")}</div></header>${linhas.map((no)=>`<div class="admin-gantt-row type-${no.tipo}" title="${escapeHtml(tooltipGerencial(no,periodo))}"><span>${escapeHtml(no.nome)}</span><b>${formatarMinutosAdmin(no.metricas.minutosNoPeriodo)}</b><b>${no.metricas.diasAtivos}</b><div class="admin-gantt-timeline">${no.segmentosPeriodo.map((seg)=>{const col=PLANNER_GANTT.diferencaDias(periodo.inicio,seg.data)+1;if(col<1||col>dias.length)return"";const detalhe=seg.colaboradores.map((c)=>`${c} — ${formatarMinutosAdmin(seg.colaboradoresHoras[c])}`).join("\n");return`<i style="grid-column:${col}" title="${escapeHtml(`${seg.data}\n${formatarMinutosAdmin(seg.minutos)} registradas\n${seg.colaboradores.length} colaboradores\n${seg.itens.length||(no.tipo==="item"?1:0)} itens movimentados\n${detalhe}`)}"></i>`;}).join("")}</div></div>`).join("")}</div></div>`;}
function configurarAnaliseTemporal(){["adminGanttProjeto","adminGanttFase","adminGanttColaborador","adminGanttEscala","adminGanttModo"].forEach((id)=>document.getElementById(id)?.addEventListener("change",()=>{adminGanttReferencia=null;carregarAnaliseTemporal();}));[["adminGanttAnterior",-1],["adminGanttProximo",1]].forEach(([id,direcao])=>document.getElementById(id)?.addEventListener("click",()=>{const escala=valor("adminGanttEscala"),base=adminGanttReferencia||new Date().toISOString().slice(0,10),d=new Date(`${base}T12:00`);escala==="semana"?d.setDate(d.getDate()+7*direcao):d.setMonth(d.getMonth()+direcao);adminGanttReferencia=PLANNER_GANTT.dataCivilIso(d);carregarAnaliseTemporal();}));carregarAnaliseTemporal();}
function renderizarAuditoriaFicha(o,c) { return `<section id="sec-observacoes" class="admin-obra-section">${cabecalhoSecao(7,"Observações","Contexto complementar e histórico da ficha.","fa-note-sticky")}<label>Observações da ficha<textarea id="fObservacoes" rows="4">${escapeHtml(c.observacoes||"")}</textarea></label><footer class="admin-audit-card"><div><strong>Criada através de</strong>${escapeHtml(o.origemCriacao||"Sistema")}</div><div><strong>Criada em</strong>${escapeHtml(o.criadoEm||"Não informado")}</div><div><strong>Última alteração</strong>${escapeHtml(c.atualizado_em||"—")}</div></footer></section>`; }
function renderizarFicha() { const o=obraAberta,c=o.caracteristica||{},principal=o.tipologias.find((t)=>t.principal)||{},complementares=o.tipologias.filter((t)=>!t.principal).map((t)=>t.tipologia).join(", "); const painel=document.getElementById("adminObraFicha"); document.getElementById("adminObrasLista").hidden=true; painel.hidden=false; painel.innerHTML=`<form id="obraFichaForm" class="admin-obra-ficha-form">${renderizarCabecalhoFicha(o)}<div class="admin-obra-layout"><nav class="admin-obra-nav" aria-label="Seções da ficha"><strong>Ficha da obra</strong>${[["identificacao","1. Identificação"],["classificacao","2. Classificação"],["caracteristicas","3. Características"],["intervencoes","4. Intervenções"],["projetos","5. Projetos"],["benchmark","6. Benchmark"],["observacoes","7. Observações"],["analise-temporal","8. Análise temporal"]].map(([id,r],i)=>`<a href="#sec-${id}" ${i===0?'aria-current="true"':''}>${r}</a>`).join("")}</nav><div class="admin-obra-content">${renderizarIdentificacao(o)}${renderizarClassificacao(o,c,principal,complementares)}<div id="camposFisicos">${renderizarCaracteristicasFisicas(c)}</div>${renderizarIntervencoesFicha(o)}${renderizarProjetosFicha(o)}${renderizarBenchmarkFicha(c)}${renderizarAuditoriaFicha(o,c)}${renderizarAnaliseTemporal()}</div></div></form>`; configurarFicha(principal.tipologia); configurarAnaliseTemporal(); }
function configurarFicha(tipologiaAtual) {
  const form=document.getElementById("obraFichaForm"),segmento=document.getElementById("fSegmento"),tipologia=document.getElementById("fTipologia");
  const atualizarTipologias=()=>{const atual=tipologia.value||tipologiaAtual;tipologia.innerHTML=opcoes(TIPOLOGIAS_SEGMENTO[segmento.value]||[],atual);tipologiaAtual="";};
  const atualizarCondicionais=()=>{const nao=document.getElementById("fNaoAplicavel").checked;document.getElementById("camposFisicos").hidden=nao;if(nao&&valor("fBenchmark")==="incluir")document.getElementById("fBenchmark").value="nao_avaliado";const excluir=valor("fBenchmark")==="excluir";document.getElementById("motivoWrap").hidden=!excluir;document.getElementById("motivoOutroWrap").hidden=!excluir||valor("fMotivo")!=="outro";};
  atualizarTipologias(); atualizarCondicionais(); segmento.addEventListener("change",atualizarTipologias); ["fNaoAplicavel","fBenchmark","fMotivo"].forEach((id)=>document.getElementById(id).addEventListener("change",atualizarCondicionais));
  document.getElementById("voltarObras").addEventListener("click",voltarObras); form.addEventListener("submit",salvarFicha); form.addEventListener("input",()=>{document.getElementById("saveState").textContent="Alterações não salvas";});
  document.getElementById("alternarObra").addEventListener("click",solicitarAlternarObra); document.getElementById("adicionarProjeto").addEventListener("click",()=>document.getElementById("projetosFicha").insertAdjacentHTML("beforeend",linhaProjeto()));
  document.getElementById("projetosFicha").addEventListener("click",(e)=>{const remover=e.target.closest(".removerProjeto");if(remover){remover.closest(".admin-projeto-row").remove();return;}const toggle=e.target.closest(".admin-project-toggle");if(toggle){const campos=toggle.closest(".admin-projeto-row").querySelector(".admin-project-fields");campos.hidden=!campos.hidden;toggle.setAttribute("aria-expanded",String(!campos.hidden));}}); document.getElementById("sincronizarProjetos")?.addEventListener("click",sincronizarProjetos); configurarNavegacaoFicha();
}
function configurarNavegacaoFicha(){document.querySelectorAll(".admin-obra-nav a").forEach((link)=>link.addEventListener("click",(e)=>{e.preventDefault();document.querySelector(link.getAttribute("href"))?.scrollIntoView({behavior:"smooth",block:"start"});}));observadorSecoes?.disconnect();observadorSecoes=new IntersectionObserver((entries)=>{entries.filter((e)=>e.isIntersecting).forEach((e)=>document.querySelectorAll(".admin-obra-nav a").forEach((a)=>a.setAttribute("aria-current",String(a.getAttribute("href")===`#${e.target.id}`))));},{rootMargin:"-25% 0px -60%",threshold:0});document.querySelectorAll(".admin-obra-section").forEach((s)=>observadorSecoes.observe(s));}
function voltarObras(){history.replaceState(null,"",location.pathname);observadorSecoes?.disconnect();document.getElementById("adminObraFicha").hidden=true;document.getElementById("adminObrasLista").hidden=false;obraAberta=null;}
function valor(id){return document.getElementById(id).value;}
function projetosFormulario(){return [...document.querySelectorAll(".admin-projeto-row")].map((r)=>({projeto:r.querySelector(".pNome").value,codigoProjeto:r.querySelector(".pCodigo").value,areaIntervencao:r.querySelector(".pArea").value,areaExterna:r.querySelector(".pExterna").value,areaCobertura:r.querySelector(".pCobertura").value,pavimentosAtendidos:r.querySelector(".pPavimentos").value,observacoes:r.querySelector(".pObs").value,origem:r.querySelector(".pOrigem").value})).filter((p)=>p.projeto.trim());}
async function salvarFicha(event){event.preventDefault();const botao=document.getElementById("salvarFicha"),id=obraAberta.id;botao.disabled=true;botao.innerHTML='<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';try{if(valor("fNome").trim()!==obraAberta.nome)await fetch(OBRAS_URL,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:obraAberta.id,nome:valor("fNome"),ativo:obraAberta.ativo})}).then(validarResposta);const principal=valor("fTipologia")?[{segmento:valor("fSegmento"),tipologia:valor("fTipologia"),principal:true}]:[];const complementares=valor("fComplementares").split(",").map((v)=>v.trim()).filter(Boolean).map((tipologia)=>({segmento:valor("fSegmento")||"Outro",tipologia,principal:false}));const body={obraId:obraAberta.id,categoriaRegistro:valor("fCategoria"),natureza:valor("fNatureza"),caracterizacaoNaoAplicavel:document.getElementById("fNaoAplicavel").checked,areaTotalConstruida:valor("fAreaTotal"),areaIntervencao:valor("fAreaIntervencao"),areaExternaIntervencao:valor("fAreaExterna"),areaCobertura:valor("fAreaCobertura"),pavimentosAcima:valor("fPavimentos"),subsolos:valor("fSubsolos"),numeroBlocos:valor("fBlocos"),tipologias:[...principal,...complementares],intervencoes:[...document.querySelectorAll('[name="intervencao"]:checked')].map((i)=>i.value),projetos:projetosFormulario(),benchmarkStatus:valor("fBenchmark"),benchmarkMotivo:valor("fMotivo"),benchmarkMotivoOutro:valor("fMotivoOutro"),observacoes:valor("fObservacoes")};await fetch(OBRAS_ADMIN_URL,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(validarResposta);await carregarObras();await abrirFicha(id);mostrarToast("Ficha técnica salva.");}catch(erro){mostrarToast(erro.message,true);}finally{if(document.getElementById("salvarFicha")){document.getElementById("salvarFicha").disabled=false;document.getElementById("salvarFicha").innerHTML='<i class="fa-solid fa-floppy-disk"></i> Salvar alterações';}}}
function solicitarAlternarObra(){if(!obraAberta.ativo){alternarObra();return;}document.getElementById("confirmarObraTitle").textContent=`Desativar ${obraAberta.nome}?`;document.getElementById("confirmarObraTexto").textContent="A obra permanecerá no histórico, mas deixará de aparecer normalmente em novos cadastros.";abrirModal("confirmarObraModal","confirmarAlternarObra");}
async function alternarObra(){const id=obraAberta.id;try{await fetch(OBRAS_URL,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,nome:valor("fNome"),ativo:!obraAberta.ativo})}).then(validarResposta);fecharModal("confirmarObraModal");await carregarObras();await abrirFicha(id);mostrarToast(obraAberta.ativo?"Obra reativada.":"Obra desativada.");}catch(erro){mostrarToast(erro.message,true);}}
async function sincronizarProjetos(){const id=obraAberta.id;try{const data=await fetch(OBRAS_ADMIN_URL,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({acao:"sincronizarProjetos",obraId:id})}).then(validarResposta);await abrirFicha(id);mostrarToast(`${data.adicionados||0} projetos sincronizados.`);}catch(erro){mostrarToast(erro.message,true);}}
function mostrarMensagemObra(mensagem,erro=false){mostrarToast(mensagem,erro);}