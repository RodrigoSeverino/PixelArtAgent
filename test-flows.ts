import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

async function start() {
  const { processAgentTurn } = await import("./src/agent/index");
  
  // Mocking some values for test
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { Redis } = await import("@upstash/redis");

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });

  async function appendToHistory(leadId: string, role: "user" | "assistant", content: string) {
    const key = `chat:${leadId}:history`;
    const raw = await redis.get<string>(key);
    const history = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
    history.push({ role, content });
    const updated = history.slice(-30);
    await redis.set(key, JSON.stringify(updated), { ex: 3600 * 24 });
    await supabase.from("b2c_conversation_history").insert({
      lead_id: leadId,
      role,
      content
    });
  }

  async function runTest(testName: string, messages: string[], expectedEndStage?: string) {
    console.log(`\n======================================================`);
    console.log(`🚀 INICIANDO PRUEBA: ${testName}`);
    console.log(`======================================================\n`);

    const mockLeadId = crypto.randomUUID();

    await supabase.from("b2c_leads").insert({
      id: mockLeadId,
      phone: "+59899123456",
      current_stage: "NEW",
    });

    for (const [index, msg] of messages.entries()) {
      console.log(`\n---------------------------------`);
      console.log(`💬 USUARIO (Msg ${index + 1}): "${msg}"`);
      console.log(`---------------------------------`);
      
      const { data: currentLead } = await supabase
        .from("b2c_leads")
        .select("*, b2c_surface_assessments(*), b2c_measurements(*), b2c_quotes(*)")
        .eq("id", mockLeadId)
        .single();

      const surface = Array.isArray(currentLead?.b2c_surface_assessments) ? currentLead.b2c_surface_assessments[0] : currentLead?.b2c_surface_assessments;
      const measures = Array.isArray(currentLead?.b2c_measurements) ? currentLead.b2c_measurements[0] : currentLead?.b2c_measurements;
      const quote = Array.isArray(currentLead?.b2c_quotes) ? currentLead.b2c_quotes[0] : currentLead?.b2c_quotes;

      console.log(`DEBUG DATA - Surface: ${!!surface}, Measures: ${!!measures}, Quote: ${!!quote}`);
      if (measures) console.log(`DEBUG MEASURES: ${JSON.stringify(measures)}`);

      const context = {
        leadId: mockLeadId,
        currentStage: currentLead?.current_stage || "NEW",
        customerName: "Test User",
        phone: currentLead?.phone || null,
        channel: "TELEGRAM" as any,
        surfaceType: surface?.surface_type || null,
        isFullObject: surface?.is_full_object || false,
        hasPhoto: !!surface?.photo_url,
        photoUrl: surface?.photo_url || null,
        measurements: measures ? `${measures.width_meters}m x ${measures.height_meters}m` : null,
        squareMeters: measures?.square_meters || null,
        printFileScenario: quote?.print_file_scenario || null,
        quoteSummary: quote ? `Total: $${quote.total_price_uyu}` : null,
        installationRequired: quote?.installation_required ?? null,
        orderNumber: currentLead?.order_number || null,
        address: currentLead?.address || null,
        surfaceGuideSent: false,
        measureGuideSent: false,
        photoWaived: !!surface?.photo_waived,
        catalogGuideSent: false,
      };

      const isSubirFoto = msg === "SUBIR_FOTO";
      const incomingMsg = {
        text: isSubirFoto ? "Aquí tenés la foto." : msg,
        hasPhoto: isSubirFoto,
        photoUrl: isSubirFoto ? "https://placehold.co/600x400/png" : null,
        hasFile: false,
        fileUrl: null,
        fileName: null
      };

      if (isSubirFoto) {
        await supabase.from("b2c_surface_assessments").upsert({
          lead_id: mockLeadId,
          photo_url: incomingMsg.photoUrl,
          updated_at: new Date().toISOString()
        }, { onConflict: "lead_id" });
      }

      await appendToHistory(mockLeadId, "user", incomingMsg.text);
      const response = await processAgentTurn(mockLeadId, context, incomingMsg);

      console.log(`🤖 AGENTE RESPUESTAS:`);
      for (const r of response.messages) {
        console.log(`  ➤ ${r}`);
        await appendToHistory(mockLeadId, "assistant", r);
      }
      
      await new Promise((r) => setTimeout(r, 2000));
    }

    const { data: lead } = await supabase
      .from("b2c_leads")
      .select("current_stage")
      .eq("id", mockLeadId)
      .single();

    console.log(`\n📊 ESTADO FINAL DEL LEAD:`);
    console.log(`Stage: ${lead?.current_stage}`);
    
    if (expectedEndStage) {
      if (lead?.current_stage === expectedEndStage) {
        console.log(`✅ PRUEBA EXITOSA (Esperaba ${expectedEndStage})`);
      } else {
        console.log(`❌ PRUEBA FALLIDA (Esperaba ${expectedEndStage}, obtuvo ${lead?.current_stage})`);
      }
    }
    console.log(`======================================================\n`);
  }

  // Correr escenarios
  await runTest(
    "1. Superficie con humedad (Handoff)",
    ["Hola, quiero plotear una pared", "La pared tiene humedad y se está descascarando un poco"],
    "BLOCKED"
  );

  await runTest(
    "2. Vehículo (HUMAN_HANDOFF)",
    ["Hola, quiero plotear mi auto"],
    "HUMAN_HANDOFF"
  );

  await runTest(
    "3. HAPPY PATH (Pared + Instalación + Foto + Datos)",
    [
      "Hola, quiero plotear una pared",
      "Mide 3 metros de ancho por 2.5 de alto",
      "Está impecable. Te mando la foto.",
      "SUBIR_FOTO",
      "Ya tengo el diseño listo para imprimir",
      "Necesito que vengan a instalarlo",
      "Mi teléfono es +598 99 555 666 y la dirección es Av. Italia 1234"
    ],
    "QUOTE_GENERATED"
  );

  await runTest(
    "4. Foto Waived",
    [
      "Hola, quiero plotear mi heladera",
      "Mide 60cm x 1.80m",
      "No puedo mandarte foto ahora",
      "Diseño personalizado de mandalas",
      "Lo retiro yo"
    ],
    "QUOTE_GENERATED"
  );
}

start().catch(console.error);
