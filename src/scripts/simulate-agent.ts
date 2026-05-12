/**
 * simulate-agent.ts — QA Automation para el Pixel Art Agent
 *
 * Ejecuta escenarios de conversación simulada contra el motor del agente,
 * usando un LLM "User-Proxy" para simular respuestas de clientes ficticios.
 *
 * Uso: npx tsx src/scripts/simulate-agent.ts
 * Requiere: OPENAI_API_KEY en el entorno.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { buildSystemPrompt } from "../agent/system-prompt";
import type { LeadContext } from "../agent/types";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const MAX_TURNS = 10; // Máximo de intercambios por escenario
const AGENT_MODEL = "gpt-4o-mini";
const USER_PROXY_MODEL = "gpt-4o-mini";

interface SimMessage {
  role: "user" | "assistant";
  content: string;
}

interface TestScenario {
  name: string;
  description: string;
  userProxyPersonality: string;
  initialContext: LeadContext;
  validate: (conversation: SimMessage[], rawAgentOutputs: string[]) => {
    passed: boolean;
    reason: string;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO BASE (VACÍO — LEAD NUEVO)
// ═══════════════════════════════════════════════════════════════════════════

function freshContext(overrides?: Partial<LeadContext>): LeadContext {
  return {
    leadId: "sim-test-" + Date.now(),
    currentStage: "INITIAL_CONTACT",
    customerName: "Cliente Test",
    phone: null,
    channel: "TELEGRAM",
    surfaceType: null,
    isFullObject: false,
    hasPhoto: false,
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
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE SIMULACIÓN (CON AUTO-SENSING MOCK)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Duplicado de la lógica de auto-sensing de agent/index.ts
 * para que el simulador sea fiel a la realidad.
 */
function mockAutoSensing(userMessage: string, context: LeadContext): Partial<LeadContext> {
  const updates: Partial<LeadContext> = {};

  // 1. Medidas
  const mRegex = /(\d+(?:[.,]\d+)?)\s*(?:m|mts|mt|metros)?\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)\s*(?:m|mts|mt|metros)?/i;
  const match = userMessage.match(mRegex);
  if (match) {
    const w = parseFloat(match[1].replace(",", "."));
    const h = parseFloat(match[2].replace(",", "."));
    const m2 = Number((w * h).toFixed(2));
    updates.measurements = `${w}m × ${h}m = ${m2} m²`;
    updates.squareMeters = m2;
  }

  // 2. Superficie
  const surfaceMapping: Record<string, string> = {
    pared: "WALL",
    vidrio: "GLASS",
    ventana: "GLASS",
    heladera: "FRIDGE",
    auto: "VEHICLE",
    camioneta: "VEHICLE",
    vehiculo: "VEHICLE",
    vehículo: "VEHICLE",
    chapa: "METAL",
  };
  for (const [key, val] of Object.entries(surfaceMapping)) {
    if (userMessage.toLowerCase().includes(key)) {
      updates.surfaceType = val;
      break;
    }
  }

  // 3. Escenario (Keyword detection removed to match real agent/index.ts)

  return updates;
}

/**
 * Ejecuta un turno del agente directamente (sin Supabase ni Redis).
 * Usa solo el System Prompt + historial en memoria.
 */
