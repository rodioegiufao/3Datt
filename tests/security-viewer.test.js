const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const sourceExtensions = new Set([".html", ".js", ".json", ".css", ".md"]);
const files = [];
function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(full);
  }
}
walk(path.join(root, "3D"));
const sources = files.map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert.doesNotMatch(sources, /ribeiro2026|farmacia_access_granted|ACCESS_PASSWORD/);

const selector = fs.readFileSync(path.join(root, "3D/index.html"), "utf8");
assert.doesNotMatch(selector, /type=["']password["']|accessPassword/);
assert.match(selector, /fetch\("\/api\/auth"/);
assert.match(selector, /login=necessario/);

const bootstrap = fs.readFileSync(path.join(root, "3D/app.js"), "utf8");
assert.match(bootstrap, /getViewerSession\(\)[\s\S]*if \(!user\)[\s\S]*viewer-public\.js[\s\S]*__VIEWER_AUTH_USER__[\s\S]*viewer-authenticated\.js/);
const clash = fs.readFileSync(path.join(root, "api/clash.js"), "utf8");
assert.match(clash, /await requireInternalUser\(req\)/);
console.log("viewer security: ok");