import "dotenv/config";
import { processAgentTurn } from "./src/agent/index";
import { createClient } from "@supabase/supabase-js";

// Mocking some values for test
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

async function appendToHistory(leadId: string, role: "user" | "assistant", content: string) {
  const key = `chat:${leadId}:history`;
  
  // 1. Obtener historial actual
  const raw = await redis.get<string>(key);
  const history = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : [];
  
  // 2. Agregar nuevo mensaje
  history.push({ role, content });
  
  // 3. Guardar (limitando a los últimos 30)
  const updated = history.slice(-30);
  await redis.set(key, JSON.stringify(updated), { ex: 3600 * 24 });
  
  // 4. También guardar en Supabase para auditoría
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

  // Crear el lead
  await supabase.from("b2c_leads").insert({
    id: mockLeadId,
    phone: "+59899123456",
    current_stage: "NEW",
  });

  for (const [index, msg] of messages.entries()) {
    console.log(`\n---------------------------------`);
    console.log(`💬 USUARIO (Msg ${index + 1}): "${msg}"`);
    console.log(`---------------------------------`);
    
    // Leer el lead para armar el context
    const { data: currentLead } = await supabase
      .from("b2c_leads")
      .select("*, b2c_surface_assessments(*), b2c_measurements(*), b2c_quotes(*)")
      .eq("id", mockLeadId)
      .single();

    const surface = currentLead?.b2c_surface_assessments?.[0];
    const measures = currentLead?.b2c_measurements?.[0];
    const quote = currentLead?.b2c_quotes?.[0];

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
      photoWaived: surface?.photo_waived || false,
    };

    const incomingMsg = {
      text: msg,
      hasPhoto: false,
      photoUrl: null,
      hasFile: false,
      fileUrl: null,
      fileName: null
    };

    await appendToHistory(mockLeadId, "user", msg);

    const response = await processAgentTurn(mockLeadId, context, incomingMsg);

    console.log(`🤖 AGENTE RESPUESTAS:`);
    for (const r of response.messages) {
      console.log(`  ➤ ${r}`);
      await appendToHistory(mockLeadId, "assistant", r);
    }
    
    if (response.images && response.images.length > 0) {
      console.log(`📸 IMÁGENES ENVIADAS: ${response.images.length}`);
    }

    // Esperar 2 segundos para dar tiempo a inserciones asíncronas en DB
    await new Promise((r) => setTimeout(r, 2000));
  }

  // Comprobar estado final
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

async function main() {
  // Flujo 1: Superficie mala (deriva a humano)
  await runTest(
    "1. Superficie con humedad (Handoff)",
    [
      "Hola, quiero plotear una pared",
      "La pared tiene humedad y se está descascarando un poco, pero quiero taparlo"
    ],
    "BLOCKED"
  );

  // Flujo 2: Vehículo (Handoff inmediato)
  await runTest(
    "2. Vehículo (HUMAN_HANDOFF)",
    [
      "Hola, quiero plotear mi auto"
    ],
    "HUMAN_HANDOFF"
  );

  // Flujo 3: Instalación sin datos (Loop)
  await runTest(
    "3. Instalación requiere teléfono y dirección",
    [
      "Hola, quiero plotear una pared de 2x2, ya tengo el archivo y necesito que lo instalen",
      "Está perfecta",
      "Mi dirección es Calle Falsa 123",
      "Mi teléfono es 11 1234 5678"
    ],
    "QUOTE_GENERATED"
  );

  // Flujo 4: Heladera (Medidas pequeñas, diseño personalizado)
  await runTest(
    "4. Heladera con diseño personalizado",
    [
      "Hola, quiero plotear mi heladera",
      "Está impecable, cero óxido, tiene 2 años",
      "Mide 60cm de ancho por 1.80m de alto",
      "Quiero un diseño personalizado, tengo una idea de Los Simpsons",
      "Lo retiro yo por el local"
    ],
    "QUOTE_GENERATED"
  );
}

main().catch(console.error);