async function simulateAgentTurn(
  context: LeadContext,
  history: SimMessage[],
  userMessage: string
): Promise<{ agentReply: string; rawOutput: string; updatedContext: LeadContext }> {
  
  // Aplicar auto-sensing antes del turno (como hace processAgentTurn)
  const autoUpdates = mockAutoSensing(userMessage, context);
  let workingContext = { ...context, ...autoUpdates };

  const historyForAI = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  const prompt = buildSystemPrompt(workingContext);

  const result = await generateText({
    model: openai(AGENT_MODEL),
    system: prompt,
    messages: historyForAI,
  });

  const rawOutput = result.text;

  // Parsear comandos internos para actualizar el contexto en memoria
  const updatedContext = { ...workingContext };

  const surfaceMatch = rawOutput.match(
    /\[\[SET_SURFACE:\s*(\w+)\s*,\s*FULL:\s*(\w+)\s*\]\]/i
  );
  if (surfaceMatch) {
    updatedContext.surfaceType = surfaceMatch[1];
    updatedContext.isFullObject = surfaceMatch[2].toLowerCase() === "true";
  }

  const measureMatch = rawOutput.match(
    /\[\[SET_MEASUREMENTS:\s*W:\s*([\d.]+)\s*,\s*H:\s*([\d.]+)\s*\]\]/i
  );
  if (measureMatch) {
    const w = parseFloat(measureMatch[1]);
    const h = parseFloat(measureMatch[2]);
    const m2 = Number((w * h).toFixed(2));
    updatedContext.measurements = `${w}m × ${h}m = ${m2} m²`;
    updatedContext.squareMeters = m2;
  }

  const printMatch = rawOutput.match(/\[\[SET_PRINT:\s*(\w+)\s*\]\]/i);
  if (printMatch) {
    updatedContext.printFileScenario = printMatch[1];
  }

  const installMatch = rawOutput.match(/\[\[SET_INSTALL:\s*(true|false)\s*\]\]/i);
  if (installMatch) {
    updatedContext.installationRequired = installMatch[1].toLowerCase() === "true";
  }

  const addressMatch = rawOutput.match(/\[\[SET_ADDRESS:\s*(.*?)\s*\]\]/i);
  if (addressMatch) {
    updatedContext.address = addressMatch[1];
  }

  const phoneMatch = rawOutput.match(/\[\[SET_PHONE:\s*(.*?)\s*\]\]/i);
  if (phoneMatch) {
    updatedContext.phone = phoneMatch[1];
  }

  // ─── AUTO-QUOTE LOGIC (Matching agent/index.ts) ───
  const isPhotoValid = updatedContext.hasPhoto || updatedContext.photoWaived;
  const isFlowComplete = 
    Boolean(updatedContext.squareMeters) && 
    Boolean(updatedContext.surfaceType) && 
    Boolean(updatedContext.printFileScenario) && 
    updatedContext.installationRequired !== null && 
    isPhotoValid;

  const needsQuote = isFlowComplete && !rawOutput.includes("[[GENERATE_QUOTE]]");
  let finalRawOutput = rawOutput;
  if (needsQuote) {
    finalRawOutput += "\n[[GENERATE_QUOTE]]";
  }

  // Especial para IMAGE_BANK (Match real agent/index.ts)
  if (updatedContext.printFileScenario === "IMAGE_BANK" && !updatedContext.catalogGuideSent) {
    finalRawOutput = finalRawOutput.trim() + "\n\nCatálogo: https://pixel-art-agent.vercel.app/catalog";
    updatedContext.catalogGuideSent = true;
  }

  // Limpiar texto para el display
  const cleanText = finalRawOutput
    .replace(/\[\[.*?\]\]/g, "")
    .trim();

  return {
    agentReply: cleanText,
    rawOutput: finalRawOutput,
    updatedContext,
  };
}

/**
 * Genera la respuesta del "User-Proxy" (cliente simulado).
 */
