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

/**
 * Detecta si el cliente quiere instalación (true) o retiro en local (false)
 * a partir de texto en lenguaje natural — tanto del usuario como del LLM.
 * Retorna null si no se puede determinar.
 */
function extractInstallFromText(text: string): boolean | null {
  if (!text) return null;
  const t = text.toLowerCase();

  // ── Retiro en local (instalación = false) ──
  const pickupPatterns = [
    "retiro", "retira", "lo busco", "paso a buscar", "paso a retir",
    "voy a buscar", "busco yo", "buscar yo", "lo voy a buscar",
    "retirarlo", "retiro en local", "retiro por local", "retiro en el local",
    "lo retiro", "lo busco", "lo paso a buscar", "me lo llevo",
    "sin instalación", "sin instalacion", "sin colocación", "sin colocacion",
    "no necesito instalación", "no necesito instalacion",
    "no necesito que instalen", "no quiero instalación",
  ];

  // ── Con instalación (instalación = true) ──
  const installPatterns = [
    "instalación", "instalacion", "instalen", "instalar",
    "que vengan", "vengan a colocar", "colocación", "colocacion",
    "que lo pongan", "que lo instalen", "necesito instalación",
    "con instalación", "con colocación", "quiero instalación",
    "lo coloquen", "que lo coloquen",
  ];

  // Evaluar primero patrones de retiro (son más específicos)
  if (pickupPatterns.some((p) => t.includes(p))) return false;
  if (installPatterns.some((p) => t.includes(p))) return true;

  return null;
}

