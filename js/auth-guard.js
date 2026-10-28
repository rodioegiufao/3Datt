(function () {
  const AUTH_URL = "/api/auth";
  const INTERNAL_PATHS = ["/viabilidade", "/Memorial", "/alimentador", "/carimbo", "/iluminancia", "/memo", "/atividades"];
  const ADMIN_PATHS = ["/admin"];
  const PROTECTED_PATHS = [...INTERNAL_PATHS, ...ADMIN_PATHS];

  async function requestJson(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Não foi possível validar o login.");
    return data;
  }

  async function getCurrentUser() {
    try {
      const data = await requestJson(AUTH_URL, { credentials: "same-origin" });
      return data.user || null;
    } catch (_error) {
      return null;
    }
  }

  function redirectToHomeLogin() {
    const redirect = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.replace(`/?login=necessario&redirect=${encodeURIComponent(redirect)}`);
  }

  function isProtectedPath() {
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    return PROTECTED_PATHS.some((protectedPath) => path === protectedPath || path.startsWith(`${protectedPath}/`));
  }

  function pathMatches(paths) {
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    return paths.some((base) => path.toLowerCase() === base.toLowerCase() || path.toLowerCase().startsWith(`${base.toLowerCase()}/`));
  }

  function obterIniciais(nome) {
    const partes = String(nome || "").trim().split(/\s+/).filter(Boolean);
    if (!partes.length) return "?";
    const primeira = partes[0][0] || "";
    const ultima = partes.length > 1 ? partes[partes.length - 1][0] : (partes[0][1] || "");
    return `${primeira}${ultima}`.toUpperCase();
  }

  function fecharMenuUsuario() {
    const userMenuTrigger = document.getElementById("userMenuTrigger");
    const userMenuPanel = document.getElementById("userMenuPanel");
    if (!userMenuTrigger || !userMenuPanel) return;
    userMenuPanel.hidden = true;
    userMenuTrigger.setAttribute("aria-expanded", "false");
  }

  function aplicarUsuarioNoMenu(user) {
    const userMenu = document.getElementById("userMenu");
    if (!userMenu) return;

    const iniciais = obterIniciais(user?.nome);
    userMenu.hidden = !user;
    document.getElementById("adminLink")?.toggleAttribute("hidden", user?.perfil !== "admin");
    if (document.getElementById("usuarioLogado")) document.getElementById("usuarioLogado").textContent = user?.nome || "";
    if (document.getElementById("usuarioPerfil")) document.getElementById("usuarioPerfil").textContent = user?.perfil || "";
    if (document.getElementById("usuarioIniciais")) document.getElementById("usuarioIniciais").textContent = iniciais;
    if (document.getElementById("usuarioIniciaisMenu")) document.getElementById("usuarioIniciaisMenu").textContent = iniciais;
    if (!user) fecharMenuUsuario();
  }


  function ensureProfileModal() {
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
          <label>Nome
            <input type="text" id="profileNome" required>
          </label>
          <label>Login
            <input type="text" id="profileUsuario" autocomplete="username" required>
          </label>
          <label>Senha atual <small>(necessária para trocar a senha)</small>
            <span class="profile-password-field">
              <input type="password" id="profileSenhaAtual" autocomplete="current-password">
              <button type="button" class="profile-password-toggle" data-target="profileSenhaAtual" aria-label="Mostrar senha atual" aria-pressed="false">👁</button>
            </span>
          </label>
          <label>Nova senha
            <span class="profile-password-field">
              <input type="password" id="profileNovaSenha" autocomplete="new-password" minlength="6">
              <button type="button" class="profile-password-toggle" data-target="profileNovaSenha" aria-label="Mostrar nova senha" aria-pressed="false">👁</button>
            </span>
          </label>
          <div class="profile-modal-actions">
            <button type="button" id="profileCancel">Cancelar</button>
            <button type="submit">Salvar perfil</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => { if (event.target === modal) closeProfileModal(); });
    document.getElementById("profileModalClose")?.addEventListener("click", closeProfileModal);
    document.getElementById("profileCancel")?.addEventListener("click", closeProfileModal);
    document.getElementById("profileForm")?.addEventListener("submit", saveProfile);
    modal.querySelectorAll(".profile-password-toggle").forEach((button) => {
      button.addEventListener("click", toggleProfilePasswordVisibility);
    });
    return modal;
  }
  function getProfilePasswordIcon(isVisible) {
    return isVisible
      ? `<svg class="profile-password-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5c5.05 0 8.63 4.06 10 7-1.37 2.94-4.95 7-10 7S3.37 14.94 2 12c1.37-2.94 4.95-7 10-7Zm0 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"/><circle cx="12" cy="12" r="2.15"/></svg>`
      : `<svg class="profile-password-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m3.28 2 18.72 18.72-1.28 1.28-3.3-3.3A10.7 10.7 0 0 1 12 20C6.95 20 3.37 15.94 2 13c.7-1.49 2.01-3.28 3.8-4.71L2 4.49 3.28 2Zm6.22 9.43a3 3 0 0 0 3.91 3.91L9.5 11.43Zm2.5-6.43c5.05 0 8.63 4.06 10 7a13.53 13.53 0 0 1-3.1 4.17l-2.84-2.84A4 4 0 0 0 10.67 7.94L8.85 6.12A10.1 10.1 0 0 1 12 5Z"/></svg>`;
  }

  function updateProfilePasswordToggle(button, isVisible) {
    button.setAttribute("aria-pressed", String(isVisible));
    button.setAttribute("aria-label", `${isVisible ? "Ocultar" : "Mostrar"} ${button.dataset.target === "profileSenhaAtual" ? "senha atual" : "nova senha"}`);
    button.innerHTML = getProfilePasswordIcon(isVisible);
  }
  function toggleProfilePasswordVisibility(event) {
    const button = event.currentTarget;
    const input = document.getElementById(button.dataset.target);
    if (!input) return;
    const showPassword = input.type === "password";
    input.type = showPassword ? "text" : "password";
    updateProfilePasswordToggle(button, showPassword);
  }

  function resetProfilePasswordVisibility() {
    document.querySelectorAll("#profileSenhaAtual, #profileNovaSenha").forEach((input) => { input.type = "password"; });
    document.querySelectorAll(".profile-password-toggle").forEach((button) => {
      updateProfilePasswordToggle(button, false);
    });
  }
  function openProfileModal(user) {
    const modal = ensureProfileModal();
    document.getElementById("profileNome").value = user?.nome || "";
    document.getElementById("profileUsuario").value = user?.usuario || "";
    document.getElementById("profileSenhaAtual").value = "";
    document.getElementById("profileNovaSenha").value = "";
    resetProfilePasswordVisibility();
    modal.hidden = false;
    document.getElementById("profileNome")?.focus();
  }

  function closeProfileModal() {
    const modal = document.getElementById("profileModal");
    if (modal) modal.hidden = true;
  }

  async function saveProfile(event) {
    event.preventDefault();
    try {
      const data = await requestJson(AUTH_URL, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: document.getElementById("profileNome").value,
          usuario: document.getElementById("profileUsuario").value,
          senhaAtual: document.getElementById("profileSenhaAtual").value,
          novaSenha: document.getElementById("profileNovaSenha").value
        })
      });
      aplicarUsuarioNoMenu(data.user);
      closeProfileModal();
      alert("Perfil atualizado com sucesso.");
    } catch (error) {
      alert(error.message || "Não foi possível atualizar o perfil.");
    }
  }

  function inicializarMenuUsuario() {
    const userMenu = document.getElementById("userMenu");
    const userMenuTrigger = document.getElementById("userMenuTrigger");
    const btnLogout = document.getElementById("btnLogout");
    const btnPerfil = document.getElementById("btnPerfil");
    if (!userMenu || !userMenuTrigger) return;

    userMenuTrigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const userMenuPanel = document.getElementById("userMenuPanel");
      if (!userMenuPanel) return;
      const abrir = userMenuPanel.hidden;
      userMenuPanel.hidden = !abrir;
      userMenuTrigger.setAttribute("aria-expanded", String(abrir));
    });

    document.addEventListener("click", (event) => {
      if (userMenu.hidden || userMenu.contains(event.target)) return;
      fecharMenuUsuario();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        fecharMenuUsuario();
        closeProfileModal();
      }
    });

    btnPerfil?.addEventListener("click", async () => {
      const user = await getCurrentUser();
      if (!user) return;
      fecharMenuUsuario();
      openProfileModal(user);
    });

    btnLogout?.addEventListener("click", async () => {
      await requestJson(AUTH_URL, { method: "DELETE", credentials: "same-origin" }).catch(() => null);
      aplicarUsuarioNoMenu(null);
      window.location.href = "/";
    });

    getCurrentUser().then(aplicarUsuarioNoMenu);
  }

  async function protectCurrentPage() {
    if (!isProtectedPath()) return;
    const user = await getCurrentUser();
    aplicarUsuarioNoMenu(user);
    if (!user) redirectToHomeLogin();
    else if (user.perfil === "cliente" && pathMatches(PROTECTED_PATHS)) window.location.replace("/3D/?acesso=negado");
    else if (pathMatches(ADMIN_PATHS) && user.perfil !== "admin") window.location.replace("/");
  }

  window.SiteAuth = { getCurrentUser, requestJson, redirectToHomeLogin, aplicarUsuarioNoMenu };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inicializarMenuUsuario);
  } else {
    inicializarMenuUsuario();
  }

  protectCurrentPage();
})();