async function simulateUserReply(
  personality: string,
  conversation: SimMessage[]
): Promise<string> {
  const systemPrompt = `Eres un cliente que contacta a una empresa de vinilos decorativos por Telegram.
Tu personalidad es: ${personality}

REGLAS:
- Responde en español rioplatense informal.
- Respuestas cortas y naturales (1-2 oraciones máximo).
- No inventes datos técnicos complejos.
- Actúa de forma coherente con tu personalidad.
- NO uses comandos internos como [[SET_SURFACE]] ni nada entre corchetes.
- Si te preguntan algo específico (como dirección o teléfono), inventá uno que parezca real de Buenos Aires.
- Si te preguntan algo sobre el diseño, responde directamente sin rodeos.`;

  // Si la conversación está vacía, generar el primer mensaje del cliente
  if (conversation.length === 0) {
    const result = await generateText({
      model: openai(USER_PROXY_MODEL),
      system: systemPrompt,
      prompt: "Escribe tu primer mensaje para contactar a la empresa de vinilos. Sé breve y natural.",
    });
    return result.text;
  }

  // Invertir roles: lo que dijo el "assistant" (agente) es el "user" para el proxy
  const result = await generateText({
    model: openai(USER_PROXY_MODEL),
    system: systemPrompt,
    messages: conversation.map((m) => ({
      role: m.role === "assistant" ? "user" : ("assistant" as const),
      content: m.content,
    })),
  });

  return result.text;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFINICIÓN DE ESCENARIOS
// ═══════════════════════════════════════════════════════════════════════════

const scenarios: TestScenario[] = [
  {
    name: "HAPPY PATH",
    description:
      "Cliente que quiere plotear un vidrio, da medidas 1.2x0.8 y elige diseño personalizado.",
    userProxyPersonality:
      "Querés plotear un vidrio de tu oficina. Las medidas son 1.2 metros de ancho por 0.8 de alto. La superficie está perfecta, lisa y limpia. Querés imprimir un archivo que ya tenés listo. Sos directo y cooperativo. Si te piden dirección, es Av. Corrientes 1234, CABA. Teléfono 1122334455.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      const hasTerminalCommand = rawOutputs.some((r) =>
        r.includes("[[GENERATE_QUOTE]]") || r.includes("[[CLOSE_DEAL]]")
      );
      const hasSurface = rawOutputs.some((r) =>
        /GLASS/i.test(r) || /vidrio/i.test(r)
      );
      
      if (!hasTerminalCommand) {
        return { passed: false, reason: "No se disparó [[GENERATE_QUOTE]] ni [[CLOSE_DEAL]]" };
      }

      return { passed: true, reason: "Flujo completo ejecutado correctamente." };
    },
  },
  {
    name: "VEHICLE HANDOFF PATH",
    description: "Cliente que quiere plotear su auto. El bot DEBE bloquear y derivar.",
    userProxyPersonality: "Querés plotear tu auto (un Fiat Cronos). Decilo claramente en el primer mensaje. Sos amable.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      const hasBlockVehicle = rawOutputs.some(r => /\[\[BLOCK:VEHICLE\]\]/i.test(r));
      const mentionsContact = rawOutputs.some(r => /contact|pronto|revisión|técnica|vehículo|persona/i.test(r));

      if (!hasBlockVehicle) {
        return { passed: false, reason: "No se detectó [[BLOCK:VEHICLE]]" };
      }
      if (!mentionsContact) {
        return { passed: false, reason: "El bot no mencionó contacto humano/revisión técnica." };
      }

      return { passed: true, reason: "Bloqueo de vehículo y handoff detectados correctamente." };
    }
  },
  {
    name: "ERROR PATH — Superficie No Apta",
    description:
      "Cliente que dice que su pared tiene humedad. El bot NO debe pedir medidas.",
    userProxyPersonality:
      "Querés plotear una pared pero tiene bastante humedad y la pintura se está descascarando. Sos honesto sobre el estado de la pared. Si te preguntan sobre la superficie, mencioná siempre la humedad.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      const hasBlock = rawOutputs.some((r) => /\[\[BLOCK:/i.test(r));
      const hasQuote = rawOutputs.some((r) =>
        r.includes("[[GENERATE_QUOTE]]")
      );

      if (hasQuote) {
        return {
          passed: false,
          reason: "El bot generó cotización a pesar de superficie dañada",
        };
      }
      if (!hasBlock) {
        return {
          passed: false,
          reason: "No se emitió [[BLOCK:...]] ante humedad.",
        };
      }

      return {
        passed: true,
        reason: "Bloqueo correcto por humedad.",
      };
    },
  },
  {
    name: "IMAGE BANK PATH",
    description:
      "Cliente que quiere ver opciones del catálogo.",
    userProxyPersonality:
      "Querés plotear la heladera. No tenés foto. Medidas 1.80 x 0.60. Querés ver el catálogo de imágenes.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      const hasCatalogLink = rawOutputs.some((r) =>
        /pixel-art-agent\.vercel\.app\/catalog/i.test(r)
      );

      if (!hasCatalogLink) {
        return {
          passed: false,
          reason: "El bot no envió el link al catálogo.",
        };
      }

      return {
        passed: true,
        reason: "Link al catálogo enviado correctamente.",
      };
    },
  },
];

