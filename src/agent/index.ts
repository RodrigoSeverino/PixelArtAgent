import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { supabase } from "@/lib/supabase";
import { getConversationHistory } from "@/lib/redis";
import { generateQuotePDF } from "@/lib/pdf";
import { uploadAsset } from "@/lib/storage";
import { getGuideImageUrl } from "@/lib/guides";
import type { IncomingMessage, AgentResponse, LeadContext } from "./types";
import { buildSystemPrompt } from "./system-prompt";
import { calculateQuote } from "@/lib/pricing";
import { SURFACE_LABELS, type SurfaceType } from "@/types/surface";
import type { PrintFileScenario } from "@/types/quote";

/**
 * Intenta extraer medidas (W y H) de un texto cualquiera usando Regex.
 * Soporta formatos: "2x1", "2 x 1", "2mts x 1mts", "2.5m x 1.8m", etc.
 */
function extractMeasurementsFromText(
  text: string
): { w: number; h: number } | null {
  const num = `(\\d+(?:[.,]\\d+)?)`;
  const unit = `\\s*(?:mts?|metr[oa]s?|mt|m|cm)?\\s*`;
  const sep = `(?:x|por|\\*|,)`;

  const regex = new RegExp(`${num}${unit}${sep}${unit}${num}${unit}`, "i");
  const match = text.match(regex);

  if (match) {
    let w = parseFloat(match[1].replace(",", "."));
    let h = parseFloat(match[2].replace(",", "."));

    const lowerText = text.toLowerCase();

    if (
      (lowerText.includes("cm") ||
        lowerText.includes("centimetro") ||
        lowerText.includes("centímetro") ||
        lowerText.includes("centimetros") ||
        lowerText.includes("centímetros")) &&
      w > 10
    ) {
      w = w / 100;
      h = h / 100;
    }

    return w > 0 && h > 0 ? { w, h } : null;
  }

  return null;
}

function extractSurfaceFromText(text: string): { type: string; full: boolean } | null {
  const t = text.toLowerCase();
  
  const mapping: Record<string, string> = {
    pared: "WALL",
    wall: "WALL",
    muro: "WALL",
    madera: "WOOD",
    wood: "WOOD",
    placa: "WOOD",
    vidrio: "GLASS",
    ventana: "GLASS",
    glass: "GLASS",
    cristal: "GLASS",
    blindex: "GLASS",
    heladera: "FRIDGE",
    fridge: "FRIDGE",
    nevera: "FRIDGE",
    auto: "VEHICLE",
    carro: "VEHICLE",
    camioneta: "VEHICLE",
    vehiculo: "VEHICLE",
    vehículo: "VEHICLE",
  };

  for (const [key, val] of Object.entries(mapping)) {
    if (t.includes(key)) {
      const isFull = t.includes("completa") || t.includes("entera") || t.includes("toda");
      return { type: val, full: isFull };
    }
  }

  return null;
}

function extractScenarioFromText(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes("mi archivo") || t.includes("mi diseño") || t.includes("ya tengo") || t.includes("listo")) return "READY_FILE";
  if (t.includes("banco") || t.includes("galería") || t.includes("galeria") || t.includes("catálogo") || t.includes("catalogo")) return "IMAGE_BANK";
  if (t.includes("personalizado") || t.includes("hacer uno") || t.includes("diseñen") || t.includes("disenen")) return "CUSTOM_DESIGN";
  return null;
}

function cleanAssistantText(text: string): string {
  return text
    .replace(/\[\[GENERATE_QUOTE\]\]/g, "")
    .replace(/\[\[SET_.*?\]\]/g, "")
    .replace(/^\s*\(.*?cotizaci[oó]n.*?\)\s*$/gim, "")
    .replace(/^\s*\(.*?b[uú]squeda.*?im[aá]genes.*?\)\s*$/gim, "")
    .replace(/XXXX|\[.*?\]|incluya el monto.*?aquí|precio real calculado/gi, "")
    .trim();
}

