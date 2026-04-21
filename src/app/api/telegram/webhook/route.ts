import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { buildLeadRecord } from "@/lib/lead";
import { processAgentTurn } from "@/agent/index";
import type { LeadContext, IncomingMessage } from "@/agent/types";
import {
  sendMessage,
  sendPhoto,
  getFileUrl,
  type TelegramUpdate,
} from "@/modules/channels/telegram";
import { uploadAsset, downloadFile } from "@/lib/storage";
import type { LeadStage } from "@/types/lead";

/**
 * POST /api/telegram/webhook
 * Recibe mensajes de Telegram, delega el procesamiento al agente
 * basado en Vercel AI SDK, y devuelve la respuesta.
 */
export async function GET() {
  return NextResponse.json({ 
    status: "active", 
    message: "Webhook is active and listening for POST requests from Telegram." 
  });
}

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

    // --- Manejo de la foto ---
    const hasPhoto = Array.isArray(msg.photo) && msg.photo.length > 0;
    let photoUrl: string | null = null;

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

    if (existingLead) {
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
        await sendMessage(chatId, "Ocurrió un error. Intentá de nuevo en unos minutos. 😕");
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
            // Guardar como asset
            await supabase.from("b2c_lead_assets").insert({
              lead_id: leadId,
              asset_type: "SURFACE_PHOTO",
              file_url: photoUrl,
              file_name: `photo_${Date.now()}.jpg`,
            });

            // Actualizar assessment
            await supabase
              .from("b2c_surface_assessments")
              .update({ photo_url: photoUrl, updated_at: new Date().toISOString() })
              .eq("lead_id", leadId);
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
      hasFile: false,
      fileUrl: null,
      fileName: null,
    };

    // --- Invocar al Motor del Agente ---
    try {
      console.log("🤖 [AGENTE] Invocando Vercel AI SDK...");
      const agentResponse = await processAgentTurn(leadId, context, incomingMsg);
      console.log("✅ [AGENTE] Respuesta generada exitosamente. Enviando...");

      // Guardar el mensaje del usuario en el historial
      await supabase.from("b2c_conversation_history").insert({
        lead_id: leadId,
        role: "user",
        content: incomingMsg.hasPhoto ? `[FOTO ENVIADA]\n${text}` : text,
      });

      // El agente puede retornar múltiples mensajes de texto o imágenes
      for (const reply of agentResponse.messages) {
        console.log(`✉️ [OUT] ${reply}`);
        await sendMessage(chatId, reply);
        
        // Guardar la respuesta del modelo en historial
        await supabase.from("b2c_conversation_history").insert({
          lead_id: leadId,
          role: "assistant",
          content: reply,
        });
      }

      for (const img of agentResponse.images) {
        console.log(`🖼️ [OUT] URL Imagen: ${img}`);
        await sendPhoto(chatId, img);
      }

    } catch (agentError) {
      console.error("❌ [ERROR AGENTE] Vercel AI SDK falló:", agentError);
      await sendMessage(
        chatId,
        "Disculpá, estoy teniendo un problema técnico. 😕 ¿Podés intentar de nuevo en unos segundos?"
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
  };

  try {
    // Traer Superficie (última valoración)
    const { data: surfaceData } = await supabase
      .from("b2c_surface_assessments")
      .select("*")
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
    }
  } catch (err) {
    console.error("⚠️ [WARNING] Error al construir el contexto:", err);
  }

  return context;
}
