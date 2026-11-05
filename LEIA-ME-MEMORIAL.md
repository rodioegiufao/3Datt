# Memorial descritivo — instalação

Copie as pastas deste zip por cima do projeto `3Datt-main`, mantendo a mesma estrutura.
Não é preciso instalar dependências novas: o projeto já usa `docxtemplater` e `pizzip`.

## Arquivos novos
- `3D/memorial_descritivo.xlsx`: regras e textos do memorial. É a planilha que você edita.
- `3D/memorial-core.js`: classificação dos materiais e montagem do conteúdo, sem acessar a página.
- `3D/memorial-export.js`: janela de geração e download do Word.
- `api/gerar-memorial-word.js`: endpoint `POST /api/gerar-memorial-word`, liberado para admin e colaborador.
- `api/_memorial-descritivo.js`: monta o XML (sumário, títulos numerados, tabelas).
- `memorial/template/Memorial-Descritivo.docx`: modelo Word no timbrado.
- `tests/memorial-descritivo.test.js`: testes.

## Arquivos alterados
Mudanças pequenas, somente acréscimos:
- `3D/viewer.html`: botão "Memorial (Word)" no painel de materiais.
- `3D/viewer/app/materials-panel.js`: liga o botão.
- `3D/viewer/app/excel.js` e `3D/viewer/features/excel.js`: carregamento lazy do módulo, no mesmo padrão do Excel.
- `3D/excel-export.js`: só acrescenta `export` em `loadWorkbookFromExcel`.
- `vercel.json`: `includeFiles` do modelo Word para a função.
- `tests/check-syntax.js`: inclui os dois arquivos novos da API.

## Como usar (um memorial por IFC)
1. Abra o IFC no viewer. Abra o painel de **Materiais** e clique em **Gerar lista**.
2. Clique em **Memorial (Word)**. A janela já vem preenchida com os dados do IFC:
   - **Obra**: nome do IfcProject. Se ele estiver vazio ou com nome genérico, como "Project Name",
     usa o IfcBuilding, depois o IfcSite e por último o nome do projeto no site.
   - **Disciplina**: nome do modelo, por exemplo "Instalações elétricas — 380 V".
   - Entram só os materiais e as quantidades **desse IFC**.
   Se houver mais de um modelo aberto, aparece um seletor "Modelo IFC" para escolher qual.
3. Confira os campos e clique em **Gerar Word**. O arquivo sai como `memorial-descritivo-<obra>-<disciplina>-<revisão>.docx`.
3. Ao abrir no Word, aceite **atualizar os campos**. É isso que coloca os números de página no sumário.

A janela avisa quais materiais ficaram de fora por não terem regra. Para incluí-los,
acrescente uma linha na aba **Classificacao** da planilha.

## Personalizar
- **Textos, seções, normas e regras**: edite `3D/memorial_descritivo.xlsx`. A aba Leia-me explica cada coluna.
- **Capa, cabeçalho, assinatura e títulos fixos**: edite `memorial/template/Memorial-Descritivo.docx` no Word.
  Os marcadores `[OBRA]`, `[DISCIPLINA]`, `[REVISAO]`, `[LOCAL_CAPA]`, `[DATA_EMISSAO]` e `[@...]` precisam continuar existindo.
  Cada marcador `[@...]` deve ficar sozinho no seu parágrafo.
