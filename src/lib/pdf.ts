import PDFDocument from "pdfkit";

export interface QuotePDFParams {
  customerName: string | null;
  surfaceName: string;
  measurements: string;
  squareMeters: number;
  servicesStr: string;
  estimatedBasePrice: number;
  estimatedInstallPrice: number;
  estimatedExtraPrice: number;
  estimatedTotal: number;
  currency: string;
  printFileScenario: string;
}

/**
 * Genera un PDF de presupuesto oficial de Pixel Art.
 * Retorna un Buffer listo para subir a Supabase Storage.
 */
export async function generateQuotePDF(
  params: QuotePDFParams
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ 
      size: "A4", 
      margins: { top: 50, left: 50, right: 50, bottom: 0 } 
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const W = 595.28;
    const MARGIN = 50;
    const CONTENT_W = W - MARGIN * 2;

    // Paleta de colores
    const DARK = "#1C1C3A";
    const ACCENT = "#F5A623";
    const TEXT = "#2D2D2D";
    const MUTED = "#6B7280";
    const LIGHT_BG = "#F4F4F8";
    const BORDER = "#E5E7EB";

    const date = new Date().toLocaleDateString("es-UY", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // ─── HEADER ────────────────────────────────────────────────────────────
    doc.rect(0, 0, W, 90).fill(DARK);

    doc
      .fillColor("#FFFFFF")
      .fontSize(28)
      .font("Helvetica-Bold")
      .text("PIXEL ART", MARGIN, 20);

    doc
      .fillColor(ACCENT)
      .fontSize(10)
      .font("Helvetica")
      .text("VINILOS DECORATIVOS", MARGIN, 54);

    doc
      .fillColor("#FFFFFF")
      .fontSize(11)
      .font("Helvetica-Bold")
      .text("PRESUPUESTO OFICIAL", W - MARGIN - 160, 22, {
        width: 160,
        align: "right",
      });

    doc
      .fillColor(ACCENT)
      .fontSize(9)
      .font("Helvetica")
      .text(date, W - MARGIN - 160, 42, { width: 160, align: "right" });

    doc
      .fillColor("#AAAACC")
      .fontSize(9)
      .text("Válido por 15 días", W - MARGIN - 160, 60, {
        width: 160,
        align: "right",
      });

    // ─── CLIENTE ────────────────────────────────────────────────────────────
    let y = 110;

    doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold").text("CLIENTE", MARGIN, y);
    y += 16;

    doc
      .fillColor(TEXT)
      .fontSize(15)
      .font("Helvetica-Bold")
      .text(params.customerName || "Cliente Pixel Art", MARGIN, y);
    y += 28;

    // Separador
    doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).strokeColor(BORDER).lineWidth(1).stroke();
    y += 20;

    // ─── DETALLE DEL PEDIDO ─────────────────────────────────────────────────
    doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold").text("DETALLE DEL PEDIDO", MARGIN, y);
    y += 14;

    const detailRows: Array<[string, string]> = [
      ["Tipo de trabajo", params.surfaceName],
      ["Medidas", params.measurements],
      ["Metros cuadrados", `${params.squareMeters} m²`],
      ["Servicios incluidos", params.servicesStr],
    ];

    for (const [label, value] of detailRows) {
      doc.rect(MARGIN, y, CONTENT_W, 24).fill(LIGHT_BG);

      doc.fillColor(MUTED).fontSize(9).font("Helvetica").text(label, MARGIN + 8, y + 7);

      doc
        .fillColor(TEXT)
        .fontSize(9)
        .font("Helvetica-Bold")
        .text(value, MARGIN + CONTENT_W / 2, y + 7, {
          width: CONTENT_W / 2 - 8,
          align: "right",
        });

      y += 24;
      doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).strokeColor(BORDER).lineWidth(0.5).stroke();
    }

    y += 24;

    // ─── DESGLOSE DE PRECIOS ────────────────────────────────────────────────
    doc.fillColor(MUTED).fontSize(9).font("Helvetica-Bold").text("DESGLOSE DE PRECIOS", MARGIN, y);
    y += 16;

    const priceRows: Array<[string, number]> = [
      ["Producción e impresión", params.estimatedBasePrice],
    ];

    if (params.estimatedInstallPrice > 0) {
      priceRows.push(["Servicio de instalación", params.estimatedInstallPrice]);
    }

    if (params.estimatedExtraPrice > 0) {
      const extraLabel =
        params.printFileScenario === "CUSTOM_DESIGN"
          ? "Diseño personalizado"
          : "Banco de imágenes";
      priceRows.push([extraLabel, params.estimatedExtraPrice]);
    }

    for (const [label, amount] of priceRows) {
      doc.fillColor(TEXT).fontSize(10).font("Helvetica").text(label, MARGIN, y);

      doc
        .fillColor(TEXT)
        .fontSize(10)
        .font("Helvetica-Bold")
        .text(
          `$${amount.toLocaleString("es-UY")} ${params.currency}`,
          MARGIN,
          y,
          { width: CONTENT_W, align: "right" }
        );

      y += 20;
      doc.moveTo(MARGIN, y).lineTo(W - MARGIN, y).strokeColor(BORDER).lineWidth(0.5).stroke();
      y += 10;
    }

    y += 10;

    // ─── TOTAL ──────────────────────────────────────────────────────────────
    doc.rect(MARGIN, y, CONTENT_W, 54).fill(DARK);

    doc
      .fillColor("#FFFFFF")
      .fontSize(12)
      .font("Helvetica")
      .text("TOTAL ESTIMADO", MARGIN + 16, y + 16);

    doc
      .fillColor(ACCENT)
      .fontSize(22)
      .font("Helvetica-Bold")
      .text(
        `$${params.estimatedTotal.toLocaleString("es-UY")} ${params.currency}`,
        MARGIN,
        y + 14,
        { width: CONTENT_W - 16, align: "right" }
      );

    y += 70;

    // ─── NOTAS ──────────────────────────────────────────────────────────────
    doc
      .fillColor(MUTED)
      .fontSize(8)
      .font("Helvetica")
      .text(
        "* Presupuesto estimado. Los precios finales pueden variar según condiciones de instalación y diseño definitivo.",
        MARGIN,
        y,
        { width: CONTENT_W }
      );

    y += 14;

    if (params.estimatedInstallPrice > 0) {
      doc
        .fillColor(MUTED)
        .fontSize(8)
        .text(
          "* Si elegís retirar tu pedido por el local, el servicio de instalación se descontará del total.",
          MARGIN,
          y,
          { width: CONTENT_W }
        );
      y += 14;
    }

    doc
      .fillColor(MUTED)
      .fontSize(8)
      .text(`* Válido por 15 días a partir del ${date}.`, MARGIN, y, {
        width: CONTENT_W,
      });

    // ─── FOOTER ─────────────────────────────────────────────────────────────
    const FOOTER_Y = 782;
    doc.rect(0, FOOTER_Y, W, 60).fill(DARK);

    doc
      .fillColor(ACCENT)
      .fontSize(10)
      .font("Helvetica-Bold")
      .text("PIXEL ART — Vinilos Decorativos", MARGIN, FOOTER_Y + 14);

    doc
      .fillColor("#AAAACC")
      .fontSize(8)
      .font("Helvetica")
      .text(
        "Para consultas y confirmación de pedido, respondé este chat.",
        MARGIN,
        FOOTER_Y + 32
      );

    doc.end();
  });
}
