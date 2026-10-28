# Compatibilização BIM — XKT Geometry Clash Engine

## Auditoria e decisão

A implementação anterior enviava `ifcSrc` a `/api/clash`, que validava a extensão `.ifc` e encaminhava o pedido ao serviço configurado em `IFC_CLASH_SERVICE_URL`. O XKT servia somente à visualização e o resultado IfcClash era associado à cena por GlobalId. Isso impedia todos os projetos que preservam apenas XKT.

O fluxo padrão agora é local: os dois `src` XKT selecionados são abertos em um modelo de análise temporário, com `readableGeometryEnabled` somente durante a preparação. `SceneModelEntity.getGeometryData()` fornece os buffers CPU. O extrator aceita uma geometria ou vários chunks/meshes, normaliza `positions`/`indices` e compara o AABB dos vértices com `entity.aabb`. A transformação configurada só é aplicada quando aproxima os dois AABBs, evitando transformar duas vezes dados que o SDK já devolveu em world space. O helper `validateGeometryCoordinateSpace` permite auditar essa decisão.

O modelo temporário é invisível e destruído depois da extração. Assim, cliente não importa a feature nem carrega geometria legível; admin e colaborador só duplicam temporariamente os dois XKT escolhidos após clicar em **Executar análise**. O pico estimado é o tamanho dos dois XKT decodificados mais `12 × vértices + 4 × índices` bytes para os buffers normalizados e o clone estruturado do worker. A memória exata depende da repetição de vértices e do XKT.

## Motor geométrico

1. **Broad phase:** sweep-and-prune ordenado no eixo X, seguido por AABB em Y/Z. AABB gera candidatos, nunca clashes.
2. **Narrow phase:** cada objeto recebe uma BVH binária de triângulos, dividida no maior eixo. Apenas folhas sobrepostas executam triângulo × triângulo.
3. **Interseção:** testes segmento-triângulo de Möller–Trumbore nos seis lados e fallback coplanar por coordenadas baricêntricas. O epsilon padrão é `0.001 m`.
4. **Consolidação:** um par de objetos produz um resultado, mesmo que várias faces se interceptem. `intersectionPoints` guarda os pontos e `position` é sua média em world space. `penetrationDepth` permanece `null`.

Broad e narrow phase rodam em Web Worker ES module; mensagens de progresso mantêm a UI responsiva e Cancelar/fechar termina o worker. Somente dados simples e typed arrays são enviados, nunca instâncias xeokit. A geometria normalizada fica em cache por sessão (`modelId:objectId`); modelos temporários são descartados. Integrações que substituem modelos podem chamar `clearClashGeometryCache(modelId)`.

## Viewer, resultados e legado

Resultados usam `source: "xkt-geometry"`, IDs reais da cena e `originalSystemId` opcional. Foco ainda usa o AABB combinado somente para câmera; marcador recebe diretamente o ponto world-space, sem a antiga transformação de ponto IFC. Isolar, Contexto, navegação, status, PDF e `BCFViewpointsPlugin` continuam independentes do motor. BCF inclui IDs XKT e GUIDs originais quando presentes.

`api/clash.js` e o adaptador IfcClash foram mantidos isolados como integração legada/opcional, mas o fluxo normal XKT não chama `/api/clash` e não depende de `IFC_CLASH_SERVICE_URL`.