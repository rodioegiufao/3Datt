# Map3D — módulo independente do site

Acesse `/map3d/` em qualquer hospedagem estática HTTPS (GitHub Pages/Vercel). Não exige `npm install`, Express ou novas dependências no package.json. Os recursos Cesium são carregados por CDN; serviços externos exigem internet.

## Como testar
- Publique a pasta `map3d` na raiz do repositório, junto de `3D`, `admin` e `api`.
- Abra `https://seu-dominio/map3d/`.
- Em **Mapa livre**, localize sua área; use **Selecionar área**, marque 2 cantos, escolha resolução e clique **Exportar modelo GLB**.
- O sistema baixa GLB e um arquivo auxiliar JSON com origem/coordenadas WGS84.
- Para fotos 3D, clique **Configurar 3D**, coloque chave própria da **Google Maps Platform Map Tiles API** com faturamento, API/domínios restritos, e mude para **Google 3D**. Dados Google são usados só para visualização.

## Escopo real
- Edifícios: OpenStreetMap `way[building]`, extrusão com `height`, `building:levels` ou 9 m estimados. Polígonos de contorno são recortados por bounding box, porém pátios, multipolígonos complexos e telhados inclinados não são modelados.
- Terreno: AWS Terrarium zoom 12, amostrado em grade 24, 48 ou 80. Não é topografia de projeto.
- É feita aproximação métrica local, eixo Y vertical, e os valores geográficos são preservados no JSON complementar; o próprio GLB não possui georreferenciamento global.
- Para preservar recursos, seleções limitadas a 5 m–2 km por lado e 3.000 edifícios. A área deve evitar a linha internacional de mudança de data.
- Se o serviço de elevação falhar/CORS/bloqueio, desmarque a elevação e exporte em plano. Falhas de serviços públicos de busca ou Overpass precisam ser tratadas conforme sua infraestrutura em produção.
- Busca Photon e consulta Overpass são serviços públicos de terceiros sem SLA, podem impor limites, falhar ou bloquear solicitações. Para produção pública de alto tráfego, implemente proxies, cache, controles de uso e provedores contratados.
- O módulo não toca no viewer BIM/XKT, no painel administrativo ou nas APIs existentes.

## Fontes e atribuições
- Edificações © OpenStreetMap contributors (ODbL).
- Terreno: AWS open terrain tiles / Terrarium, verificar condições de dados fonte para redistribuição.
- Google Photorealistic 3D Tiles: sujeito aos Termos Google Maps Platform; NÃO é exportado.

## Observação de implementação
O app só usa HTML, CSS e JavaScript ES Modules. `mesh.js` contém triangulação ear clipping simples; polígonos não simples são ignorados quando não trianguláveis. O mapa 3D requer WebGL e internet.


## Correção Vercel cleanUrls
Todos os assets locais usam caminhos absolutos `/map3d/...`, para funcionar tanto em `/map3d` quanto em `/map3d/`.


### API de edificações (Vercel)
A versão 1.1 usa `/api/map3d-buildings` (GET com south, west, north, east). A função deve ficar na pasta `/api` da **raiz do repositório**, não dentro de `/map3d/`. Esta rota evita consultas CORS diretas do navegador ao Overpass. Caso ocorra HTTP 502, os servidores OSM podem estar indisponíveis/saturados; tente uma seleção menor.
