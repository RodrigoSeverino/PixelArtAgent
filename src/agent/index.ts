import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { supabase } from "@/lib/supabase";
import { redis } from "@/lib/redis";
import { getConversationHistory } from "@/lib/redis";
import { generateQuotePDF } from "@/lib/pdf";
import { uploadAsset } from "@/lib/storage";
import { getGuideImageUrl } from "@/lib/guides";
import type { IncomingMessage, AgentResponse, LeadContext } from "./types";
import { buildSystemPrompt } from "./system-prompt";
import { calculateQuote } from "@/lib/pricing";
import { SURFACE_LABELS, type SurfaceType } from "@/types/surface";
import type { PrintFileScenario } from "@/types/quote";
import type { LeadStage } from "@/types/lead";

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES DE EXTRACCIÓN (REGEX)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Intenta extraer medidas (W y H) de un texto cualquiera usando Regex.
 * Soporta formatos: "2x1", "2 x 1", "2mts x 1mts", "2.5m x 1.8m",
 * "1.20 de alto por 0.60 de ancho", "150cm x 80cm", etc.
 */
function extractMeasurementsFromText(
  text: string
): { w: number; h: number } | null {
  const num = `(\\d+(?:[.,]\\d+)?)`;
  const unit = `\\s*(?:mts?|metr[oa]s?|mt|m|cm)?\\s*`;
  const sep = `(?:x|por|\\*|,|×)`;

  // --- Formato clásico: "2x1", "2 por 1", "2.5m x 1.8m" ---
  const classicRegex = new RegExp(`${num}${unit}${sep}${unit}${num}${unit}`, "i");
  const classicMatch = text.match(classicRegex);

  if (classicMatch) {
    let w = parseFloat(classicMatch[1].replace(",", "."));
    let h = parseFloat(classicMatch[2].replace(",", "."));

    const lowerText = text.toLowerCase();
    const hasCm = lowerText.includes("cm") ||
        lowerText.includes("centimetro") ||
        lowerText.includes("centímetro") ||
        lowerText.includes("centimetros") ||
        lowerText.includes("centímetros");

    // Convert independently if value > 10, assuming it's in cm
    if (w > 10) w = w / 100;
    if (h > 10) h = h / 100;

    if (w > 0 && h > 0) return { w, h };
  }

  // --- Formato natural: "1.20 de alto por 0.60 de ancho" / "alto 1.20 ancho 0.60" ---
  const naturalAltoPrimero = new RegExp(
    `${num}[^\\d]{0,20}?alt[oa][^\\d]{0,20}?(?:y|,|po[rt]|x)?[^\\d]{0,20}${num}[^\\d]{0,20}?anch[oa]`,
    "i"
  );
  const naturalAnchoPrimero = new RegExp(
    `${num}[^\\d]{0,20}?anch[oa][^\\d]{0,20}?(?:y|,|po[rt]|x)?[^\\d]{0,20}${num}[^\\d]{0,20}?alt[oa]`,
    "i"
  );

  const altoPrimeroMatch = text.match(naturalAltoPrimero);
  if (altoPrimeroMatch) {
    let h = parseFloat(altoPrimeroMatch[1].replace(",", "."));
    let w = parseFloat(altoPrimeroMatch[2].replace(",", "."));
    if (w > 10) w = w / 100;
    if (h > 10) h = h / 100;
    if (w > 0 && h > 0) return { w, h };
  }

  const anchoPrimeroMatch = text.match(naturalAnchoPrimero);
  if (anchoPrimeroMatch) {
    let w = parseFloat(anchoPrimeroMatch[1].replace(",", "."));
    let h = parseFloat(anchoPrimeroMatch[2].replace(",", "."));
    if (w > 10) w = w / 100;
    if (h > 10) h = h / 100;
    if (w > 0 && h > 0) return { w, h };
  }

  return null;
}

