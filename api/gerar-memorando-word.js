const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle
} = require("docx");
const { parseRequestBody, requireInternalUser, sendJson } = require("./_auth");

const FONTE_PADRAO = "Arial";
const LARGURA_MAXIMA_IMAGEM_PX = 520;

const SUGESTOES_TIPO_ASSUNTO = {
  "Subestação": {
    tituloMemo: "MEMORANDO DE DIRETRIZES PARA SUBESTAÇÃO",
    objetivo: "O presente memorando tem por objetivo apresentar as diretrizes e solicitações necessárias para definição e compatibilização da área destinada à subestação, considerando os requisitos técnicos do projeto elétrico, as condições arquitetônicas e as necessidades de operação e manutenção.",
    diretrizGeral: "As soluções relacionadas à subestação deverão observar os requisitos técnicos de acesso, ventilação, operação, manutenção, segurança, afastamentos mínimos, compatibilização arquitetônica e atendimento às normas aplicáveis.",
    consideracoesFinais: "As informações apresentadas neste memorando deverão ser consideradas como premissas técnicas para a definição, compatibilização e consolidação da solução referente à subestação. Recomenda-se que as adequações indicadas sejam avaliadas em conjunto com os projetos de arquitetura, instalações elétricas e demais disciplinas envolvidas, de modo a garantir o atendimento aos requisitos técnicos, operacionais, normativos e de manutenção. Após a definição da solução, os projetos complementares deverão ser atualizados antes da emissão final."
  },
  "Definição de shafts": {
    tituloMemo: "MEMORANDO DE DEFINIÇÃO DE SHAFTS",
    objetivo: "O presente memorando tem por objetivo solicitar a definição e compatibilização dos shafts necessários ao encaminhamento das instalações, de modo a garantir espaços técnicos adequados para passagem, inspeção, manutenção e integração entre as disciplinas de projeto.",
    diretrizGeral: "Os shafts deverão ser definidos considerando o espaço necessário para passagem das instalações, possibilidade de inspeção e manutenção, compatibilização com elementos estruturais e arquitetônicos, além da integração com as demais disciplinas complementares.",
    consideracoesFinais: "As definições apresentadas neste memorando deverão ser consideradas como referência para a locação, dimensionamento e compatibilização dos shafts necessários ao encaminhamento das instalações. Recomenda-se que as áreas técnicas indicadas sejam validadas junto aos projetos de arquitetura e demais disciplinas, a fim de evitar interferências com elementos estruturais, circulações, ambientes de uso e sistemas complementares. A consolidação dos shafts deverá ocorrer antes da emissão final dos projetos."
  },
  "Solicitação de alteração de locais de equipamentos e objetos": {
    tituloMemo: "MEMORANDO DE SOLICITAÇÃO DE ALTERAÇÃO DE LOCALIZAÇÃO",
    objetivo: "O presente memorando tem por objetivo solicitar a avaliação e alteração de localização de equipamentos e elementos de projeto, visando compatibilizar as soluções técnicas com as condições arquitetônicas, operacionais e de manutenção.",
    diretrizGeral: "As alterações de localização deverão ser analisadas de forma integrada, considerando interferências com arquitetura, estrutura, circulação, acessibilidade, manutenção, operação e demais sistemas técnicos previstos no empreendimento.",
    consideracoesFinais: "As alterações indicadas neste memorando deverão ser avaliadas e compatibilizadas com os projetos envolvidos, considerando os impactos sobre acessibilidade, operação, manutenção, circulação, infraestrutura técnica e interferências com demais disciplinas. Recomenda-se que os novos posicionamentos sejam validados previamente à atualização das pranchas, de forma a evitar retrabalhos e garantir coerência entre arquitetura, instalações e demais projetos complementares."
  },
  "Solicitação de alturas de trabalho de projetos de instalação": {
    tituloMemo: "MEMORANDO DE DEFINIÇÃO DE ALTURAS DE INSTALAÇÃO",
    objetivo: "O presente memorando tem por objetivo solicitar a definição ou confirmação das alturas de instalação dos elementos técnicos previstos em projeto, garantindo compatibilização entre arquitetura, instalações, operação, manutenção e execução.",
    diretrizGeral: "As alturas de instalação deverão ser definidas de modo compatível com os critérios de uso, operação, manutenção, ergonomia, segurança, estética, acessibilidade e viabilidade executiva.",
    consideracoesFinais: "As alturas de instalação indicadas neste memorando deverão ser avaliadas e confirmadas pelas disciplinas envolvidas, considerando critérios de operação, manutenção, acessibilidade, ergonomia, segurança, normas técnicas aplicáveis e compatibilização com o projeto arquitetônico. Recomenda-se que as alturas definidas sejam incorporadas aos projetos antes da emissão final, evitando divergências entre documentação gráfica, memoriais e execução em obra."
  },
  "Outro": {
    tituloMemo: "MEMORANDO TÉCNICO",
    objetivo: "O presente memorando tem por objetivo formalizar diretrizes, solicitações e observações técnicas necessárias à compatibilização e consolidação das soluções de projeto.",
    diretrizGeral: "As informações apresentadas deverão ser analisadas pelas disciplinas envolvidas, considerando a compatibilização entre os projetos, as condições de execução, manutenção, operação e atendimento aos requisitos técnicos aplicáveis.",
    consideracoesFinais: "As informações apresentadas neste memorando deverão ser analisadas pelas disciplinas envolvidas e consideradas na compatibilização dos projetos. Recomenda-se que os ajustes necessários sejam validados previamente à emissão final, garantindo coerência entre as soluções adotadas, os documentos técnicos e as condições de execução."
  }
};