function cleanAssistantText(text: string): string {
  return text
    .replace(/\[\[GENERATE_QUOTE\]\]/g, "")
    .replace(/\[\[SET_.*?\]\]/g, "")
    .replace(/\[\[BLOCK:.*?\]\]/g, "")
    .replace(/\[\[CLOSE_DEAL\]\]/g, "")
    .replace(/^\s*\(.*?cotizaci[oó]n.*?\)\s*$/gim, "")
    .replace(/^\s*\(.*?b[uú]squeda.*?im[aá]genes.*?\)\s*$/gim, "")
    .replace(/XXXX|incluya el monto.*?aquí|precio real calculado/gi, "")
    // Limpiar placeholders que el LLM alucina cuando intenta generar una cotización
    .replace(/\$[xX]\b/g, "")
    .replace(/\(monto generado en el sistema\)/gi, "")
    .replace(/\[monto generado en el sistema\]/gi, "")
    .replace(/monto generado en el sistema/gi, "")
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
  }

  // 1. Recuperar historial de sesión activa desde Redis
  const history = await getConversationHistory(leadId);
  console.log(`📖 [AGENT SESSION]
    LeadID: ${leadId}
    Stage: ${context.currentStage}
    History: ${history.length} msgs
    Has Quote: ${!!context.quoteSummary}
  `);

  // 2. Construir el mensaje actual
  let fallbackText = "Aquí tiene la fotografía de mi superficie.";
  if (incomingMsg.hasFile && incomingMsg.fileName) {
    fallbackText = `He enviado un archivo adjunto llamado: ${incomingMsg.fileName}`;
  }

  const currentContent: any[] = [
    {
      type: "text",
      text: incomingMsg.text || fallbackText,
    },
  ];

  if (incomingMsg.hasPhoto && incomingMsg.photoUrl) {
    try {
      console.log(`[AGENT] Descargando imagen manualmente para evitar Timeout AI SDK: ${incomingMsg.photoUrl}`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

      const res = await fetch(incomingMsg.photoUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const imageBytes = new Uint8Array(arrayBuffer);
      currentContent.push({ type: "image", image: imageBytes });
      console.log(`[AGENT] Imagen descargada exitosamente (${imageBytes.length} bytes)`);
    } catch (err) {
      console.error(`❌ [AGENT] Fallo al descargar imagen, enviando URL directa al SDK:`, err);
      currentContent.push({ type: "image", image: incomingMsg.photoUrl });
    }
  }


  const historyWithNew = [...history, { role: "user", content: currentContent }];

  const prompt = buildSystemPrompt(context);

  const result = await generateText({
    model: openai("gpt-4o-mini"),
    system: prompt,
    messages: historyWithNew as any,
  });

  let text = result.text;

  // ═══════════════════════════════════════════════════════════════════════
  // PARSER DE BLOQUEO (DEBE IR PRIMERO)
  // ═══════════════════════════════════════════════════════════════════════
  console.log(`🤖 [IA RESPONSE] Turno para lead ${leadId}: "${text}"`);

  const blockMatch = text.match(/\[\[BLOCK:(\w+)\]\]/i);
  const reasonMatch = text.match(/\[\[REASON:(.*?)\]\]/i);

  if (blockMatch) {
    const aiReason = reasonMatch ? reasonMatch[1].trim() : null;
    console.log(`🚫 [BLOCK] Bloqueo detectado: ${blockMatch[1]}. Razón: ${aiReason || "No especificada"}`);

    const blockReason = blockMatch[1] === "SURFACE_DAMAGE" 
      ? (aiReason ? `IA: ${aiReason}` : "Superficie no apta (daño detectado).")
      : `Bloqueo automático: ${blockMatch[1]}`;
    await updateLeadStatus(leadId, "BLOCKED", blockReason);

    // En modo bloqueado, limpiamos el texto y retornamos directamente
    const finalCleanup = cleanAssistantText(text);
    const messages = finalCleanup
      .split(/\s*---\s*/)
      .map((m) => m.trim())
      .filter((m) => m.length > 0);

    return {
      messages: messages.length > 0
        ? messages
        : ["Lamentablemente la superficie no está en condiciones óptimas para el trabajo, ya que con humedad o daño el vinilo no se adhiere bien. Alguien de nuestro equipo se contactará a la brevedad para asesorarte cómo seguir."],
      images: [],
      documents: [],
      newStage: "BLOCKED",
      requiresHumanReview: true,
      rawText: text
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PARSER DE MEDIDAS (AI RESPONSE)
  // ═══════════════════════════════════════════════════════════════════════
  const mMatch = text.match(
    /\[\[SET_MEASUREMENTS:\s*W:\s*([\d.]+)\s*,\s*H:\s*([\d.]+)\s*\]\]/i
  );
  const aiNaturalMeasures = extractMeasurementsFromText(text);

  if (mMatch) {
    localW = parseFloat(mMatch[1]);
    localH = parseFloat(mMatch[2]);
    // Safety check: LLM sometimes forgets to convert cm to m
    if (localW > 10) localW = localW / 100;
    if (localH > 10) localH = localH / 100;
    localM2 = Number((localW * localH).toFixed(2));
  } else if (aiNaturalMeasures) {
    localW = localW || aiNaturalMeasures.w;
    localH = localH || aiNaturalMeasures.h;
    localM2 = localM2 || Number((localW * localH).toFixed(2));
  }

  // Sincronizar con el contexto si todavía no tenemos nada localmente
  if (!localM2) {
    localM2 = context.squareMeters ?? null;
  }
  
  // Siempre intentar recuperar W y H del contexto si existen
  if (!localW || !localH) {
    if (context.measurements) {
      const fromCtx = extractMeasurementsFromText(context.measurements);
      if (fromCtx) {
        localW = fromCtx.w;
        localH = fromCtx.h;
        if (!localM2) {
          localM2 = Number((localW * localH).toFixed(2));
        }
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

    // Status tracking: medidas recibidas
    await updateLeadStatus(leadId, "MEASUREMENTS_RECEIVED");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PARSER DE ESCENARIO Y SUPERFICIE (PARA ESTE TURNO)
  // ═══════════════════════════════════════════════════════════════════════
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

    // Status tracking: superficie seleccionada
    if (!context.surfaceType) {
      await updateLeadStatus(leadId, "SURFACE_SELECTED");
    }
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

    // Status tracking: superficie seleccionada
    await updateLeadStatus(leadId, "SURFACE_SELECTED");
  }

  const pMatch = text.match(/\[\[SET_PRINT:\s*(\w+)\s*\]\]/i);
  
  // --- AUTO-SENSE SCENARIO (SOLO DEL MENSAJE DEL USUARIO) ---
  // IMPORTANTE: No parsear el texto del asistente (assistant 'text') para auto-detección,
  // ya que el asistente suele mencionar todas las opciones en sus preguntas,
  // lo que generaba falsos positivos (ej: asumiendo CUSTOM_DESIGN porque el agente lo preguntó).
  if (!localScenario) {
    const userScenario = extractScenarioFromText(incomingMsg.text);
    if (userScenario) {
      localScenario = userScenario;
      console.log(`🎨 [AUTO-SENSE User] Escenario detectado: ${localScenario}`);
    }
  }

  // Los comandos explícitos del LLM [[SET_PRINT:...]] siempre tienen prioridad y se parsean del 'text'
  if (pMatch) {
    localScenario = pMatch[1];
    console.log(`🎨 [IA COMMAND] Escenario seteado por comando: ${localScenario}`);
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
          surface_type: localSurfaceType || "WALL",
          width_meters: localW,
          height_meters: localH,
          square_meters: localM2,
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

    // Status tracking: escenario seleccionado
    await updateLeadStatus(leadId, "PRINT_FILE_SCENARIO_SELECTED");
    
    // HUMAN HANDOFF para CUSTOM_DESIGN - REMOVIDO para permitir cotizar sin diseño
    if (localScenario === "CUSTOM_DESIGN") {
      console.log(`👤 [HANDOFF] Diseño personalizado solicitado. Se avanzará para cotización parcial.`);
    }
  }

  let localInstall: boolean | null = null;
  const iMatch = text.match(/\[\[SET_INSTALL:\s*(true|false)\s*\]\]/i);
  if (iMatch) {
    localInstall = iMatch[1].toLowerCase() === "true";
    
    // Guardar instalación inmediatamente para evitar bucles de conversación
    const { error: installUpsertError } = await supabase
      .from("b2c_quotes")
      .upsert(
        {
          lead_id: leadId,
          surface_type: localSurfaceType || "WALL",
          installation_required: localInstall,
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );
      
    if (installUpsertError) {
      console.error("❌ [INSTALL] Error guardando instalación", installUpsertError);
    }
    await updateLeadStatus(leadId, "INSTALLATION_SELECTED");
  }

  // Auto-sense de instalación desde el texto del USUARIO (si no vino el tag)
  if (localInstall === null) {
    const installFromUser = extractInstallFromText(incomingMsg.text);
    if (installFromUser !== null) {
      localInstall = installFromUser;
      console.log(`🔍 [AUTO-SENSE INSTALL user] "${incomingMsg.text}" → ${localInstall}`);
    }
  }

  // Auto-sense de instalación desde el texto de RESPUESTA del LLM fue removido 
  // porque generaba falsos positivos (parseaba sus propias preguntas como respuestas).
  // Solo se usa el comando interno [[SET_INSTALL:true/false]].  // Si detectamos instalación en este turno pero no estaba en DB, la guardamos
  if (localInstall !== null && context.installationRequired === null) {
    const { error: installAutoSaveError } = await supabase
      .from("b2c_quotes")
      .upsert(
        {
          lead_id: leadId,
          surface_type: localSurfaceType || context.surfaceType || "WALL",
          installation_required: localInstall,
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );
    if (installAutoSaveError) {
      console.error("❌ [INSTALL AUTO-SAVE]", installAutoSaveError);
    } else {
      console.log(`💾 [INSTALL AUTO-SAVED] ${localInstall} para lead ${leadId}`);
    }
  }

  // --- PARSER DE DIRECCIÓN ---
  const addrMatch = text.match(/\[\[SET_ADDRESS:\s*(.*?)\s*\]\]/i);
  if (addrMatch) {
    const newAddress = addrMatch[1].trim();
    console.log(`🏠 [ADDRESS] Dirección detectada: ${newAddress}`);
    await supabase
      .from("b2c_leads")
      .update({ address: newAddress, updated_at: now })
      .eq("id", leadId);
  }

  // --- PARSER DE SELECCIÓN DE IMAGEN DEL BANCO ---
  // Este comando no afecta la lógica de flujo, pero se captura para persistir en el CRM
  const imgSelectionMatch = text.match(/\[\[SET_IMAGE_SELECTION:\s*(.*?)\s*\]\]/i);
  if (imgSelectionMatch) {
    const selectionText = imgSelectionMatch[1].trim();
    console.log(`🖼️ [IMAGE_SELECTION] El usuario eligió: ${selectionText}`);
    // La persistencia real se hace en el webhook/route.ts al leer agentResponse.rawText
  }

  // ─── MERGE: siempre combinar valores del turno actual con el contexto persistido ───
  // Esto evita que un dato respondido en un turno anterior sea ignorado en el siguiente.
  if (localInstall === null && context.installationRequired !== null) {
    localInstall = context.installationRequired;
  }
  if (!localScenario && context.printFileScenario) {
    localScenario = context.printFileScenario;
  }
  if (!localSurfaceType && context.surfaceType) {
    localSurfaceType = context.surfaceType;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PARSER DE COTIZACIÓN
  // ═══════════════════════════════════════════════════════════════════════

  // Safety net: si el modelo tiene todos los datos pero olvidó emitir [[GENERATE_QUOTE]], lo forzamos.
  // IMPORTANTE: usamos los valores YA MERGEADOS con el contexto (no solo los del turno actual).
  // Esto evita el loop donde el agente pregunta datos que ya fueron respondidos en turnos anteriores.
  const flowCompleteAutoTrigger =
    Boolean(localM2) &&
    Boolean(localSurfaceType) &&
    Boolean(localScenario) &&
    localInstall !== null;

  const quoteAlreadyDone =
    context.currentStage === "QUOTE_GENERATED" ||
    context.currentStage === "CLOSED_WON" ||
    context.currentStage === "CLOSED_LOST";

  // needsQuote dispara cuando:
  // 1. El LLM emitió [[GENERATE_QUOTE]] explícitamente — principal mecanismo
  // 2. El flujo está completo (auto-trigger) — safety net si el LLM olvidó el comando
  // NOTA: No se fuerza por detección de frases del LLM ("te mando el presupuesto", etc.)
  // El LLM lee el historial completo de Redis y debe emitir [[GENERATE_QUOTE]] de forma natural.
  const needsQuote =
    text.includes("[[GENERATE_QUOTE]]") ||
    (!quoteAlreadyDone && flowCompleteAutoTrigger);

  if (flowCompleteAutoTrigger && !text.includes("[[GENERATE_QUOTE]]") && !quoteAlreadyDone) {
    console.log(`⚡ [AUTO-QUOTE] Todos los datos completos. Forzando generación de cotización.`, {
      localM2, localSurfaceType, localScenario, localInstall,
    });
  }
  if (quoteAlreadyDone && !text.includes("[[GENERATE_QUOTE]]")) {
    console.log(`🔒 [QUOTE-GUARD] Cotización ya existe (stage: ${context.currentStage}). Omitiendo re-generación.`);
  }


  // URL del PDF de presupuesto (se genera más adelante si aplica)
  let pdfUrl: string | null = null;

  // Imágenes a enviar en este turno (guías o imágenes del banco)
  const outgoingImages: string[] = [];

  // Si se acaba de elegir IMAGE_BANK, buscamos imágenes para enviar
  if (localScenario === "IMAGE_BANK" && context.printFileScenario !== "IMAGE_BANK") {
    // Preservemos cualquier comando [[...]] que el modelo haya emitido
    const commands = text.match(/\[\[[^\]]+\]\]/g) || [];
    const commandText = commands.length > 0 ? commands.join(" ") + " " : "";

    // Inyectamos un mensaje fijo para derivar al catálogo web
    text = commandText + "¡Perfecto! Podés ver nuestro catálogo completo de imágenes acá: https://pixel-art-agent.vercel.app/catalog\n\nCuando elijas una, avisame cuál te gustó. Tené en cuenta que la imagen va a ser recreada tal cual está en el banco de imágenes. Esto ya incluye una tarifa fija de diseño.";
  }

  // ── READY_FILE: verificar si ya existe un archivo de diseño persistido ───────
  // Si el escenario es READY_FILE pero el agente detectó que el usuario tiene un archivo,
  // asegurarse de que el agente lo pida si no está guardado.
  if (localScenario === "READY_FILE" && !incomingMsg.hasFile && !incomingMsg.hasPhoto) {
    // Verificar si ya hay un archivo de diseño en la base de datos
    const { data: existingAssets } = await supabase
      .from("b2c_lead_assets")
      .select("id")
      .eq("lead_id", leadId)
      .eq("asset_type", "DESIGN_FILE")
      .limit(1);

    const hasDesignFile = existingAssets && existingAssets.length > 0;

    // Si no hay archivo guardado y el LLM no está ya pidiendo el archivo,
    // inyectar mensaje para solicitarlo
    if (!hasDesignFile && !/adjunt|mand[aá]|env[íi][ao]|subi[dó]|sube|compart[í]/i.test(text)) {
      // Solo inyectar si el texto actual no es ya una solicitud del archivo
      if (!/archivo|diseño|adjunto|pdf|png|jpg|jpeg|ai|eps|psd/i.test(text)) {
        console.log(`📁 [READY_FILE] Escenario seleccionado pero sin archivo. Solicitando.`);
        text = "¡Perfecto! Para avanzar necesito que me envíes el archivo de diseño. " +
          "Puede ser en formato JPG, PNG, PDF, AI o EPS. Lo más importante es que tenga buena resolución para que la impresión quede perfecta.\n\n" +
          "Enviá el archivo directamente por acá.";
      }
    }
  }

  // Enviar surface_guide SOLO si el agente está pidiendo la superficie, NO la tenemos,
  // Y no fue enviada antes en esta sesión
  const askingForSurface = !localSurfaceType && /superficie|pared|madera|vidrio|heladera|veh[íi]culo|donde|dónde/i.test(text);
  if (askingForSurface && !context.surfaceType && !context.surfaceGuideSent) {
    const surfaceGuideUrl = await getGuideImageUrl("surface");
    if (surfaceGuideUrl) {
      console.log("🧩 [GUIDE] Agregando link de guía de superficie al texto.");
      text += `\n\n💡 Acá tenés una guía sobre las superficies: ${surfaceGuideUrl}`;
      context.surfaceGuideSent = true;
      // Marcar en Redis para persistir el flag en la sesión
      await redis.set(`guide:surface:${leadId}`, "1", { ex: 90 * 60 });
    }
  }

  // Enviar measure_guide cuando el agente pide medidas (hay superficie pero aún no hay medidas)
  // Y no fue enviada antes en esta sesión
  const askingForMeasures =
    Boolean(localSurfaceType) &&
    !localM2 &&
    /medid|ancho|alto|cuánto|cuanto|mide|tama[ñn]o|dimension|largo|profundidad/i.test(text);
  if (askingForMeasures && !context.measurements && !context.measureGuideSent) {
    const measureGuideUrl = await getGuideImageUrl("measure");
    if (measureGuideUrl) {
      console.log("📏 [GUIDE] Agregando link de guía de medidas al texto.");
      text += `\n\n💡 Mirá esta guía para tomar las medidas correctamente: ${measureGuideUrl}`;
      context.measureGuideSent = true;
      // Marcar en Redis para persistir el flag en la sesión
      await redis.set(`guide:measure:${leadId}`, "1", { ex: 90 * 60 });
    }
  }

  if (needsQuote) {
    // Fallback final: si localM2 sigue null, usar lo que tenga el contexto
    if (!localM2 && context.squareMeters) {
      localM2 = context.squareMeters;
      console.log(`📦 [QUOTE-GATE] Usando squareMeters del contexto: ${localM2} m²`);
    }

    const hasMeasurements = Boolean(localM2);
    const hasSurface = Boolean(localSurfaceType);
    const hasScenario = Boolean(localScenario);
    const hasInstall = localInstall !== null;

    console.log("[QUOTE-GATE]", {
      leadId,
      hasMeasurements,
      hasSurface,
      hasScenario,
      hasInstall,
      localW,
      localH,
      localM2,
      localSurfaceType,
      localScenario,
      localInstall,
      contextSurfaceType: context.surfaceType,
      contextPrintFileScenario: context.printFileScenario,
      contextInstallationRequired: context.installationRequired,
      pMatch: Boolean(pMatch),
    });

    const isFlowComplete = hasMeasurements && hasSurface && hasScenario && hasInstall;

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
          install: !hasInstall,
        },
        localM2,
        localSurfaceType,
        localScenario,
        localInstall,
      });

      if (!hasSurface) {
        text =
          "Antes de cotizar necesito confirmar sobre qué superficie va el vinilo. ¿Es pared, madera, vidrio, heladera, vehículo u otro objeto?";
      } else if (!hasScenario) {
        text =
          "Antes de enviarte el presupuesto necesito confirmar el diseño: ¿ya tenés el archivo listo, o te podemos ofrecer opciones de nuestro banco de imágenes, o preferís un diseño personalizado?";
      } else if (!hasInstall) {
        text =
          "Antes de enviarte el presupuesto necesito confirmar la entrega: ¿vas a necesitar que nosotros nos encarguemos de la instalación o preferís retirarlo por nuestro local?";
      } else {
        text =
          "Antes de cotizar necesito confirmar un dato más del pedido para avanzar.";
      }
    } else {
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

      const measureDetail =
        localW && localH
          ? `Ancho: ${wString} x Alto: ${hString}`
          : `${localM2} m²`;

      // IMPORTANTE: reemplazamos toda la respuesta del modelo por una salida limpia
      let textBreakdown = "";
      if (localScenario === "CUSTOM_DESIGN") {
        // Diseño personalizado: sin precio, el equipo de arte evalúa
        textBreakdown = 
          `Tu pedido fue registrado. Te enviamos la información del mismo en un PDF.\n\n` +
          `El diseño personalizado será evaluado por nuestro equipo de arte, quienes analizarán la viabilidad y te enviarán la cotización acorde a lo que buscás.\n\n` +
          `Alguien del equipo de arte se contactará a la brevedad por este mismo chat para avanzar.`;
      } else if (quoteCalc.requiresHumanReview) {
        textBreakdown = 
          `Aquí tenés tu presupuesto estimado. Te lo envío también como PDF para que lo puedas guardar.\n\n` +
          `Dado el tamaño o las características del trabajo, nuestro equipo técnico revisará la viabilidad y confirmará el costo exacto${localInstall ? ' de instalación' : ''} antes de avanzar.\n\n` +
          `Alguien del equipo se contactará a la brevedad por este mismo chat.`;
      } else if (localScenario === "READY_FILE") {
        textBreakdown = 
          `Aquí tenés tu presupuesto estimado. Te lo envío también como PDF para que lo puedas guardar.\n\n` +
          `El total de tu pedido ${localInstall ? 'con instalación incluida' : 'retirando por el local'} es de **$${total.toLocaleString("es-UY")} ${quoteCalc.currency}**.\n\n` +
          `Alguien de nuestro equipo se contactará para analizar la resolución del archivo que nos enviaste y confirmar que es apto para imprimir en ese tamaño.\n\n` +
          `¿Te parece bien para avanzar?`;
      } else {
        textBreakdown = 
          `Aquí tenés tu presupuesto estimado. Te lo envío también como PDF para que lo puedas guardar.\n\n` +
          `El total de tu pedido ${localInstall ? 'con instalación incluida' : 'retirando por el local'} es de **$${total.toLocaleString("es-UY")} ${quoteCalc.currency}**.\n\n` +
          `¿Te parece bien para avanzar con el pago y comenzar con el diseño?`;
      }

      text = textBreakdown;

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
          orderNumber: context.orderNumber || undefined,
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
            installation_required: localInstall ?? true,
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

      // Status tracking: cotización generada
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
  // PERO permitir el link del catálogo oficial (pixel-art-agent.vercel.app)
  finalCleanup = finalCleanup
    .replace(/\[([^\]]+)\]\((?!https?:\/\/(?:pixel-art-agent\.vercel\.app|jkehckvkxigxwmkuunvc\.supabase\.co))[^)]+\)/g, "$1") 
    .replace(/https?:\/\/(?!pixel-art-agent\.vercel\.app|jkehckvkxigxwmkuunvc\.supabase\.co)[^\s]+/g, ""); 

  const messages = finalCleanup
    .split(/\s*---\s*/)
    .map((m) => m.trim())
    .filter((m) => m.length > 0);

  return {
    messages:
      messages.length > 0
        ? messages
        : ["He registrado los datos. ¿Cómo desea proceder?"],
    images: outgoingImages,
    documents: pdfUrl ? [pdfUrl] : [],
    newStage: "STAY",
    requiresHumanReview: false,
    rawText: text, // Incluimos el texto original con comandos para la simulación
  };
}