function extractSurfaceFromText(text: string): { type: string; full: boolean } | null {
  const t = text.toLowerCase();
  
  const mapping: Record<string, SurfaceType> = {
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
    furgon: "VEHICLE",
    furgón: "VEHICLE",
    camion: "VEHICLE",
    camión: "VEHICLE",
    utilitario: "VEHICLE",
    pick: "VEHICLE",
  };

  for (const [key, val] of Object.entries(mapping)) {
    if (t.includes(key)) {
      const isFull = t.includes("completa") || t.includes("entera") || t.includes("toda");
      return { type: val, full: isFull };
    }
  }

  return null;
}

// extractScenarioFromText removed.

/**
 * Intenta extraer teléfono y dirección del texto.
 */
function extractContactInfoFromText(text: string): { phone?: string; address?: string } {
  const res: { phone?: string; address?: string } = {};
  
  // Teléfono: busca secuencias de dígitos de al menos 8 números, opcionalmente con + o espacios
  const phoneRegex = /(\+?\d[\d\s-]{7,}\d)/;
  const phoneMatch = text.match(phoneRegex);
  if (phoneMatch) {
    const cleanPhone = phoneMatch[1].replace(/\s+/g, "");
    if (cleanPhone.length >= 8) {
      res.phone = cleanPhone;
    }
  }

  // Dirección: busca keywords comunes de dirección en Uruguay/Arg
  // "calle X", "barrio X", "esquina X", "num X", "dir: X"
  const addressKeywords = ["calle", "esquina", "barrio", "dirección", "direccion", "apto", "apartamento", "número", "numero", "nro"];
  const lowerText = text.toLowerCase();
  
  if (addressKeywords.some(k => lowerText.includes(k)) || /\b\d{4,5}\b/.test(text)) {
    // Si contiene keywords o lo que parece un código postal/número de puerta de 4-5 cifras
    // Intentamos capturar una frase que parezca dirección
    const addrRegex = /(?:direcci[oó]n:?\s*|viva?o?\s*en\s*|estoy\s*en\s*)(.*)/i;
    const addrMatch = text.match(addrRegex);
    if (addrMatch) {
      res.address = addrMatch[1].trim();
    } else {
      // Si no hay prefijo claro pero hay keywords, mandamos el texto completo para que el CRM lo guarde
      // (Limitado para no guardar un párrafo entero)
      if (text.length < 100) {
        res.address = text.trim();
      }
    }
  }

  return res;
}


function cleanAssistantText(text: string): string {
  return text
    .replace(/\[\[.*?\]\]/g, "") // Remueve cualquier comando tipo [[COMANDO]]
    .replace(/^\s*\(.*?cotizaci[oó]n.*?\)\s*$/gim, "")
    .replace(/^\s*\(.*?b[uú]squeda.*?im[aá]genes.*?\)\s*$/gim, "")
    .replace(/XXXX|incluya el monto.*?aquí|precio real calculado/gi, "")
    // Limpiar placeholders que el LLM alucina cuando intenta generar una cotización
    .replace(/\$[xX]\b/g, "")
    .replace(/\(monto generado en el sistema\)/gi, "")
    .replace(/\[monto generado en el sistema\]/gi, "")
    .replace(/monto generado en el sistema/gi, "")
    // Remueve emojis (caracteres no-ASCII o rangos específicos de emojis)
    .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E6}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F900}-\u{1F9FF}\u{1F018}-\u{1F093}\u{1F191}-\u{1F251}\u{1F004}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{3030}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2194}-\u{2199}\u{21A9}-\u{21AA}\u{3297}\u{3299}\u{303D}\u{1F201}-\u{1F202}\u{1F21A}\u{1F22F}\u{1F232}-\u{1F23A}\u{1F250}-\u{1F251}\u{1F300}-\u{1F320}\u{1F32D}-\u{1F335}\u{1F337}-\u{1F37C}\u{1F37E}-\u{1F393}\u{1F3A0}-\u{1F3C4}\u{1F3C6}-\u{1F3CA}\u{1F3E0}-\u{1F3F0}\u{1F400}-\u{1F43E}\u{1F440}\u{1F442}-\u{1F4F7}\u{1F4F9}-\u{1F4FC}\u{1F500}-\u{1F53D}\u{1F550}-\u{1F567}\u{1F5FB}-\u{1F640}\u{1F645}-\u{1F64F}\u{1F680}-\u{1F6C0}\u{1F6CC}\u{1F6D0}-\u{1F6D2}\u{1F6EB}-\u{1F6EC}\u{1F6F4}-\u{1F6F6}\u{1F6F7}-\u{1F6F8}\u{1F6F9}-\u{1F6FA}\u{1F7E0}-\u{1F7EB}\u{1F90D}-\u{1F971}\u{1F973}-\u{1F976}\u{1F97A}-\u{1F9A2}\u{1F9A5}-\u{1F9AA}\u{1F9AE}-\u{1F9AF}\u{1F9B0}-\u{1F9B9}\u{1F9BC}-\u{1F9FF}\u{1FA70}-\u{1FA73}\u{1FA78}-\u{1FA7A}\u{1FA80}-\u{1FA82}\u{1FA90}-\u{1FA95}]/gu, "")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS TRACKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Actualiza la columna `current_stage` de un lead en Supabase.
 * Solo avanza hacia adelante en el embudo (no retrocede).
 */