function textoLimpo(valor) {
  return String(valor || "").trim();
}

function normalizarCodigoMemo(codigoSetor, numeroMemorando, anoMemorando) {
  const set = textoLimpo(codigoSetor).toUpperCase();
  const xyx = textoLimpo(numeroMemorando).padStart(3, "0");
  const abc = textoLimpo(anoMemorando);
  return { set, xyx, abc, codigoCompleto: `MEMO-${set}-${xyx}-${abc}` };
}

function validarBody(body) {
  const obrigatorios = ["codigoSetor", "numeroMemorando", "anoMemorando", "setorOrigem", "setorDestino", "assunto", "tipoAssunto", "problema", "descricaoProblema", "data", "nomeResponsavel"];
  const faltando = obrigatorios.filter((campo) => !textoLimpo(body[campo]));

  if (faltando.length) {
    const error = new Error(`Campos obrigatórios ausentes: ${faltando.join(", ")}.`);
    error.statusCode = 400;
    throw error;
  }

  const { abc } = normalizarCodigoMemo(body.codigoSetor, body.numeroMemorando, body.anoMemorando);
  if (!/^\d{4}$/.test(abc)) {
    const error = new Error("O ano do memorando deve ter 4 dígitos.");
    error.statusCode = 400;
    throw error;
  }
}

function obterSugestao(tipoAssunto) {
  return SUGESTOES_TIPO_ASSUNTO[textoLimpo(tipoAssunto)] || SUGESTOES_TIPO_ASSUNTO.Outro;
}

function montarDadosMemo(body) {
  const sugestao = obterSugestao(body.tipoAssunto);
  const codigo = normalizarCodigoMemo(body.codigoSetor, body.numeroMemorando, body.anoMemorando);

  return {
    codigoCompleto: codigo.codigoCompleto,
    set: codigo.set,
    xyx: codigo.xyx,
    abc: codigo.abc,
    setorOrigem: textoLimpo(body.setorOrigem),
    setorDestino: textoLimpo(body.setorDestino),
    assunto: textoLimpo(body.assunto),
    tipoAssunto: textoLimpo(body.tipoAssunto),
    tituloMemo: textoLimpo(body.tituloMemo) || sugestao.tituloMemo,
    objetivo: textoLimpo(body.objetivo) || sugestao.objetivo,
    diretrizGeral: textoLimpo(body.diretrizGeral) || sugestao.diretrizGeral,
    problema: textoLimpo(body.problema),
    descricaoProblema: textoLimpo(body.descricaoProblema),
    consideracoesFinais: textoLimpo(body.consideracoesFinais) || sugestao.consideracoesFinais,
    data: textoLimpo(body.data),
    nomeResponsavel: textoLimpo(body.nomeResponsavel),
    email: textoLimpo(body.email),
    numero: textoLimpo(body.numero),
    imagens: Array.isArray(body.imagens) ? body.imagens : []
  };
}