// ═══════════════════════════════════════════════════════════════════════════
// EJECUCIÓN
// ═══════════════════════════════════════════════════════════════════════════

async function runScenario(scenario: TestScenario): Promise<{
  passed: boolean;
  reason: string;
  conversation: SimMessage[];
}> {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`🧪 ESCENARIO: ${scenario.name}`);
  console.log(`📋 ${scenario.description}`);
  console.log("═".repeat(70));

  const conversation: SimMessage[] = [];
  const rawAgentOutputs: string[] = [];
  let context = { ...scenario.initialContext };

  // El usuario inicia la conversación
  let userMessage = await simulateUserReply(
    scenario.userProxyPersonality,
    []
  );

  for (let turn = 1; turn <= MAX_TURNS; turn++) {
    console.log(`\n--- Turno ${turn} ---`);
    console.log(`👤 CLIENTE: ${userMessage}`);
    conversation.push({ role: "user", content: userMessage });

    // Turno del agente
    const { agentReply, rawOutput, updatedContext } = await simulateAgentTurn(
      context,
      conversation.slice(0, -1),
      userMessage
    );

    context = updatedContext;
    rawAgentOutputs.push(rawOutput);
    
    console.log(`🤖 AGENTE: ${agentReply}`);
    if (rawOutput !== agentReply) {
      const commands = rawOutput.match(/\[\[.*?\]\]/g);
      if (commands) {
        console.log(`   📌 COMANDOS: ${commands.join(", ")}`);
      }
    }

    conversation.push({ role: "assistant", content: agentReply });

    // Verificar si ya podemos evaluar (early exit para bloqueos)
    if (rawOutput.includes("[[BLOCK:")) {
      console.log(`\n🚫 Bloqueo detectado. Finalizando escenario.`);
      break;
    }
    if (rawOutput.includes("[[GENERATE_QUOTE]]")) {
      console.log(`\n💰 Cotización generada. Finalizando escenario.`);
      break;
    }

    // Si no hemos terminado, generar siguiente respuesta del usuario
    if (turn < MAX_TURNS) {
      userMessage = await simulateUserReply(
        scenario.userProxyPersonality,
        conversation
      );
    }
  }

  // Validar resultado
  const result = scenario.validate(conversation, rawAgentOutputs);
  return { ...result, conversation };
}

async function main() {
  console.log("🚀 Pixel Art Agent — Suite de Simulación de QA");
  console.log(`   Modelo Agente: ${AGENT_MODEL}`);
  console.log(`   Modelo User-Proxy: ${USER_PROXY_MODEL}`);
  console.log(`   Turnos máximos por escenario: ${MAX_TURNS}`);

  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY no está configurada. Abortando.");
    process.exit(1);
  }

  const results: Array<{ name: string; passed: boolean; reason: string }> = [];

  for (const scenario of scenarios) {
    try {
      const result = await runScenario(scenario);
      results.push({
        name: scenario.name,
        passed: result.passed,
        reason: result.reason,
      });
    } catch (err) {
      console.error(`❌ Error ejecutando escenario "${scenario.name}":`, err);
      results.push({
        name: scenario.name,
        passed: false,
        reason: `Error de ejecución: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // REPORTE FINAL
  // ═══════════════════════════════════════════════════════════════════════
  console.log(`\n\n${"═".repeat(70)}`);
  console.log("📊 REPORTE FINAL DE QA");
  console.log("═".repeat(70));

  let allPassed = true;
  for (const r of results) {
    const icon = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${icon} | ${r.name}`);
    console.log(`       ${r.reason}`);
    if (!r.passed) allPassed = false;
  }

  console.log("═".repeat(70));
  console.log(
    allPassed
      ? "🎉 TODOS LOS TESTS PASARON"
      : "⚠️  ALGUNOS TESTS FALLARON — Revisar los resultados arriba"
  );
  console.log("═".repeat(70));

  process.exit(allPassed ? 0 : 1);
}

main();
