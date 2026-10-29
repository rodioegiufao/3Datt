# BIM Viewer Desktop

Aplicativo Windows (Electron) do visualizador 3D, feito para apresentar modelos pesados a clientes: usa a placa de vídeo dedicada, converte IFC com o processador do computador e funciona sem internet.

## Instalar no repositório

1. Copie esta pasta `desktop/` para a raiz do repositório do site (ao lado de `3D/`, `api/`, `images/`).
2. Se você usou a versão anterior, apague da raiz: `package.desktop.json`, `package.web.json`, `README-DESKTOP.md` e a pasta `desktop/` antiga. Restaure o `package.json` da raiz para o do site (o da Vercel); o desktop agora tem o seu próprio `package.json` dentro de `desktop/`.

O código do site não é modificado. O desktop aplica seus ajustes na hora de servir os arquivos, então toda atualização do site entra no aplicativo na próxima vez que você gerar o `.exe`.

## Gerar o executável

Precisa do Node.js 22 LTS ou mais novo (https://nodejs.org). No Windows, dê dois cliques em `GERAR-EXE.bat`, ou no PowerShell dentro de `desktop/`:

```powershell
npm install
npm test          # confere se os ajustes ainda encaixam no código atual do site
npm start         # abre o aplicativo sem gerar instalador
npm run dist      # gera os executáveis em desktop\dist\
```

Saem dois arquivos em `desktop\dist\`:

- `BIM Viewer Desktop-1.0.0-instalador.exe`: **recomendado**. Já registra o aplicativo como "Alto desempenho" no Windows (GPU dedicada) e associa arquivos `.ifc` e `.xkt` ao duplo-clique.
- `BIM Viewer Desktop-1.0.0-portatil.exe`: roda sem instalar (pendrive). Também pede a GPU dedicada, mas o ajuste do Windows é mais confiável na versão instalada.

## O que mudou em relação à versão anterior

**Visualizador completo.** A versão anterior respondia erro em `/api/auth`, então abria sempre o modo público reduzido e a página de IFC nem carregava. Agora há uma sessão local; o menu **Perfil** alterna entre *Completo* e *Cliente* (esconde ferramentas internas durante a apresentação).

**Placa de vídeo no máximo.**
- Força a GPU dedicada em notebooks com Intel + NVIDIA/AMD (chave do Chromium + preferência "Alto desempenho" do Windows).
- Ignora a lista negra de drivers, para nunca cair em renderização por software.
- Antialias de hardware até 8x, sem `preserveDrawingBuffer` (economiza uma cópia da imagem por quadro; o print continua funcionando).
- Supersampling quando a câmera está parada (imagem mais nítida, inclusive em TV 4K) e **resolução dinâmica** ao navegar: mede o FPS e usa a maior resolução que mantém ~60 FPS.
- Não reduz desempenho quando a janela perde o foco; processos de GPU e da página com prioridade acima do normal.
- PCs com 4 núcleos não entram mais no "modo compatibilidade" pensado para celular; até 6 modelos carregam em paralelo.

**IFC pesado.** Antes, o IFC era lido dentro da página (Pyodide/IfcOpenShell e depois WebIFC), travando a janela e usando um núcleo. Agora:
- converte para XKT em processos separados, vários arquivos em paralelo (um por núcleo, limitado pela RAM);
- guarda o XKT em cache: abrir o mesmo IFC de novo é instantâneo (o cache se renova se o arquivo mudar);
- a janela continua respondendo durante a conversão.

**Offline.** xeokit, jsPDF, xlsx, three e qrcode vão dentro do aplicativo, sem depender do CDN. Modelos que não estão no computador são baixados do site na primeira abertura e guardados. Antes de visitar um cliente, use **Arquivo → Baixar todos os modelos para uso offline**.

**Outros.** Porta local fixa (sessões e pasta vigiada não se perdem ao reabrir), várias pastas de modelos, arquivos recentes, arrastar e soltar na tela inicial, abrir `.ifc` por duplo-clique, janela lembra tamanho e posição.

## Atalhos e menus

| Atalho | Ação |
|---|---|
| F11 | Modo apresentação (tela cheia, sem menu) |
| F3 | Painel de desempenho: FPS, resolução, GPU em uso |
| Ctrl+O | Abrir IFC/XKT/GLB |
| Ctrl+H | Tela inicial |

**Desempenho → Qualidade**: *Máxima* (padrão), *Equilibrada* ou *Desempenho*. **Desempenho → Diagnóstico de GPU** mostra qual placa está em uso. Se aparecer Intel/AMD integrada num notebook com placa dedicada, confira se "Forçar GPU dedicada" está marcado e reinicie. Se o driver travar, use **Reiniciar em modo de segurança**.

## Onde ficam os dados

`%APPDATA%\BIM Viewer Desktop\`: `xkt-cache\` (IFCs convertidos, limite de 20 GB, apaga os mais antigos), `model-cache\` (modelos baixados do site) e `desktop-prefs.json`. O menu **Cache** abre e limpa essas pastas.

## Limitações

- Recursos que dependem do servidor (login real, compartilhar link, relatórios Word, colisão pela API) continuam online-only e respondem "indisponível" no aplicativo.
- O conversor IFC usa até 4 GB de memória JavaScript por arquivo (limite do Electron). IFC muito grande (acima de ~1 GB) pode não converter; nesse caso gere o XKT fora e abra o `.xkt`.
- O download automático dos modelos só funciona se os arquivos `.xkt` estiverem públicos no site. Caso contrário, use **Arquivo → Adicionar pasta de modelos** apontando para a pasta com `3D\TCE\*.xkt` etc.
- O `.exe` do Windows precisa ser gerado num Windows (ou numa CI Windows).

## Estrutura

```
desktop/
  electron/main.js           janela, menus, abrir arquivos, IPC
  electron/gpu.js            chaves de GPU, perfis de qualidade, preferência do Windows
  electron/server.js         servidor local 127.0.0.1 (site, modelos, cache, bibliotecas)
  electron/patches.js        ajustes aplicados ao código do site na hora de servir
  electron/vendor.js         substitui o CDN por cópias locais
  electron/ifc-converter.js  fila de conversão + cache
  electron/ifc-worker.js     processo que converte IFC → XKT
  electron/projects.js       catálogo de projetos e download para uso offline
  electron/preload.js        ponte segura página ↔ aplicativo
  renderer/boost.js          GPU, resolução dinâmica, painel F3, IFC nativo (roda na página)
  renderer/home.*            tela inicial
  build/installer.nsh        registra "Alto desempenho" no Windows ao instalar
  test/                      testes (npm test)
```

Teste de fumaça para desenvolvimento: `set BIMD_SMOKE=/3D/farmacia` e `npm start` abre o projeto, mede e fecha sozinho.