function criarRun(texto, options = {}) {
  return new TextRun({
    text: String(texto || ""),
    font: FONTE_PADRAO,
    size: options.size || 22,
    bold: Boolean(options.bold),
    italics: Boolean(options.italic)
  });
}

function criarParagrafoTexto(texto, options = {}) {
  const linhas = String(texto || "").split(/\r?\n/);
  return new Paragraph({
    children: linhas.flatMap((linha, index) => (index === 0 ? [criarRun(linha, options)] : [new TextRun({ break: 1 }), criarRun(linha, options)])),
    alignment: options.alignment || AlignmentType.JUSTIFIED,
    spacing: { before: options.before || 0, after: options.after ?? 160, line: options.line || 276 },
    indent: options.firstLine === false ? undefined : { firstLine: options.firstLine ?? 360 }
  });
}

function criarTitulo(texto, nivel = 1) {
  return new Paragraph({
    heading: nivel === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [criarRun(texto, { bold: true, size: nivel === 1 ? 24 : 22 })]
  });
}

function criarLinhaCabecalho(rotulo, valor) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 18, type: WidthType.PERCENTAGE },
        borders: bordasSemLinha(),
        children: [criarParagrafoTexto(rotulo, { bold: true, firstLine: false, after: 60, alignment: AlignmentType.LEFT })]
      }),
      new TableCell({
        width: { size: 82, type: WidthType.PERCENTAGE },
        borders: bordasSemLinha(),
        children: [criarParagrafoTexto(valor, { firstLine: false, after: 60, alignment: AlignmentType.LEFT })]
      })
    ]
  });
}

function bordasSemLinha() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }
  };
}

function normalizarImagemBase64ParaDocx(valor) {
  const texto = String(valor || "").trim();
  const match = texto.match(/^data:image\/(png|jpe?g);base64,([\s\S]+)$/i);
  if (!match) return null;

  const tipo = match[1].toLowerCase();
  const extension = tipo === "png" ? "png" : "jpg";
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");

  return { buffer, extension };
}

function dimensoesImagem(buffer, extension) {
  if (extension === "png" && buffer.length >= 24) return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  if (extension === "jpg") {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) break;
      if (marker >= 0xc0 && marker <= 0xc3) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      offset += 2 + length;
    }
  }
  return { width: 1200, height: 800 };
}

function calcularTamanhoImagem(buffer, extension, larguraMaxima = LARGURA_MAXIMA_IMAGEM_PX) {
  const { width, height } = dimensoesImagem(buffer, extension);
  if (!width || !height) return { width: larguraMaxima, height: 300 };
  const ratio = Math.min(larguraMaxima / width, 1);
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

function criarImagemRun(base64, larguraMaximaPx = LARGURA_MAXIMA_IMAGEM_PX) {
  const normalizada = normalizarImagemBase64ParaDocx(base64);
  if (!normalizada?.buffer?.length) return null;

  const transformation = calcularTamanhoImagem(normalizada.buffer, normalizada.extension, larguraMaximaPx);
  return new ImageRun({
    data: normalizada.buffer,
    transformation
  });
}

function criarBlocoImagensDocx(imagens) {
  const children = [];
  const lista = Array.isArray(imagens) ? imagens : [];
  let contador = 0;

  lista.forEach((imagem) => {
    const arquivo = imagem?.arquivo || imagem?.base64 || imagem;
    const imageRun = criarImagemRun(arquivo);
    if (!imageRun) return;

    contador += 1;
    const titulo = textoLimpo(imagem?.titulo) || `Figura ${contador} — Imagem do projeto`;
    const descricao = textoLimpo(imagem?.descricao);

    children.push(criarParagrafoTexto(titulo, { bold: true, firstLine: false, before: contador === 1 ? 120 : 260, after: 100, alignment: AlignmentType.CENTER }));
    children.push(new Paragraph({ children: [imageRun], alignment: AlignmentType.CENTER, spacing: { after: 120 } }));
    if (descricao) children.push(criarParagrafoTexto(descricao, { italic: true, firstLine: false, after: 220, alignment: AlignmentType.JUSTIFIED }));
  });

  if (!contador) children.push(criarParagrafoTexto("Não foram inseridas imagens do projeto.", { firstLine: false, before: 120, after: 180 }));
  return children;
}

function criarMemorandoDocx(dados) {
  const children = [
    criarParagrafoTexto("Ribeiro Lopes Consultoria E Serviços", { bold: true, firstLine: false, after: 120, alignment: AlignmentType.LEFT }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: bordasSemLinha(),
      rows: [
        criarLinhaCabecalho("De:", dados.setorOrigem),
        criarLinhaCabecalho("Para:", dados.setorDestino),
        criarLinhaCabecalho("Assunto:", dados.assunto)
      ]
    }),
    criarParagrafoTexto(dados.codigoCompleto, { bold: true, size: 24, firstLine: false, before: 360, after: 180, alignment: AlignmentType.CENTER }),
    criarParagrafoTexto(dados.tituloMemo, { bold: true, size: 24, firstLine: false, after: 180, alignment: AlignmentType.CENTER }),
    criarParagrafoTexto(dados.objetivo),
    criarParagrafoTexto(`PARA: ${dados.setorDestino}`, { bold: true, firstLine: false, before: 120, after: 180, alignment: AlignmentType.LEFT }),
    criarTitulo("1. Diretriz Geral de Instalações", 2),
    criarParagrafoTexto(dados.diretrizGeral),
    criarTitulo(`2. ${dados.problema}`, 2),
    criarParagrafoTexto(dados.descricaoProblema),
    ...criarBlocoImagensDocx(dados.imagens),
    criarTitulo("3. Considerações Finais", 2),
    criarParagrafoTexto(dados.consideracoesFinais),
    criarParagrafoTexto(`Data: ${dados.data}`, { firstLine: false, before: 260, after: 260, alignment: AlignmentType.LEFT }),
    criarParagrafoTexto("Atenciosamente", { firstLine: false, after: 260, alignment: AlignmentType.LEFT }),
    criarParagrafoTexto(`${dados.setorOrigem} - ${dados.set}`, { bold: true, firstLine: false, after: 80, alignment: AlignmentType.LEFT }),
    criarParagrafoTexto(dados.nomeResponsavel, { firstLine: false, after: 80, alignment: AlignmentType.LEFT }),
    criarParagrafoTexto(`Email: ${dados.email}`, { firstLine: false, after: 80, alignment: AlignmentType.LEFT }),
    criarParagrafoTexto(`WhatsApp: ${dados.numero}`, { firstLine: false, after: 80, alignment: AlignmentType.LEFT })
  ];

  return new Document({
    styles: {
      default: {
        document: { run: { font: FONTE_PADRAO, size: 22 } }
      }
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      children
    }]
  });
}

module.exports = async function gerarMemorandoWordHandler(req, res) {
  try {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Método não suportado." });
      return;
    }

    await requireInternalUser(req);

    const body = parseRequestBody(req);
    validarBody(body);

    const dados = montarDadosMemo(body);
    const doc = criarMemorandoDocx(dados);

    const buffer = await Packer.toBuffer(doc);

    const dataArquivo = new Date().toISOString().slice(0, 10);
    const filename = `memorando-${dados.codigoCompleto}-${dataArquivo}.docx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (error) {
    console.error("Erro ao gerar memorando Word:", error);
    sendJson(res, error.statusCode || 500, {
      error: error.message || "Erro interno ao gerar memorando Word."
    });
  }
};

module.exports.normalizarCodigoMemo = normalizarCodigoMemo;
module.exports.SUGESTOES_TIPO_ASSUNTO = SUGESTOES_TIPO_ASSUNTO;
module.exports._internals = {
  montarDadosMemo,
  criarParagrafoTexto,
  criarTitulo,
  criarLinhaCabecalho,
  criarImagemRun,
  normalizarImagemBase64ParaDocx,
  dimensoesImagem,
  calcularTamanhoImagem,
  criarBlocoImagensDocx,
  criarMemorandoDocx
};