export async function processAgentTurn(
  leadId: string,
  context: LeadContext,
  incomingMsg: IncomingMessage
): Promise<AgentResponse> {
  const now = new Date().toISOString();

  let localW: number | null = null;
  let localH: number | null = null;
  let localM2: number | null = null;

  // --- 0. PRE-EXTRACCIÓN (DEL MENSAJE DEL USUARIO) ---
  const userMeasures = extractMeasurementsFromText(incomingMsg.text);

  if (userMeasures) {
    localW = userMeasures.w;
    localH = userMeasures.h;
    localM2 = Number((localW * localH).toFixed(2));

    console.log(
      `📏 [AUTO-SENSE] Medidas detectadas en User: ${localW}x${localH} (${localM2}m2)`
    );

    const { error: measurementUpsertError } = await supabase
      .from("b2c_measurements")
      .upsert(
        {
          lead_id: leadId,
          width_meters: localW,
          height_meters: localH,
          square_meters: localM2,
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );

    if (measurementUpsertError) {
      console.error("❌ [AUTO-SENSE] Error guardando medidas detectadas", {
        leadId,
        localW,
        localH,
        localM2,
        error: measurementUpsertError,
      });
    }
  }

  // 1. Recuperar historial de sesión activa desde Redis
  const history = await getConversationHistory(leadId);
  console.log(`📖 [REDIS] Historial recuperado: leadId=${leadId} | mensajes=${history.length}`);

  // 2. Construir el mensaje actual
  const currentContent: any[] = [
    {
      type: "text",
      text: incomingMsg.text || "Aquí tiene la fotografía de mi superficie.",
    },
  ];

  if (incomingMsg.hasPhoto && incomingMsg.photoUrl) {
    currentContent.push({ type: "image", image: incomingMsg.photoUrl });
  }

  const historyWithNew = [...history, { role: "user", content: currentContent }];

  const prompt = buildSystemPrompt(context);

  const result = await generateText({
    model: openai("gpt-4o-mini"),
    system: prompt,
    messages: historyWithNew as any,
  });

  let text = result.text;

  // --- 1. PARSER DE MEDIDAS (AI RESPONSE) ---
  const mMatch = text.match(
    /\[\[SET_MEASUREMENTS:\s*W:\s*([\d.]+)\s*,\s*H:\s*([\d.]+)\s*\]\]/i
  );
  const aiNaturalMeasures = extractMeasurementsFromText(text);

  if (mMatch) {
    localW = parseFloat(mMatch[1]);
    localH = parseFloat(mMatch[2]);
    localM2 = Number((localW * localH).toFixed(2));
  } else if (aiNaturalMeasures) {
    localW = localW || aiNaturalMeasures.w;
    localH = localH || aiNaturalMeasures.h;
    localM2 = localM2 || Number((localW * localH).toFixed(2));
  }

  // Sincronizar con el contexto si todavía no tenemos nada localmente
  if (!localM2) {
    localM2 = context.squareMeters ?? null;

    if (!localM2 && context.measurements) {
      const fromCtx = extractMeasurementsFromText(context.measurements);

      if (fromCtx) {
        localW = fromCtx.w;
        localH = fromCtx.h;
        localM2 = Number((localW * localH).toFixed(2));
      }
    }
  }

  // Si detectamos algo nuevo o consolidado que no estaba en el contexto, guardamos.
  if (
    localW &&
    localH &&
    localM2 &&
    (!context.squareMeters || localM2 !== context.squareMeters)
  ) {
    console.log(`🛠️ [MEMORIA] Medidas consolidadas: ${localW}x${localH}`);

    const { error: consolidatedMeasurementError } = await supabase
      .from("b2c_measurements")
      .upsert(
        {
          lead_id: leadId,
          width_meters: localW,
          height_meters: localH,
          square_meters: localM2,
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );

    if (consolidatedMeasurementError) {
      console.error("❌ [MEMORIA] Error guardando medidas consolidadas", {
        leadId,
        localW,
        localH,
        localM2,
        error: consolidatedMeasurementError,
      });
    }
  }

  // --- 2. PARSER DE ESCENARIO Y SUPERFICIE (PARA ESTE TURNO) ---
  let localSurfaceType = context.surfaceType ?? null;
  let localScenario = context.printFileScenario ?? null;
  let isFullObject = context.isFullObject ?? false;

  // --- AUTO-SENSE (DE LOS MENSAJES DEL USUARIO) ---
  const userSurface = extractSurfaceFromText(incomingMsg.text);
  if (userSurface) {
    localSurfaceType = userSurface.type;
    isFullObject = userSurface.full;
    console.log(`🏠 [AUTO-SENSE] Superficie detectada: ${localSurfaceType} (Full: ${isFullObject})`);
    
    // Guardar inmediatamente si detectamos algo nuevo
    await supabase
      .from("b2c_surface_assessments")
      .upsert(
        {
          lead_id: leadId,
          surface_type: localSurfaceType,
          is_full_object: isFullObject,
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );
  }

  const userScenario = extractScenarioFromText(incomingMsg.text);
  if (userScenario) {
    localScenario = userScenario;
    console.log(`🎨 [AUTO-SENSE] Escenario detectado: ${localScenario}`);
  }

  const sMatch = text.match(
    /\[\[SET_SURFACE:\s*(\w+)\s*,\s*FULL:\s*(\w+)\s*\]\]/i
  );

  if (sMatch) {
    localSurfaceType = sMatch[1];
    isFullObject = sMatch[2]?.toLowerCase() === "true";

    const { error: surfaceUpsertError } = await supabase
      .from("b2c_surface_assessments")
      .upsert(
        {
          lead_id: leadId,
          surface_type: localSurfaceType,
          is_full_object: isFullObject,
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );

    if (surfaceUpsertError) {
      console.error("❌ [SURFACE] Error guardando superficie", {
        leadId,
        localSurfaceType,
        isFullObject,
        error: surfaceUpsertError,
      });
    }
  }

  const pMatch = text.match(/\[\[SET_PRINT:\s*(\w+)\s*\]\]/i);
  const mentionsCustomDesign =
    /diseño personalizado|diseno personalizado|equipo de arte|diseño exclusivo|diseno exclusivo/i.test(
      text
    );

  if (pMatch) {
    localScenario = pMatch[1];
  } else if (mentionsCustomDesign) {
    localScenario = "CUSTOM_DESIGN";
  }

  // Normalización defensiva de escenarios viejos/cortos
  if (localScenario === "C") localScenario = "CUSTOM_DESIGN";
  if (localScenario === "B") localScenario = "IMAGE_BANK";
  if (localScenario === "A") localScenario = "READY_FILE";

  if (localScenario && localScenario !== context.printFileScenario) {
    const { error: scenarioUpsertError } = await supabase
      .from("b2c_quotes")
      .upsert(
        {
          lead_id: leadId,
          print_file_scenario: localScenario,
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );

    if (scenarioUpsertError) {
      console.error("❌ [PRINT] Error guardando escenario de impresión", {
        leadId,
        localScenario,
        error: scenarioUpsertError,
      });
    }
  }

  // --- 3. PARSER DE COTIZACIÓN (FORCE) ---
  const needsQuote =
    text.includes("[[GENERATE_QUOTE]]") ||
    /presupuesto|costo|precio|monto|cotizaci[oó]n|xxxx/i.test(text);

  // URL del PDF de presupuesto (se genera más adelante si aplica)
  let pdfUrl: string | null = null;

  // Imágenes guía a enviar en este turno
  const guideImages: string[] = [];

  // Enviar surface_guide cuando el agente acaba de detectar la superficie por primera vez
  // (el contexto previo no tenía superficie, pero ahora sí)
  const surfaceJustDetected = !context.surfaceType && Boolean(localSurfaceType);
  if (surfaceJustDetected) {
    const surfaceGuideUrl = await getGuideImageUrl("surface");
    if (surfaceGuideUrl) guideImages.push(surfaceGuideUrl);
  }

  // Enviar measure_guide cuando el agente pide medidas (hay superficie pero aún no hay medidas)
  const askingForMeasures =
    Boolean(localSurfaceType) &&
    !localM2 &&
    /medid|ancho|alto|cuánto|cuanto|mide|tama[ñn]o/i.test(text);
  if (askingForMeasures) {
    const measureGuideUrl = await getGuideImageUrl("measure");
    if (measureGuideUrl) guideImages.push(measureGuideUrl);
  }

  if (needsQuote) {
    const hasMeasurements = Boolean(localM2);
    const hasSurface = Boolean(localSurfaceType);
    const hasScenario = Boolean(localScenario);

    console.log("[QUOTE-GATE]", {
      leadId,
      hasMeasurements,
      hasSurface,
      hasScenario,
      localW,
      localH,
      localM2,
      localSurfaceType,
      localScenario,
      contextSurfaceType: context.surfaceType,
      contextPrintFileScenario: context.printFileScenario,
      pMatch: Boolean(pMatch),
    });

    const isFlowComplete = hasMeasurements && hasSurface && hasScenario;

    if (!hasMeasurements) {
      console.warn("⚠️ [FALLBACK] No hay medidas para cotizar.", {
        leadId,
        contextSquareMeters: context.squareMeters,
        contextMeasurements: context.measurements,
      });

      text =
        "Antes de enviarte el presupuesto necesito confirmar las medidas exactas. ¿Podrías indicarme el ancho y el alto en metros?";
    } else if (!isFlowComplete) {
      console.warn("⚠️ [REVENT] Cotización bloqueada: flujo incompleto.", {
        leadId,
        missing: {
          measurements: !hasMeasurements,
          surface: !hasSurface,
          scenario: !hasScenario,
        },
        localM2,
        localSurfaceType,
        localScenario,
      });

      if (!hasSurface) {
        text =
          "Antes de cotizar necesito confirmar sobre qué superficie va el vinilo. ¿Es pared, madera, vidrio, heladera, vehículo u otro objeto?";
      } else if (!hasScenario) {
        text =
          "Antes de enviarte el presupuesto necesito confirmar el diseño: ¿ya tenés el archivo listo, o te podemos ofrecer opciones de nuestro banco de imágenes, o preferís un diseño personalizado?";
      } else {
        text =
          "Antes de cotizar necesito confirmar un dato más del pedido para avanzar.";
      }
    } else {
      const quoteCalc = await calculateQuote({
        surfaceType: localSurfaceType as SurfaceType,
        squareMeters: localM2!,
        installationRequired: true, // El agente asume instalación por defecto
        printFileScenario: localScenario as PrintFileScenario,
        isFullObject: isFullObject || localSurfaceType === "FRIDGE" || localSurfaceType === "VEHICLE",
      });

      const total = quoteCalc.estimatedTotal;
      const surfaceName = SURFACE_LABELS[localSurfaceType as SurfaceType] || "Vinilo Decorativo";

      const servicesStr =
        localScenario === "CUSTOM_DESIGN"
          ? "Impresión, instalación y diseño personalizado"
          : localScenario === "IMAGE_BANK"
          ? "Impresión, instalación y búsqueda en banco de imágenes"
          : "Impresión e instalación";

      const measureDetail =
        localW && localH
          ? `${localW} m x ${localH} m (${localM2} m²)`
          : `${localM2} m²`;

      const quoteCard =
        `📋 **PRESUPUESTO OFICIAL PIXEL ART**\n\n` +
        `**Detalle del pedido:**\n` +
        `- **Tipo de trabajo:** ${surfaceName}\n` +
        `- **Medidas:** ${measureDetail}\n` +
        `- **Servicios:** ${servicesStr}\n\n` +
        `**Desglose:**\n` +
        `- Producción e instalación: $${quoteCalc.estimatedBasePrice.toLocaleString()} ${quoteCalc.currency}\n` +
        (quoteCalc.estimatedInstallPrice > 0
          ? `- Servicio de colocación: $${quoteCalc.estimatedInstallPrice.toLocaleString()} ${quoteCalc.currency}\n`
          : "") +
        (quoteCalc.estimatedExtraPrice > 0
          ? `- Cargo por diseño/banco: $${quoteCalc.estimatedExtraPrice.toLocaleString()} ${quoteCalc.currency}\n`
          : "") +
        `\n💰 **TOTAL ESTIMADO: $${total.toLocaleString()} ${quoteCalc.currency}**`;

      // IMPORTANTE: reemplazamos toda la respuesta del modelo por una salida limpia
      text =
        `¡Perfecto! Aquí tenés tu presupuesto oficial. Te lo envío también como PDF para que lo puedas guardar. 📋\n\n` +
        `Si querés, podemos seguir por este mismo chat para dejar asentado el diseño elegido y los próximos pasos.`;

      // Generar y subir PDF del presupuesto
      try {
        const pdfBuffer = await generateQuotePDF({
          customerName: context.customerName,
          surfaceName,
          measurements: measureDetail,
          squareMeters: localM2!,
          servicesStr,
          estimatedBasePrice: quoteCalc.estimatedBasePrice,
          estimatedInstallPrice: quoteCalc.estimatedInstallPrice,
          estimatedExtraPrice: quoteCalc.estimatedExtraPrice,
          estimatedTotal: total,
          currency: quoteCalc.currency,
          printFileScenario: localScenario!,
        });

        const { url, error: pdfUploadError } = await uploadAsset(
          leadId,
          `presupuesto_${Date.now()}.pdf`,
          pdfBuffer,
          "application/pdf"
        );

        if (pdfUploadError) {
          console.error("❌ [PDF] Error subiendo PDF:", pdfUploadError);
        } else {
          pdfUrl = url;
          console.log(`📄 [PDF] Generado y subido: ${pdfUrl}`);
        }
      } catch (pdfError) {
        console.error("❌ [PDF] Error generando PDF (fallo silencioso):", pdfError);
      }

      const { error: quoteUpsertError } = await supabase
        .from("b2c_quotes")
        .upsert(
          {
            lead_id: leadId,
            surface_type: localSurfaceType,
            square_meters: localM2,
            print_file_scenario: localScenario,
            installation_required: true,
            estimated_base_price: quoteCalc.estimatedBasePrice,
            estimated_install_price: quoteCalc.estimatedInstallPrice,
            estimated_extra_price: quoteCalc.estimatedExtraPrice,
            estimated_total: total,
            requires_human_review: quoteCalc.requiresHumanReview,
            updated_at: now,
          },
          { onConflict: "lead_id" }
        );

      if (quoteUpsertError) {
        console.error("❌ [QUOTE] Error guardando cotización", {
          leadId,
          total,
          localScenario,
          error: quoteUpsertError,
        });
      }

      const { error: leadStageError } = await supabase
        .from("b2c_leads")
        .update({ current_stage: "QUOTE_GENERATED", updated_at: now })
        .eq("id", leadId);

      if (leadStageError) {
        console.error("❌ [QUOTE] Error actualizando etapa del lead", {
          leadId,
          error: leadStageError,
        });
      }
    }
  }

  if (text.includes("[[CLOSE_DEAL]]")) {
    const { error: closeDealError } = await supabase
      .from("b2c_leads")
      .update({ current_stage: "CLOSED_WON", updated_at: now })
      .eq("id", leadId);

    if (closeDealError) {
      console.error("❌ [CLOSE] Error cerrando lead", {
        leadId,
        error: closeDealError,
      });
    }
  }

  const finalCleanup = cleanAssistantText(text);
  const messages = finalCleanup
    .split(/\s*---\s*/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  return {
    messages:
      messages.length > 0
        ? messages
        : ["He registrado los datos. ¿Cómo desea proceder?"],
    images: guideImages,
    documents: pdfUrl ? [pdfUrl] : [],
    newStage: "STAY",
    requiresHumanReview: false,
  };
}