async function updateLeadStatus(leadId: string, newStage: LeadStage, observation?: string): Promise<void> {
  const now = new Date().toISOString();

  const updateData: any = { current_stage: newStage, updated_at: now };
  if (observation) {
    updateData.observation = observation;
  }

  const { error } = await supabase
    .from("b2c_leads")
    .update(updateData)
    .eq("id", leadId);

  if (error) {
    console.error(`❌ [STATUS] Error actualizando stage a ${newStage}:`, {
      leadId,
      error,
    });
  } else {
    console.log(`📊 [STATUS] Lead ${leadId} → ${newStage}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR PRINCIPAL DEL AGENTE
// ═══════════════════════════════════════════════════════════════════════════

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

    // Status tracking: medidas recibidas
    await updateLeadStatus(leadId, "MEASUREMENTS_RECEIVED");
    // Sincronizar contexto
    context.measurements = `${localW}m x ${localH}m`;
    context.squareMeters = localM2;
    context.currentStage = "MEASUREMENTS_RECEIVED";
  }

  // --- AUTO-SENSE SURFACE (DEL MENSAJE DEL USUARIO) ---
  // Detectar superficie antes de la IA para que el prompt tenga el contexto actualizado
  let localSurfaceType = context.surfaceType ?? null;
  let isFullObject = context.isFullObject ?? false;
  const userSurface = extractSurfaceFromText(incomingMsg.text);
  if (userSurface) {
    localSurfaceType = userSurface.type;
    isFullObject = userSurface.full;
    console.log(`🏠 [AUTO-SENSE PRE-IA] Superficie detectada: ${localSurfaceType} (Full: ${isFullObject})`);
    
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

    // Status tracking: superficie seleccionada
    if (!context.surfaceType) {
      const stage = localSurfaceType === "VEHICLE" ? "HUMAN_HANDOFF" : "SURFACE_SELECTED";
      await updateLeadStatus(leadId, stage);
      // Actualizamos el contexto para que el prompt refleje el cambio
      context.surfaceType = localSurfaceType;
      context.currentStage = stage;
    }
  }

  let localScenario = context.printFileScenario ?? null;
  // Scenario auto-detection removed to avoid false positives. 
  // We rely on LLM commands [[SET_PRINT:...]] for better accuracy.

  // --- AUTO-SENSE EXTRA (SCENARIO & INSTALLATION) ---
  // Manual installation/scenario overrides removed to favor LLM intent detection.

  // --- AUTO-SENSE CONTACT DATA ---
  const phoneDetected = incomingMsg.text.match(/\+?\d{7,15}/);
  const addressKeywords = /Av\.|Calle|Nº|Numero|Ruta|Km|Piso|Depto|Casa|Manzana|Solar|Apartamento/i;
  const addressDetected = addressKeywords.test(incomingMsg.text);

  if (phoneDetected && !context.phone) {
    context.phone = phoneDetected[0];
    await supabase.from("b2c_leads").update({ phone: context.phone, updated_at: now }).eq("id", leadId);
  }
  if (addressDetected && !context.address) {
    context.address = incomingMsg.text;
    await supabase.from("b2c_leads").update({ address: context.address, updated_at: now }).eq("id", leadId);
  }

  // ─── 1. RECUPERAR HISTORIAL Y CONTEXTO ───
  const history = await getConversationHistory(leadId);
  console.log(`📖 [AGENT SESSION] LeadID: ${leadId} | Stage: ${context.currentStage} | History: ${history.length}`);

  // ─── 2. PROCESAR MENSAJE ENTRANTE (IMAGENES / ARCHIVOS) ───
  let fallbackText = "Aquí tiene la fotografía de mi superficie.";
  if (incomingMsg.hasFile && incomingMsg.fileName) {
    fallbackText = `He enviado un archivo adjunto llamado: ${incomingMsg.fileName}`;
  }

  const currentContent: any[] = [{ type: "text", text: incomingMsg.text || fallbackText }];

  if (incomingMsg.hasPhoto && incomingMsg.photoUrl) {
    try {
      console.log(`[AGENT] Descargando imagen manualmente: ${incomingMsg.photoUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(incomingMsg.photoUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const imageBytes = new Uint8Array(await res.arrayBuffer());
      currentContent.push({ type: "image", image: imageBytes });
    } catch (err) {
      console.error(`❌ [AGENT] Fallo descarga imagen, usando URL:`, err);
      currentContent.push({ type: "image", image: incomingMsg.photoUrl });
    }
  }

  const historyWithNew = [...history, { role: "user", content: currentContent }];
  const prompt = buildSystemPrompt(context);

  // ─── 3. LLAMADA AL MODELO IA ───
  const result = await generateText({
    model: openai("gpt-4o-mini"),
    system: prompt,
    messages: historyWithNew as any,
  });

  let text = result.text;
  const pMatch = text.includes("[[GENERATE_QUOTE]]");
  const wPhotoMatch = text.includes("[[WAIVE_PHOTO]]");

  // ─── 4. ESTADO CONSOLIDADO (Auto-sense + IA Commands) ───
  
  // A. Medidas
  const mMatch = text.match(/\[\[SET_MEASUREMENTS:\s*W:\s*([\d.]+)\s*,\s*H:\s*([\d.]+)\s*\]\]/i);
  // userMeasures ya fue extraído al inicio
  if (mMatch) {
    localW = parseFloat(mMatch[1]);
    localH = parseFloat(mMatch[2]);
  } else if (userMeasures) {
    localW = userMeasures.w;
    localH = userMeasures.h;
  } else if (context.measurements) {
    const fromCtx = extractMeasurementsFromText(context.measurements);
    localW = fromCtx?.w || null;
    localH = fromCtx?.h || null;
  }
  if (localW && localH) {
    if (localW > 10) localW /= 100;
    if (localH > 10) localH /= 100;
    localM2 = Number((localW * localH).toFixed(2));
  }

  // B. Superficie
  const sMatch = text.match(/\[\[SET_SURFACE:\s*(\w+)\s*(?:,\s*FULL:\s*(true|false))?\s*\]\]/i);
  // userSurface ya fue extraído al inicio
  if (sMatch) {
    localSurfaceType = sMatch[1];
    isFullObject = sMatch[2]?.toLowerCase() === "true";
  } else if (userSurface) {
    localSurfaceType = userSurface.type;
    isFullObject = userSurface.full;
  } else {
    localSurfaceType = context.surfaceType || null;
    isFullObject = context.isFullObject || false;
  }

  // C. Instalación
  const iMatch = text.match(/\[\[SET_INSTALLATION:\s*(true|false)\s*\]\]/i);
  if (iMatch) {
    localInstall = iMatch[1].toLowerCase() === "true";
  } else {
    localInstall = context.installationRequired ?? null;
  }

  // D. Escenario de Diseño
  const pMatchSetPrint = text.match(/\[\[SET_PRINT:\s*(\w+)\s*\]\]/i);
  if (pMatchSetPrint) {
    localScenario = pMatchSetPrint[1];
  } else {
    localScenario = context.printFileScenario || null;
  }
  // Normalización
  if (localScenario === "C") localScenario = "CUSTOM_DESIGN";
  if (localScenario === "B") localScenario = "IMAGE_BANK";
  if (localScenario === "A") localScenario = "READY_FILE";

  // E. Contacto y Foto
  const addrMatch = text.match(/\[\[SET_ADDRESS:(.*?)\]\]/i);
  const phoneMatch = text.match(/\[\[SET_PHONE:(.*?)\]\]/i);
  const autoContact = extractContactInfoFromText(incomingMsg.text);
  
  if (addrMatch) context.address = addrMatch[1].trim();
  else if (autoContact.address) context.address = autoContact.address;

  if (phoneMatch) context.phone = phoneMatch[1].trim();
  else if (autoContact.phone) context.phone = autoContact.phone;

  const autoWaive = /no (puedo|tengo|hay) foto|despu[eé]s te mando|luego mando/i.test(incomingMsg.text);
  if (wPhotoMatch || autoWaive) context.photoWaived = true;

  // ─── 5. PERSISTENCIA EN SUPABASE (Diferenciada) ───
  if (localW && localH) {
    await supabase.from("b2c_measurements").upsert({ lead_id: leadId, width_meters: localW, height_meters: localH, square_meters: localM2, updated_at: now }, { onConflict: "lead_id" });
  }
  if (localSurfaceType) {
    await supabase.from("b2c_surface_assessments").upsert({ lead_id: leadId, surface_type: localSurfaceType, is_full_object: isFullObject, photo_waived: context.photoWaived, updated_at: now }, { onConflict: "lead_id" });
  }
  
  // Persistencia de cotización parcial/completa
  if (localScenario || localInstall !== null || localSurfaceType) {
    const quoteUpdate: any = { 
      lead_id: leadId, 
      updated_at: now 
    };
    if (localSurfaceType) quoteUpdate.surface_type = localSurfaceType;
    if (localScenario) quoteUpdate.print_file_scenario = localScenario;
    if (localInstall !== null) quoteUpdate.installation_required = localInstall;

    await supabase.from("b2c_quotes").upsert(quoteUpdate, { onConflict: "lead_id" });
  }

  if (context.address || context.phone) {
    await supabase.from("b2c_leads").update({ address: context.address, phone: context.phone, updated_at: now }).eq("id", leadId);
  }

  // ─── 6. LÓGICA DE BLOQUEO / HANDOFF ───
  
  // Safety Net: Vehículo
  if (localSurfaceType === "VEHICLE" && !text.includes("[[BLOCK:VEHICLE]]")) {
    text = "[[BLOCK:VEHICLE]] " + text;
  }

  const blockMatch = text.match(/\[\[BLOCK:(\w+)\]\]/i);
  if (blockMatch) {
    const reasonMatch = text.match(/\[\[REASON:(.*?)\]\]/i);
    let finalStage: LeadStage = "BLOCKED";
    let defaultMessage = "La superficie no es apta. Alguien se contactará.";

    if (blockMatch[1] === "VEHICLE") {
      finalStage = "HUMAN_HANDOFF";
      defaultMessage = "Los vehículos requieren revisión técnica. Alguien te contactará pronto.";
    }

    await updateLeadStatus(leadId, finalStage, reasonMatch?.[1]);
    const cleanMsg = cleanAssistantText(text);
    return {
      messages: cleanMsg ? [cleanMsg] : [defaultMessage],
      images: [],
      documents: [],
      newStage: finalStage,
      requiresHumanReview: true,
      rawText: text
    };
  }

  // ─── 7. QUOTE GATE (Safety Net Final) ───
  // Note: Vehicle leads skip this and go to blockMatch above
  const isPhotoValid = context.hasPhoto || context.photoWaived;
  
  const isFlowComplete = 
    Boolean(localM2) && 
    Boolean(localSurfaceType) && 
    Boolean(localScenario) && 
    localInstall !== null && 
    isPhotoValid;
    // La dirección y el teléfono ya no son bloqueantes para generar el presupuesto
    // Pero se pedirán al final del mensaje si localInstall es true.

  const quoteAlreadyDone = context.currentStage === "QUOTE_GENERATED" || context.currentStage === "CLOSED_WON";
  const needsQuote = (pMatch || isFlowComplete) && !quoteAlreadyDone;

  if (needsQuote && !text.includes("[[GENERATE_QUOTE]]")) {
    console.log("⚡ [AUTO-QUOTE] Forzando generación por flujo completo.");
  }

  // ─── 8. GENERACIÓN DE COTIZACIÓN (SI APLICA) ───
  // URL del PDF y outgoingImages
  let pdfUrl: string | null = null;
  const outgoingImages: string[] = [];

  // Guías de ayuda (inyección proactiva)
  const askingForSurface = !localSurfaceType && /superficie|pared|madera|vidrio|heladera|veh[íi]culo|donde|dónde/i.test(text);
  if (askingForSurface && !context.surfaceType && !context.surfaceGuideSent) {
    const surfaceGuideUrl = await getGuideImageUrl("surface");
    if (surfaceGuideUrl) {
      text += `\n\nAcá tenés una guía sobre las superficies: ${surfaceGuideUrl}`;
      context.surfaceGuideSent = true;
      await redis.set(`guide:surface:${leadId}`, "1", { ex: 90 * 60 });
    }
  }

  const askingForMeasures = Boolean(localSurfaceType) && !localM2 && /medid|ancho|alto|cuánto|cuanto|mide|tama[ñn]o|dimension|largo|profundidad/i.test(text);
  if (askingForMeasures && !context.measurements && !context.measureGuideSent) {
    const measureGuideUrl = await getGuideImageUrl("measure");
    if (measureGuideUrl) {
      text += `\n\nMirá esta guía para tomar las medidas correctamente: ${measureGuideUrl}`;
      context.measureGuideSent = true;
      await redis.set(`guide:measure:${leadId}`, "1", { ex: 90 * 60 });
    }
  }

  if (needsQuote) {
    // Fallback final: si localM2 sigue null, usar lo que tenga el contexto
    if (!localM2 && context.squareMeters) {
      localM2 = context.squareMeters;
    }

    const hasMeasurements = Boolean(localM2);
    const hasSurface = Boolean(localSurfaceType);
    const hasScenario = Boolean(localScenario);
    const hasInstall = localInstall !== null;

    if (!hasMeasurements) {
      text = "Antes de enviarte el presupuesto necesito confirmar las medidas exactas. ¿Podrías indicarme el ancho y el alto en metros?";
    } else if (!isFlowComplete) {
      // Bloqueo por falta de datos básicos (no incluye contacto)
      if (!hasSurface) {
        text = "Antes de cotizar necesito confirmar sobre qué superficie va el vinilo. ¿Es pared, madera, vidrio, heladera, vehículo u otro objeto?";
      } else if (!hasScenario) {
        text = "Antes de enviarte el presupuesto necesito confirmar el diseño: ¿ya tenés el archivo listo, o te podemos ofrecer opciones de nuestro banco de imágenes, o preferís un diseño personalizado?";
      } else if (!hasInstall) {
        text = "Antes de enviarte el presupuesto necesito confirmar la entrega: ¿vas a necesitar que nosotros nos encarguemos de la instalación o preferís retirarlo por nuestro local?";
      } else if (!isPhotoValid) {
        text = "Para asegurarme de que el vinilo va a quedar perfecto, ¿me podés mandar una foto de la superficie?";
      }
    } else {
      // TODO LISTO PARA COTIZAR
      
      // Caso especial: READY_FILE sin archivo
      if (localScenario === "READY_FILE") {
        const { data: existingAssets } = await supabase
          .from("b2c_lead_assets")
          .select("id")
          .eq("lead_id", leadId)
          .eq("asset_type", "DESIGN_FILE")
          .limit(1);
        
        if (!existingAssets || existingAssets.length === 0) {
          if (!/archivo|diseño|adjunto|pdf|png|jpg|jpeg|ai|eps|psd/i.test(text)) {
            text = "¡Perfecto! Para avanzar necesito que me envíes el archivo de diseño.\n\n" +
                   "Puede ser en formato JPG, PNG, PDF, AI o EPS. Enviámelo directamente por acá para que podamos verificar la calidad.";
            // No retornamos aquí, permitimos que se genere el presupuesto igual si el usuario quiere, 
            // pero el mensaje principal será este. O podemos inyectarlo al final.
            // Para el "happy path", mejor inyectarlo y dejar que el presupuesto se genere.
          }
        }
      }

      const quoteCalc = await calculateQuote({
        surfaceType: localSurfaceType as SurfaceType,
        squareMeters: localM2!,
        installationRequired: localInstall as boolean,
        printFileScenario: localScenario as PrintFileScenario,
        isFullObject: isFullObject || localSurfaceType === "FRIDGE" || localSurfaceType === "VEHICLE",
      });

      const total = quoteCalc.estimatedTotal;
      const surfaceName = SURFACE_LABELS[localSurfaceType as SurfaceType] || "Vinilo Decorativo";

      const servicesStr =
        localScenario === "CUSTOM_DESIGN"
          ? "Impresión, diseño personalizado y " + (localInstall ? "instalación" : "retiro por local")
          : localScenario === "IMAGE_BANK"
          ? "Impresión, búsqueda en banco y " + (localInstall ? "instalación" : "retiro por local")
          : "Impresión y " + (localInstall ? "instalación" : "retiro por local");

      let wString = localW ? (localW < 1 ? `${localW * 100} cm` : `${localW} m`) : "";
      let hString = localH ? (localH < 1 ? `${localH * 100} cm` : `${localH} m`) : "";

      const measureDetail = localW && localH ? `Ancho: ${wString} x Alto: ${hString}` : `${localM2} m²`;

      let textBreakdown = "";
      if (localScenario === "CUSTOM_DESIGN") {
        textBreakdown = `Tu pedido fue registrado. Te enviamos la información del mismo en un PDF.\n\n` +
          `El diseño personalizado será evaluado por nuestro equipo de arte, quienes analizarán la viabilidad y te enviarán la cotización acorde a lo que buscás.\n\n` +
          `Alguien del equipo de arte se contactará a la brevedad por este mismo chat para avanzar.`;
      } else if (quoteCalc.requiresHumanReview) {
        textBreakdown = `Aquí tenés tu presupuesto estimado. Te lo envío también como PDF para que lo puedas guardar.\n\n` +
          `Dado el tamaño o las características del trabajo, nuestro equipo técnico revisará la viabilidad y confirmará el costo exacto${localInstall ? ' de instalación' : ''} antes de avanzar.\n\n` +
          `Alguien del equipo se contactará a la brevedad por este mismo chat.`;
      } else if (localScenario === "READY_FILE") {
        textBreakdown = `Aquí tenés tu presupuesto estimado. Te lo envío también como PDF para que lo puedas guardar.\n\n` +
          `El total de tu pedido ${localInstall ? 'con instalación incluida' : 'retirando por el local'} es de **$${total.toLocaleString("es-UY")} ${quoteCalc.currency}**.\n\n` +
          `Alguien de nuestro equipo se contactará para analizar la resolución del archivo y confirmar que es apto para imprimir.\n\n` +
          `¿Te parece bien para avanzar?`;
      } else {
        textBreakdown = `Aquí tenés tu presupuesto estimado. Te lo envío también como PDF para que lo puedas guardar.\n\n` +
          `El total de tu pedido ${localInstall ? 'con instalación incluida' : 'retirando por el local'} es de **$${total.toLocaleString("es-UY")} ${quoteCalc.currency}**.\n\n` +
          `¿Te parece bien para avanzar con el pago y comenzar con el diseño?`;
      }

      // Si pide instalación pero no hay contacto, lo pedimos al final
      if (localInstall && (!context.address || !context.phone)) {
        textBreakdown += "\n\nPara coordinar la instalación, ¿me podrías pasar tu dirección y un teléfono de contacto?";
      }

      text = textBreakdown;

      // Generar y subir PDF
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
          orderNumber: context.orderNumber || undefined,
        });

        const { url, error: pdfUploadError } = await uploadAsset(leadId, `presupuesto_${Date.now()}.pdf`, pdfBuffer, "application/pdf");
        if (!pdfUploadError) {
          pdfUrl = url;
        }
      } catch (pdfError) {
        console.error("❌ [PDF] Error:", pdfError);
      }

      await supabase.from("b2c_quotes").upsert({
        lead_id: leadId,
        surface_type: localSurfaceType,
        square_meters: localM2,
        print_file_scenario: localScenario,
        installation_required: localInstall,
        estimated_base_price: quoteCalc.estimatedBasePrice,
        estimated_install_price: quoteCalc.estimatedInstallPrice,
        estimated_extra_price: quoteCalc.estimatedExtraPrice,
        estimated_total: total,
        requires_human_review: quoteCalc.requiresHumanReview,
        updated_at: now,
      }, { onConflict: "lead_id" });

      await updateLeadStatus(leadId, "QUOTE_GENERATED");
    }
  }

  if (text.includes("[[CLOSE_DEAL]]")) {
    await updateLeadStatus(leadId, "CLOSED_WON");
    // Mensaje de cierre específico solicitado por el usuario
    text = "Gracias por tu compra. Tu pedido está confirmado y pronto nos estaremos contactando para coordinar la instalación.";
  }

  let finalCleanup = cleanAssistantText(text);
  
  // Limpiar cualquier link markdown [texto](url) o http crudo que el modelo haya alucinado
  // Convertimos links markdown a texto plano: [texto](url) -> texto
  finalCleanup = finalCleanup
    .replace(/\[([^\]]+)\]\((?!https?:\/\/jkehckvkxigxwmkuunvc\.supabase\.co)[^)]+\)/g, "$1") 
    // Removemos URLs crudas excepto las oficiales de Supabase (para PDFs) y el catálogo (aunque ya lo manejamos arriba)
    .replace(/https?:\/\/(?!pixel-art-agent\.vercel\.app|jkehckvkxigxwmkuunvc\.supabase\.co)[^\s]+/g, ""); 

  console.log("Cleaned text:", finalCleanup);

  const messages = finalCleanup
    .split(/\s*---\s*/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  return {
    messages:
      messages.length > 0
        ? messages.map((m, i) => {
            // Inyectar catálogo en el último mensaje si corresponde
            if (i === messages.length - 1 && localScenario === "IMAGE_BANK" && !context.catalogGuideSent) {
              const catalogUrl = "https://pixel-art-agent.vercel.app/catalog";
              // Marcamos como enviado y persistimos
              context.catalogGuideSent = true;
              redis.set(`guide:catalog:${leadId}`, "1", { ex: 90 * 60 }).catch(e => console.error("Redis Error:", e));
              return m + `\n\nCatálogo: ${catalogUrl}`;
            }
            return m;
          })
        : ["He registrado los datos. ¿Cómo desea proceder?"],
    images: outgoingImages,
    documents: pdfUrl ? [pdfUrl] : [],
    newStage: "STAY",
    requiresHumanReview: false,
    rawText: text, // Incluimos el texto original con comandos para la simulación
  };
}