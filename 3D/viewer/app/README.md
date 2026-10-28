# Módulos do visualizador autenticado

`viewer-authenticated.js` continua sendo a porta de entrada: cria o Viewer, guarda o
estado compartilhado (variáveis `let` usadas por várias áreas), registra os eventos e
chama a inicialização na mesma ordem de antes. Também ficaram nele as poucas funções
que alteram estado de várias áreas ao mesmo tempo (seleção, destaque ao passar o mouse,
carregamento de modelo, isolamento de material). As demais funções ficam nos módulos abaixo.

| Módulo | O que tem |
| --- | --- |
| `explorer.js` | Painel Explorador: abas, listas de modelos/objetos/classes/pavimentos/redes/peças, visibilidade, datas de upload, substituição de modelo |
| `performance.js` | Renderização sob demanda, modo leve (manual e automático), toque no celular, vista inicial |
| `model-loading.js` | Carregamento dos XKT em fila, seleção de projeto, endereço da página |
| `measurements.js` | Medição de ângulo e distância |
| `scene-objects.js` | IDs da cena, AABB, câmera, rotação de peças por clone |
| `ifc-meta.js` | Leitura de propriedades IFC, redes, peças, hierarquia, pavimentos |
| `materials.js` | Lista geral de materiais: classificação, quantidades, isolamento |
| `materials-panel.js` | Painel da lista de materiais |
| `web-budget.js` | Orçamento web associado aos materiais |
| `project-budget.js` | Planilha orçamentária do projeto (Escola Canaã) |
| `collision-legacy.js` | Verificação de colisões antiga (AABB) e PDF dela |
| `snapshots.js` | Capturas de tela e estado de renderização |
| `search.js` | Busca de peça por ID ou nome |
| `panels.js` | Fechar painéis, arrastar painéis |
| `help.js` | Painel de Ajuda e atalhos |
| `transform.js` | Origem e rotação de modelos |
| `access.js` | Permissões por perfil, Compatibilização BIM, Cobertura, link de interferência |
| `annotations.js` | Anotações por clique |
| `treeview-section.js` | Árvore de pavimentos (xeokit) e plano de corte |
| `entity-actions.js` | Isolar/ocultar peça, peças semelhantes, sub-rede, raio-X |
| `electrical-schedules.js` | Quadro de cargas e lista de eletrocalhas |
| `properties-panel.js` | Painel de propriedades da peça |
| `excel.js` | Carregamento sob demanda do módulo de Excel |

## Regras para mexer sem quebrar

- Uma função pode ler qualquer variável importada, mas só pode **alterar** (`=`, `++`)
  variáveis declaradas no mesmo arquivo. Se precisar alterar estado de outro módulo,
  crie uma função "setter" no módulo dono do estado.
- Nos módulos, o código fora de funções só pode declarar funções e constantes simples.
  A inicialização (chamadas `setup...()`, `addEventListener` de topo) fica no
  `viewer-authenticated.js`, na ordem certa.
- Função nova: coloque no módulo da área, com `export`, e importe onde for usar.
- Depois de mudar, rode `npm run test:viewer` e `npm run test:client-profile`.
