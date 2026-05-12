import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { supabase } from "@/lib/supabase";
import { buildLeadRecord } from "@/lib/lead";
import { processAgentTurn } from "@/agent/index";
import { appendToHistory, redis } from "@/lib/redis";
import type { LeadContext, IncomingMessage } from "@/agent/types";
import {
  sendMessage,
  sendPhoto,
  sendDocument,
  getFileUrl,
  type TelegramUpdate,
} from "@/modules/channels/telegram";
import { uploadAsset, downloadFile } from "@/lib/storage";
import type { LeadStage } from "@/types/lead";

function isPreviousOrderReference(text: string): boolean {
  const t = text.toLowerCase();
  // Incluimos frases de cierre o agradecimiento como parte del flujo actual
  const closurePhrases = ["gracias", "muchas gracias", "ok", "vale", "entendido", "perfecto", "buenísimo", "buenisimo", "chau", "hasta luego"];
  const trackingPhrases = [
    "mi pedido", "mi encargo", "el pedido", "el encargo",
    "cuándo llega", "cuando llega", "cuándo está", "cuando está",
    "estado del pedido", "seguimiento", "track", "tracking", "status",
    "lo que pedí", "lo que encargué", "lo que compré",
    "pagué", "pague", "comprobante", "transferencia", "envié el pago"
  ];
  return [...closurePhrases, ...trackingPhrases].some((p) => t.includes(p));
}

function isNewOrderIntent(text: string): boolean {
  const t = text.toLowerCase();
  // Saludos genéricos solo disparan nuevo pedido si NO hay un pedido abierto o reciente.
  // Pero aquí solo definimos si el TEXTO sugiere un nuevo pedido.
  const greetings = [
    "hola", "buen día", "buenos días", "buenas tardes", "buenas noches",
    "buenas", "hey", "buen dia"
  ];
  // Frases explícitas de nuevo pedido
  const newOrderPhrases = [
    "otro pedido", "nuevo pedido", "otra cotización", "otra cotizacion",
    "quiero cotizar", "quiero otro", "necesito otro", "hacer otro",
    "quiero pedir", "quiero encargar", "necesito un vinilo"
  ];
  // Si solo dice "hola" o similar, es un saludo.
  // Si contiene palabras de precio sin ser un seguimiento, podría ser nuevo pedido.
  const priceInquiry = ["cuanto sale", "cuánto sale", "precio", "valor", "costo"].some(p => t.includes(p));

  return newOrderPhrases.some((p) => t.includes(p)) || (greetings.includes(t.trim()) && t.length < 15);
}

/**
 * POST /api/telegram/webhook
 * Recibe mensajes de Telegram, delega el procesamiento al agente
 * basado en Vercel AI SDK, y devuelve la respuesta.
 */


