const assert = require("node:assert/strict");
const fs = require("node:fs");

process.env.AUTH_SECRET = "client-profile-test-secret";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

const {
  createSessionCookie,
  normalizeUserProfile,
  require3DUser,
  requireInternalUser,
  USER_PROFILES,
  VALID_PROFILES
} = require("../api/_auth");

async function main() {
  assert.deepEqual(VALID_PROFILES, ["admin", "colaborador", "cliente"]);
  assert.equal(normalizeUserProfile(" Cliente "), "cliente", "cliente não pode ser convertido em colaborador");
  assert.equal(normalizeUserProfile("desconhecido"), "colaborador");

  const cliente = { id: "cliente-id", nome: "Cliente", usuario: "cliente", perfil: USER_PROFILES.CLIENT };
  const cookie = createSessionCookie(cliente).split(";")[0];
  const req = { headers: { cookie } };
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, text: async () => JSON.stringify([cliente]) });
  try {
    assert.equal((await require3DUser(req)).perfil, "cliente", "cliente deve acessar APIs autenticadas do 3D");
    await assert.rejects(requireInternalUser(req), (error) => error.statusCode === 403 && error.message === "Seu perfil não possui acesso a este recurso.");
  } finally {
    global.fetch = originalFetch;
  }

  for (const endpoint of ["atividades.js", "atividades-semanais.js", "planner-checklist.js", "obras.js", "gerar-memorando-word.js"]) {
    assert.match(fs.readFileSync(`api/${endpoint}`, "utf8"), /requireInternalUser\(req\)/, `${endpoint} deve bloquear cliente`);
  }
  assert.match(fs.readFileSync("api/share-models.js", "utf8"), /await require3DUser\(req\)/);
  const app = fs.readFileSync("3D/app.js", "utf8");
  assert.match(app, /window\.__VIEWER_AUTH_USER__ = user[\s\S]*viewer-authenticated\.js/);
  const authenticatedViewer = require("./_viewer-source").readAuthenticatedViewerSource(process.cwd());
  const viewerPermissions = fs.readFileSync("3D/viewer/core/viewer-permissions.js", "utf8");
  assert.match(viewerPermissions, /cliente: Object\.freeze\(\{ collision: false, materials: false, transform: false \}\)/);
  assert.match(authenticatedViewer, /const user = window\.__VIEWER_AUTH_USER__ \|\| await fetchViewerUser\(\)/, "deve reutilizar o usuário autenticado antes do fallback");
  assert.match(authenticatedViewer, /function applyViewerProfilePermissions\(user\)[\s\S]*setCollisionFeatureAccess\(permissions\.canUseCollision\)[\s\S]*setMaterialsFeatureAccess\(permissions\.canUseMaterials\)[\s\S]*setTransformFeatureAccess\(permissions\.canTransformModels\)/);
  assert.match(authenticatedViewer, /function applyTransformFromUI\(\) \{\s*if \(!transformFeatureAllowed \|\| !transformModelSelect\)/);
  assert.match(authenticatedViewer, /async function generateAndRenderMaterialsList\(\) \{\s*if \(!materialsFeatureAllowed\)/);
  assert.match(authenticatedViewer, /function findAndRenderCollisions\(modelId\) \{\s*if \(!collisionFeatureAllowed\)/);
  assert.match(authenticatedViewer, /if \(key === rotationShortcutKey\) \{\s*if \(!transformFeatureAllowed\) return;/);
  assert.match(authenticatedViewer, /if \(key === "l"\) \{\s*if \(!materialsFeatureAllowed\) return;/);
  const viewerUserBadge = fs.readFileSync("3D/user-badge.js", "utf8");
  const viewerLogout = viewerUserBadge.match(/async function sair\(\) \{([\s\S]*?)\n    \}/)?.[1] || "";
  assert.match(viewerLogout, /method: "DELETE"/, "logout do 3D deve encerrar a sessão");
  assert.match(viewerLogout, /viewerUserMenu[\s\S]*remove\(\)/, "logout do 3D deve remover o menu do usuário");
  assert.doesNotMatch(viewerLogout, /(?:window\.)?location/, "logout do 3D deve manter o visitante no projeto atual");
  console.log("client profile authorization: ok");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });