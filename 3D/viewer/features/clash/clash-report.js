// Relatório de Compatibilização BIM em PDF (A4 paisagem)
// Página 1+: capa com dados da análise e tabela-resumo.
// Uma página por interferência: imagem no modo isolamento + dados dos dois elementos.

const PAGE = { w: 297, h: 210, m: 14 };
const COLOR = {
    ink: [26, 28, 32],
    muted: [104, 110, 120],
    line: [222, 225, 230],
    soft: [245, 246, 248],
    band: [26, 28, 32],
    bandText: [236, 238, 241],
    a: [245, 196, 0],     // amarelo = Grupo A (mesma cor da peça na imagem)
    b: [235, 60, 20],     // vermelho = Grupo B
    pin: [229, 57, 53]
};

const STATUS_COLORS = {
    Novo: [229, 57, 53],
    "Em análise": [242, 160, 40],
    Aceito: [60, 130, 220],
    Resolvido: [34, 160, 90],
    Ignorado: [130, 136, 146]
};

// As fontes padrão do PDF não têm alguns símbolos: troca por equivalentes seguros
const clean = (value) => String(value ?? "")
    .replace(/[•·]/g, "-")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[^\x00-\xFF]/g, "");

const fmtNumber = (n, digits = 3) => Number(n).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// QR code (biblioteca carregada só na hora de gerar o relatório; sem ela o PDF sai só com o link)
let qrFactoryPromise = null;
function loadQrFactory() {
    if (!qrFactoryPromise) {
        qrFactoryPromise = import("https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm")
            .then((mod) => mod.default || mod.qrcode || mod)
            .catch((error) => {
                console.warn("[Relatório] QR code indisponível:", error);
                return null;
            });
    }
    return qrFactoryPromise;
}

function drawQr(doc, qrFactory, text, x, y, size) {
    if (!qrFactory || !text) return false;
    try {
        const qr = qrFactory(0, "L");
        qr.addData(text);
        qr.make();
        const count = qr.getModuleCount();
        const cell = size / count;
        setColor(doc, "fill", [255, 255, 255]);
        doc.rect(x, y, size, size, "F");
        setColor(doc, "fill", COLOR.ink);
        for (let r = 0; r < count; r++) {
            for (let c = 0; c < count; c++) {
                if (qr.isDark(r, c)) doc.rect(x + c * cell, y + r * cell, cell + 0.01, cell + 0.01, "F");
            }
        }
        return true;
    } catch (error) {
        console.warn("[Relatório] Falha ao desenhar QR code:", error);
        return false;
    }
}

function setColor(doc, kind, rgb) {
    if (kind === "fill") doc.setFillColor(...rgb);
    else if (kind === "draw") doc.setDrawColor(...rgb);
    else doc.setTextColor(...rgb);
}

function fitText(doc, text, maxWidth) {
    const value = clean(text);
    if (doc.getTextWidth(value) <= maxWidth) return value;
    let cut = value;
    while (cut.length > 1 && doc.getTextWidth(`${cut}...`) > maxWidth) cut = cut.slice(0, -1);
    return `${cut}...`;
}

function objectTitle(object) {
    return object.name && object.name !== object.type ? object.name : object.type;
}

function describeRow(object) {
    const title = objectTitle(object);
    const model = object.modelLabel || object.modelId;
    return title === object.type ? `${object.type} - ${model}` : `${title} (${object.type}) - ${model}`;
}

function drawFooter(doc, meta, pageNumber, pageCount) {
    const y = PAGE.h - 8;
    setColor(doc, "draw", COLOR.line);
    doc.setLineWidth(0.2);
    doc.line(PAGE.m, y - 4, PAGE.w - PAGE.m, y - 4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    setColor(doc, "text", COLOR.muted);
    doc.text(clean(`${meta.project}  |  Gerado em ${meta.generatedAt}`), PAGE.m, y);
    doc.text(clean(meta.author), PAGE.w / 2, y, { align: "center" });
    doc.text(`Página ${pageNumber} de ${pageCount}`, PAGE.w - PAGE.m, y, { align: "right" });
}

function drawStatusPill(doc, status, xRight, y) {
    const label = clean(status);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    const w = doc.getTextWidth(label) + 8;
    setColor(doc, "fill", STATUS_COLORS[status] || COLOR.muted);
    doc.roundedRect(xRight - w, y - 4.2, w, 6.2, 3.1, 3.1, "F");
    setColor(doc, "text", [255, 255, 255]);
    doc.text(label, xRight - w / 2, y, { align: "center" });
}

function drawSwatch(doc, rgb, x, y, size = 3.2) {
    setColor(doc, "fill", rgb);
    doc.roundedRect(x, y - size + 0.4, size, size, 0.6, 0.6, "F");
}

// ---------------------------------------------------------------------------
// Capa + tabela-resumo
// ---------------------------------------------------------------------------
function drawCover(doc, meta, clashes, firstClashPage) {
    const { m } = PAGE;

    setColor(doc, "fill", COLOR.band);
    doc.rect(0, 0, PAGE.w, 38, "F");
    setColor(doc, "text", COLOR.bandText);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.text("Relatório de Compatibilização BIM", m, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10.5);
    doc.text(clean(meta.project), m, 27);

    // Bloco de dados da análise
    const facts = [
        ["Grupo A", meta.groupA, COLOR.a],
        ["Grupo B", meta.groupB, COLOR.b],
        ["Tipo de análise", meta.modeLabel],
        [meta.mode === "clearance" ? "Distância mínima" : "Precisão geométrica", `${fmtNumber(meta.tolerance, 3)} m`],
        ["Interferências no relatório", String(clashes.length)],
        ["Data", meta.generatedAt]
    ];
    let y = 50;
    const colW = (PAGE.w - 2 * m) / 3;
    facts.forEach(([label, value, swatch], i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = m + col * colW;
        const yy = y + row * 15;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(doc, "text", COLOR.muted);
        doc.text(clean(label), x, yy);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(11);
        setColor(doc, "text", COLOR.ink);
        let tx = x;
        if (swatch) {
            drawSwatch(doc, swatch, x, yy + 5.6, 3.4);
            tx += 5.5;
        }
        doc.text(fitText(doc, value, colW - 8 - (tx - x)), tx, yy + 6);
    });

    // Tabela-resumo
    y = 88;
    const cols = [
        { key: "n", label: "Nº", w: 12 },
        { key: "a", label: "Elemento A", w: 103 },
        { key: "b", label: "Elemento B", w: 103 },
        { key: "status", label: "Status", w: 26 },
        { key: "page", label: "Página", w: PAGE.w - 2 * m - 12 - 103 - 103 - 26 }
    ];
    const rowH = 7.2;
    const tableBottom = PAGE.h - 18;

    const drawHeader = (top) => {
        setColor(doc, "fill", COLOR.soft);
        doc.rect(m, top, PAGE.w - 2 * m, rowH, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        setColor(doc, "text", COLOR.muted);
        let x = m + 2;
        cols.forEach((c) => {
            doc.text(c.label, x, top + 4.8);
            x += c.w;
        });
        return top + rowH;
    };

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setColor(doc, "text", COLOR.ink);
    doc.text("Resumo das interferências", m, y - 4);
    y = drawHeader(y);

    const coverPages = [];
    clashes.forEach((clash, i) => {
        if (y + rowH > tableBottom) {
            coverPages.push(doc.getNumberOfPages());
            doc.addPage();
            y = drawHeader(PAGE.m);
        }
        const values = {
            n: String(i + 1),
            a: describeRow(clash.objectA),
            b: describeRow(clash.objectB),
            status: clash.statusLabel,
            page: String(firstClashPage + i)
        };
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        let x = m + 2;
        cols.forEach((c) => {
            if (c.key === "a" || c.key === "b") {
                drawSwatch(doc, c.key === "a" ? COLOR.a : COLOR.b, x, y + 4.9, 2.6);
                setColor(doc, "text", COLOR.ink);
                doc.text(fitText(doc, values[c.key], c.w - 9), x + 4, y + 4.8);
            } else if (c.key === "status") {
                setColor(doc, "fill", STATUS_COLORS[clash.statusLabel] || COLOR.muted);
                doc.circle(x + 1.2, y + 3.7, 1.1, "F");
                setColor(doc, "text", COLOR.ink);
                doc.text(clean(values.status), x + 4, y + 4.8);
            } else {
                setColor(doc, "text", c.key === "page" ? COLOR.muted : COLOR.ink);
                doc.text(values[c.key], x, y + 4.8);
            }
            x += c.w;
        });
        // Link da linha para a página da interferência
        doc.link(m, y, PAGE.w - 2 * m, rowH, { pageNumber: firstClashPage + i });
        setColor(doc, "draw", COLOR.line);
        doc.setLineWidth(0.15);
        doc.line(m, y + rowH, PAGE.w - m, y + rowH);
        y += rowH;
    });

    // Legenda de cores
    if (y + 12 < tableBottom) {
        y += 8;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(doc, "text", COLOR.muted);
        drawSwatch(doc, COLOR.a, m, y, 3);
        doc.text("Elemento do Grupo A (amarelo na imagem)", m + 5, y);
        drawSwatch(doc, COLOR.b, m + 75, y, 3);
        doc.text("Elemento do Grupo B (vermelho na imagem)", m + 80, y);
        doc.text("Clique em uma linha para ir até a interferência. Cada página tem um link para abri-la no 3D.", PAGE.w - m, y, { align: "right" });
    }
}

// Quantas páginas a capa vai ocupar (para numerar os links antes de desenhar)
function coverPageCount(count) {
    const rowH = 7.2;
    const firstPageRows = Math.floor((PAGE.h - 18 - (88 + rowH)) / rowH);
    const otherPageRows = Math.floor((PAGE.h - 18 - (PAGE.m + rowH)) / rowH);
    if (count <= firstPageRows) return 1;
    return 1 + Math.ceil((count - firstPageRows) / otherPageRows);
}

// ---------------------------------------------------------------------------
// Página de uma interferência
// ---------------------------------------------------------------------------
function drawObjectBlock(doc, label, rgb, object, x, y, w) {
    drawSwatch(doc, rgb, x, y, 3.4);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, "text", COLOR.muted);
    doc.text(clean(label), x + 5.5, y);
    y += 6;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    setColor(doc, "text", COLOR.ink);
    const titleLines = doc.splitTextToSize(clean(objectTitle(object)), w).slice(0, 2);
    doc.text(titleLines, x, y);
    y += titleLines.length * 4.8 + 1.5;

    const rows = [
        ["Classe IFC", object.type],
        ["Modelo", object.modelLabel || object.modelId],
        ["ID", object.originalSystemId || object.objectId]
    ];
    rows.forEach(([k, v]) => {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        setColor(doc, "text", COLOR.muted);
        doc.text(k, x, y);
        doc.setFontSize(9);
        setColor(doc, "text", COLOR.ink);
        const lines = doc.splitTextToSize(clean(v), w).slice(0, 2);
        doc.text(lines, x, y + 4);
        y += 4 + lines.length * 4 + 2.5;
    });
    return y;
}

function drawClashPage(doc, meta, clash, index, total, image, url, qrFactory) {
    const { m } = PAGE;

    // Faixa de título
    setColor(doc, "fill", COLOR.band);
    doc.rect(0, 0, PAGE.w, 18, "F");
    setColor(doc, "text", COLOR.bandText);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    const heading = `Interferência ${index + 1} de ${total}`;
    doc.text(heading, m, 11.5);
    const headingW = doc.getTextWidth(heading);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    setColor(doc, "text", [170, 176, 186]);
    doc.text(clean(meta.modeLabel), m + headingW + 5, 11.5);
    drawStatusPill(doc, clash.statusLabel, PAGE.w - m, 11.2);

    // Imagem (4:3)
    const imgX = m;
    const imgY = 26;
    const imgW = 190;
    const imgH = imgW * 3 / 4;
    if (image) {
        doc.addImage(image, "JPEG", imgX, imgY, imgW, imgH, undefined, "FAST");
    } else {
        setColor(doc, "fill", COLOR.soft);
        doc.rect(imgX, imgY, imgW, imgH, "F");
        doc.setFontSize(9);
        setColor(doc, "text", COLOR.muted);
        doc.text("Imagem indisponível para esta interferência.", imgX + imgW / 2, imgY + imgH / 2, { align: "center" });
    }
    setColor(doc, "draw", COLOR.line);
    doc.setLineWidth(0.3);
    doc.rect(imgX, imgY, imgW, imgH);
    if (url) doc.link(imgX, imgY, imgW, imgH, { url });

    // Legenda sob a imagem
    let ly = imgY + imgH + 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    setColor(doc, "text", COLOR.muted);
    doc.text("Modo isolamento: só os dois elementos em conflito ficam visíveis.", imgX, ly);
    const pos = Array.isArray(clash.position) && clash.position.length === 3
        ? clash.position.map((n) => fmtNumber(n, 3)).join("  /  ")
        : "-";
    doc.text(clean(`Posição X / Y / Z (m): ${pos}`), imgX + imgW, ly, { align: "right" });

    // Coluna de dados
    const colX = imgX + imgW + 9;
    const colW = PAGE.w - m - colX;
    let y = imgY + 3;
    y = drawObjectBlock(doc, "ELEMENTO A", COLOR.a, clash.objectA, colX, y, colW);
    setColor(doc, "draw", COLOR.line);
    doc.setLineWidth(0.2);
    doc.line(colX, y, colX + colW, y);
    y += 7;
    y = drawObjectBlock(doc, "ELEMENTO B", COLOR.b, clash.objectB, colX, y, colW);

    // Link para abrir a interferência isolada no visualizador
    if (url) {
        setColor(doc, "draw", COLOR.line);
        doc.setLineWidth(0.2);
        doc.line(colX, y, colX + colW, y);
        y += 5;
        const qrSize = 28;
        const hasQr = drawQr(doc, qrFactory, url, colX, y, qrSize);
        const tx = hasQr ? colX + qrSize + 4 : colX;
        const tw = colX + colW - tx;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8);
        setColor(doc, "text", COLOR.muted);
        doc.text("ABRIR NO 3D", tx, y + 3.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        setColor(doc, "text", COLOR.ink);
        const help = doc.splitTextToSize(hasQr
            ? "Escaneie ou clique para ver esta interferência isolada no visualizador."
            : "Clique para ver esta interferência isolada no visualizador.", tw);
        doc.text(help, tx, y + 8);
        const linkY = y + 8 + help.length * 3.6 + 2;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        setColor(doc, "text", [37, 99, 235]);
        doc.textWithLink("Abrir interferência", tx, linkY, { url });
        const lw = doc.getTextWidth("Abrir interferência");
        setColor(doc, "draw", [37, 99, 235]);
        doc.setLineWidth(0.2);
        doc.line(tx, linkY + 0.8, tx + lw, linkY + 0.8);
        if (hasQr) doc.link(colX, y, qrSize, qrSize, { url });
        y += Math.max(hasQr ? qrSize : 0, linkY - y + 2) + 6;
    }

    // Observações (para anotar à mão ou no leitor de PDF): na coluna se couber, senão sob a imagem
    const columnBottom = imgY + imgH;
    const notesTop = y + 2;
    setColor(doc, "draw", COLOR.line);
    doc.setLineWidth(0.2);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    setColor(doc, "text", COLOR.muted);
    if (columnBottom - notesTop > 18) {
        doc.text("OBSERVAÇÕES", colX, notesTop);
        for (let ny = notesTop + 7; ny <= columnBottom; ny += 6.5) doc.line(colX, ny, colX + colW, ny);
    } else {
        const top = ly + 8;
        doc.text("OBSERVAÇÕES", imgX, top);
        for (let ny = top + 6; ny <= PAGE.h - 16; ny += 6.5) doc.line(imgX, ny, PAGE.w - m, ny);
    }
}

/**
 * @param {object} options
 * @param {Function} options.jsPDF construtor do jsPDF
 * @param {Array} options.clashes interferências (com statusLabel)
 * @param {Function} options.capture async (clash, index) => dataURL JPEG | null
 * @param {object} options.meta dados da análise
 * @param {Function} [options.onProgress] (atual, total)
 */
export async function buildClashReport({ jsPDF, clashes, capture, meta, onProgress = () => {}, signal }) {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    doc.setProperties({
        title: clean(`Compatibilização BIM - ${meta.project}`),
        subject: clean(`${meta.groupA} x ${meta.groupB}`),
        author: clean(meta.author),
        creator: "Visualizador BIM"
    });

    const qrFactory = await loadQrFactory();
    const firstClashPage = coverPageCount(clashes.length) + 1;
    drawCover(doc, meta, clashes, firstClashPage);

    for (let i = 0; i < clashes.length; i++) {
        if (signal?.aborted) throw new DOMException("Cancelado", "AbortError");
        onProgress(i + 1, clashes.length);
        const shot = await capture(clashes[i], i).catch((error) => {
            console.warn("[Relatório] Falha ao capturar imagem", error);
            return null;
        });
        const image = typeof shot === "string" ? shot : shot?.image || null;
        const url = typeof shot === "object" ? shot?.url || null : null;
        doc.addPage();
        drawClashPage(doc, meta, clashes[i], i, clashes.length, image, url, qrFactory);
    }

    const pageCount = doc.getNumberOfPages();
    for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p);
        drawFooter(doc, meta, p, pageCount);
    }
    return doc;
}