export async function POST(request: Request) {
  try {
    // Validar Secret Token para seguridad
    const secretFromTelegram = (request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "").trim();
    const mySecret = (process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

    if (mySecret && secretFromTelegram !== mySecret) {
      console.error("❌ [WEBHOOK] Unauthorized: Secret token mismatch or missing.");
      console.log(`Header recibido: "${secretFromTelegram}" (length: ${secretFromTelegram.length})`);
      console.log(`Token esperado: "${mySecret}" (length: ${mySecret.length})`);
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const update: TelegramUpdate = await request.json();
    console.log("➡️ [WEBHOOK] Mensaje recibido de Telegram:", JSON.stringify(update, null, 2));

    if (!update.message) {
      console.log("⚠️ [WEBHOOK] El update no contenía un 'message'. Ignorando.");
      return NextResponse.json({ ok: true });
    }

    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text ?? msg.caption ?? "";
    console.log(`[👤 CHAT] ID: ${chatId} | Texto: "${text}"`);

    const fromName = [msg.from.first_name, msg.from.last_name]
      .filter(Boolean)
      .join(" ");

    // --- Manejo de foto y documento ---
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    let photoUrl: string | null = null;
    
    const hasDocument = !!msg.document;
    let fileUrl: string | null = null;
    let fileName: string | null = null;

    // --- Buscar o crear lead ---
    const { data: existingLead } = await supabase
      .from("b2c_leads")
      .select("*")
      .eq("telegram_chat_id", String(chatId))
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    let leadId: string;
    let currentStage: LeadStage;
    let phone: string | null = null;

    // Solo los leads TERMINALES permiten crear un lead nuevo.
    // Cualquier otro estado (activo, cotizado, bloqueado) = lead ABIERTO, continuar siempre.
    const TERMINAL_STAGES: string[] = ["CLOSED_WON", "CLOSED_LOST"];

    if (existingLead && TERMINAL_STAGES.includes(existingLead.current_stage)) {
      const isFollowUp = isPreviousOrderReference(text);

      if (isFollowUp) {
        console.log(`📦 [FOLLOW-UP] Lead ${existingLead.id} en ${existingLead.current_stage}. Respondiendo seguimiento.`);
        leadId = existingLead.id;
        currentStage = existingLead.current_stage as LeadStage;
        phone = existingLead.phone;
      } else {
        console.log(`🆕 [NEW ORDER] Lead previo ${existingLead.id} estaba ${existingLead.current_stage}. Creando nuevo.`);
        const newLead = buildLeadRecord({
          fullName: fromName || null,
          channel: "TELEGRAM",
          telegramChatId: String(chatId),
        });
        const { error: newLeadError } = await supabase.from("b2c_leads").insert(newLead);
        if (newLeadError) {
          console.error("Error creating new lead for returning customer:", newLeadError);
          await sendMessage(chatId, "Ocurrió un error. Intentá de nuevo en unos minutos.");
          return NextResponse.json({ ok: true });
        }
        leadId = newLead.id;
        currentStage = "INITIAL_CONTACT";
        await redis.del(`chat:${leadId}:history`);
      }
    } else if (existingLead) {
      // Lead activo en cualquier estado no-terminal → siempre continuar
      console.log(`✅ [ACTIVE LEAD] Continuando lead ${existingLead.id} en ${existingLead.current_stage}.`);
      leadId = existingLead.id;
      currentStage = existingLead.current_stage as LeadStage;
      phone = existingLead.phone;
    } else {
      const newLead = buildLeadRecord({
        fullName: fromName || null,
        channel: "TELEGRAM",
        telegramChatId: String(chatId),
      });

      const { error } = await supabase.from("b2c_leads").insert(newLead);
      if (error) {
        console.error("Error creating lead:", error);
        await sendMessage(chatId, "Ocurrió un error. Intentá de nuevo en unos minutos.");
        return NextResponse.json({ ok: true });
      }

      leadId = newLead.id;
      currentStage = "INITIAL_CONTACT";
    }

    // --- Descargar y guardar foto si mandó ---
    if (hasPhoto) {
      const bestPhoto = msg.photo![msg.photo!.length - 1];
      const telegramFileUrl = await getFileUrl(bestPhoto.file_id);

      if (telegramFileUrl) {
        const downloaded = await downloadFile(telegramFileUrl);
        if (downloaded) {
          const { url } = await uploadAsset(
            leadId,
            `photo_${Date.now()}.jpg`,
            downloaded.buffer,
            downloaded.contentType
          );
          photoUrl = url;

          if (photoUrl) {
            // Consultar el escenario actual desde la BD para clasificar correctamente la foto
            const { data: quoteRow } = await supabase
              .from("b2c_quotes")
              .select("print_file_scenario")
              .eq("lead_id", leadId)
              .limit(1)
              .single();

            const currentScenario = quoteRow?.print_file_scenario ?? null;

            // Si el escenario ya es READY_FILE, la foto es el archivo de diseño
            const isDesignFilePhoto = currentScenario === "READY_FILE";
            const assetType = isDesignFilePhoto ? "DESIGN_FILE" : "SURFACE_PHOTO";

            // Guardar como asset
            await supabase.from("b2c_lead_assets").insert({
              lead_id: leadId,
              asset_type: assetType,
              file_url: photoUrl,
              file_name: `photo_${Date.now()}.jpg`,
            });

            console.log(`📸 [PHOTO] Guardada como ${assetType} para lead ${leadId}`);

            if (!isDesignFilePhoto) {
              // Solo actualizar el assessment si es foto de superficie
              await supabase
                .from("b2c_surface_assessments")
                .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
                .eq("lead_id", leadId);
            }
          }
        }
      }
    }

    // --- Descargar y guardar documento si mandó ---
    if (hasDocument && msg.document) {
      const doc = msg.document;
      const telegramFileUrl = await getFileUrl(doc.file_id);

      if (telegramFileUrl) {
        const downloaded = await downloadFile(telegramFileUrl);
        if (downloaded) {
          const originalName = doc.file_name || `document_${Date.now()}`;
          const safeName = originalName.replace(/[^a-zA-Z0-9.-]/g, "_");
          const { url } = await uploadAsset(
            leadId,
            safeName,
            downloaded.buffer,
            downloaded.contentType
          );
          fileUrl = url;
          fileName = originalName;

          if (fileUrl) {
            // Guardar como asset
            await supabase.from("b2c_lead_assets").insert({
              lead_id: leadId,
              asset_type: "DESIGN_FILE",
              file_url: fileUrl,
              file_name: fileName,
            });
          }
        }
      }
    }

    // --- Construir contexto inyectable para el Agente ---
    const context = await buildLeadContext(leadId, currentStage, fromName, phone, hasPhoto);

    // --- Construir objeto de mensaje normalizado ---
    const incomingMsg: IncomingMessage = {
      text,
      hasPhoto,
      photoUrl,
      hasFile: hasDocument,
      fileUrl,
      fileName,
    };

    // --- Message Queuing / Debouncing con Redis ---
    const bufferKey = `webhook_buffer:${chatId}`;
    const debounceKey = `webhook_debounce:${chatId}`;
    
    // 1. Guardar el mensaje en el buffer
    await redis.rpush(bufferKey, JSON.stringify(incomingMsg));
    await redis.expire(bufferKey, 60); // 60s TTL
    
    // 2. Registrar un ID único para esta solicitud
    const reqId = crypto.randomUUID();
    await redis.set(debounceKey, reqId, { ex: 60 });
    
    // 3. Esperar 5 segundos para agrupar mensajes
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // 4. Comprobar si llegó un mensaje más nuevo durante la espera
    const currentReqId = await redis.get<string>(debounceKey);
    if (currentReqId && currentReqId !== reqId) {
      console.log(`⏳ [QUEUE] Mensaje encolado para el chat ${chatId}. Delegando al último request.`);
      return NextResponse.json({ ok: true });
    }
    
    // 5. Somos el request final del lote. Extraer todos los mensajes.
    const rawMessages = await redis.lrange(bufferKey, 0, -1);
    await redis.del(bufferKey);
    
    // 6. Combinar mensajes
    let combinedText = "";
    let finalPhotoUrl: string | null = null;
    let finalHasPhoto = false;
    
    for (const raw of rawMessages) {
      try {
        const parsed: IncomingMessage = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (parsed.text) combinedText += (combinedText ? "\\n" : "") + parsed.text;
        if (parsed.hasPhoto && parsed.photoUrl) {
           finalHasPhoto = true;
           finalPhotoUrl = parsed.photoUrl;
        }
      } catch (e) {
        console.error("Error parsing buffered message:", e);
      }
    }
    
    incomingMsg.text = combinedText;
    incomingMsg.hasPhoto = finalHasPhoto;
    incomingMsg.photoUrl = finalPhotoUrl;
    
    console.log(`📦 [QUEUE] Procesando lote de ${rawMessages.length} mensajes. Texto combinado: "${incomingMsg.text}"`);

    // --- Invocar al Motor del Agente ---
    try {
      console.log("🤖 [AGENTE] Invocando Vercel AI SDK...");
      const agentResponse = await processAgentTurn(leadId, context, incomingMsg);
      console.log("✅ [AGENTE] Respuesta generada exitosamente. Enviando...");

      // --- PARSER DE SELECCIÓN DE IMAGEN DEL BANCO ---
      const imgSelectionMatch = agentResponse.rawText?.match(/\[\[SET_IMAGE_SELECTION:\s*(.*?)\s*\]\]/i);
      if (imgSelectionMatch) {
        const selectionText = imgSelectionMatch[1].trim();
        console.log(`🖼️ [WEBHOOK] Guardando selección de imagen: ${selectionText}`);
        await supabase.from("b2c_lead_assets").insert({
          lead_id: leadId,
          asset_type: "IMAGE_BANK_SELECTION",
          file_name: "Selección de catálogo",
          notes: selectionText
        });
      }

      // Guardar el mensaje del usuario en Redis (caché de sesión)
      await appendToHistory(
        leadId,
        "user",
        incomingMsg.hasPhoto ? `[FOTO ENVIADA]\n${text}` : text
      );

      // El agente puede retornar múltiples mensajes de texto o imágenes
      for (const reply of agentResponse.messages) {
        console.log(`✉️ [OUT] ${reply}`);
        await sendMessage(chatId, reply);

        // Guardar la respuesta del modelo en Redis (caché de sesión)
        await appendToHistory(leadId, "assistant", reply);
      }

      for (const img of agentResponse.images) {
        console.log(`🖼️ [OUT] URL Imagen: ${img}`);
        await sendPhoto(chatId, img);
      }

      for (const docUrl of agentResponse.documents) {
        console.log(`📄 [OUT] Intentando enviar PDF a chat ${chatId}: ${docUrl}`);
        const docSent = await sendDocument(chatId, docUrl);
        if (!docSent) {
          // Fallback: si Telegram no puede descargar el PDF (URL privada/problemas),
          // enviamos el link directo para que el cliente lo abra manualmente.
          console.warn(`⚠️ [PDF FALLBACK] sendDocument falló, enviando URL como texto.`);
          await sendMessage(chatId, `📄 Podés ver y descargar tu presupuesto aquí:\n${docUrl}`);
        }
      }

    } catch (agentError) {
      console.error("❌ [ERROR AGENTE] Vercel AI SDK falló:", agentError);
      await sendMessage(
        chatId,
        "Disculpá, estoy teniendo un problema técnico. ¿Podés intentar de nuevo en unos segundos?"
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("❌ [ERROR CRÍTICO] Telegram webhook falló en nivel superior:", error);
    return NextResponse.json({ ok: true });
  }
}

/**
 * Recopila todos los datos del lead desde Supabase y construye
 * el LeadContext que va a consumir el buildSystemPrompt.
 */
async function buildLeadContext(
  leadId: string,
  currentStage: LeadStage,
  customerName: string | null,
  phone: string | null,
  hasPhoto: boolean
): Promise<LeadContext> {
  const context: LeadContext = {
    leadId,
    currentStage,
    customerName,
    phone,
    channel: "TELEGRAM",
    surfaceType: null,
    isFullObject: false,
    hasPhoto,
    photoUrl: null,
    measurements: null,
    squareMeters: null,
    printFileScenario: null,
    quoteSummary: null,
    installationRequired: null,
    orderNumber: null,
    address: null,
    surfaceGuideSent: false,
    measureGuideSent: false,
    photoWaived: false,
    catalogGuideSent: false,
  };

  try {
    // Traer datos básicos del Lead
    const { data: leadData } = await supabase
      .from("b2c_leads")
      .select("order_number, address, phone, full_name")
      .eq("id", leadId)
      .single();

    if (leadData) {
      context.orderNumber = leadData.order_number;
      context.address = leadData.address;
      context.phone = leadData.phone || phone;
      context.customerName = leadData.full_name || customerName;
    }

    // Traer Superficie (última valoración)
    const { data: surfaceData } = await supabase
      .from("b2c_surface_assessments")
      .select("surface_type, is_full_object, photo_url, photo_waived")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1);

    const surface = surfaceData?.[0];
    if (surface) {
      context.surfaceType = surface.surface_type; 
      context.isFullObject = surface.is_full_object;
      if (surface.photo_url) {
          context.hasPhoto = true;
          context.photoUrl = surface.photo_url;
      }
      if (surface.photo_waived) {
          context.photoWaived = true;
      }
    }

    // Traer Medidas (últimas)
    const { data: measurementData } = await supabase
      .from("b2c_measurements")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1);

    const measurement = measurementData?.[0];
    if (measurement) {
      context.measurements = `${measurement.width_meters}m × ${measurement.height_meters}m = ${measurement.square_meters} m²`;
      context.squareMeters = measurement.square_meters;
    }

    // Traer Cotización
    const { data: quoteData } = await supabase
      .from("b2c_quotes")
      .select("*")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1);

    const quote = quoteData?.[0];
    if (quote) {
      context.printFileScenario = quote.print_file_scenario;
      context.quoteSummary = `Total estimado $${quote.estimated_total}`;
      if (quote.installation_required !== undefined && quote.installation_required !== null) {
        context.installationRequired = quote.installation_required;
      }
    }
    // Traer flags de imágenes de guía desde Redis
    const [surfaceFlag, measureFlag, catalogFlag] = await Promise.all([
      redis.get(`guide:surface:${leadId}`),
      redis.get(`guide:measure:${leadId}`),
      redis.get(`guide:catalog:${leadId}`),
    ]);
    context.surfaceGuideSent = surfaceFlag === "1";
    context.measureGuideSent = measureFlag === "1";
    context.catalogGuideSent = catalogFlag === "1";
  } catch (err) {
    console.error("⚠️ [WARNING] Error al construir el contexto:", err);
  }

  return context;
}
