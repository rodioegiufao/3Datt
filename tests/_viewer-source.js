// O visualizador autenticado fica em 3D/viewer/viewer-authenticated.js + módulos em 3D/viewer/app/.
// Os testes de código-fonte leem tudo junto, como se fosse um arquivo só.
const fs = require("fs");
const path = require("path");

function readAuthenticatedViewerSource(root) {
    const main = path.join(root, "3D/viewer/viewer-authenticated.js");
    const appDir = path.join(root, "3D/viewer/app");
    const modules = fs.existsSync(appDir)
        ? fs.readdirSync(appDir).filter((f) => f.endsWith(".js")).sort().map((f) => fs.readFileSync(path.join(appDir, f), "utf8"))
        : [];
    // Sem o "export " na frente das declarações, para os testes que avaliam trechos com vm
    return [fs.readFileSync(main, "utf8"), ...modules]
        .join("\n")
        .replace(/^export (?=(?:async )?function |const |let |var )/gm, "");
}

module.exports = { readAuthenticatedViewerSource };
