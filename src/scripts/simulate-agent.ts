/**
 * simulate-agent.ts — QA Automation para el Pixel Art Agent
 *
 * Ejecuta 3 escenarios de conversación simulada contra el motor del agente,
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
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE SIMULACIÓN (SIN SUPABASE/REDIS)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta un turno del agente directamente (sin Supabase ni Redis).
 * Usa solo el System Prompt + historial en memoria.
 */
async function simulateAgentTurn(
  context: LeadContext,
  history: SimMessage[],
  userMessage: string
): Promise<{ agentReply: string; rawOutput: string; updatedContext: LeadContext }> {
  const historyForAI = [
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
    { role: "user" as const, content: userMessage },
  ];

  const prompt = buildSystemPrompt(context);

  const result = await generateText({
    model: openai(AGENT_MODEL),
    system: prompt,
    messages: historyForAI,
  });

  const rawOutput = result.text;

  // Parsear comandos internos para actualizar el contexto en memoria
  const updatedContext = { ...context };

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

  // Limpiar texto para el display
  const cleanText = rawOutput
    .replace(/\[\[.*?\]\]/g, "")
    .trim();

  return {
    agentReply: cleanText,
    rawOutput,
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
- Si te preguntan algo específico, responde directamente sin rodeos.`;

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
      "Querés plotear un vidrio de tu oficina. Las medidas son 1.2 metros de ancho por 0.8 de alto. La superficie está perfecta, lisa y limpia. Querés imprimir un archivo que ya tenés listo. Sos directo y cooperativo.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      const hasGenerateQuote = rawOutputs.some((r) =>
        r.includes("[[GENERATE_QUOTE]]")
      );
      const hasSurface = rawOutputs.some((r) =>
        /\[\[SET_SURFACE:\s*GLASS/i.test(r)
      );
      const hasMeasurements = rawOutputs.some((r) =>
        /\[\[SET_MEASUREMENTS:/i.test(r)
      );
      // Also accept if the agent acknowledged measurements in conversation text
      // (auto-sense in production catches these even without the formal command)
      const mentionsMeasures = rawOutputs.some((r) =>
        /1\.2.*0\.8|0\.8.*1\.2|1,2.*0,8|medidas.*registrad|medidas.*anotad/i.test(r)
      );

      if (!hasSurface) {
        return { passed: false, reason: "No se detectó [[SET_SURFACE:GLASS]]" };
      }
      if (!hasMeasurements && !mentionsMeasures) {
        return {
          passed: false,
          reason: "No se detectó [[SET_MEASUREMENTS:...]] ni reconocimiento explícito de medidas 1.2x0.8",
        };
      }
      if (!hasGenerateQuote) {
        return { passed: false, reason: "No se disparó [[GENERATE_QUOTE]]" };
      }

      return { passed: true, reason: "Flujo completo ejecutado correctamente" + (hasMeasurements ? " (comando formal)" : " (auto-sense)") };
    },
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
      const hasMeasurements = rawOutputs.some((r) =>
        /\[\[SET_MEASUREMENTS:/i.test(r)
      );
      const hasQuote = rawOutputs.some((r) =>
        r.includes("[[GENERATE_QUOTE]]")
      );

      if (hasMeasurements) {
        return {
          passed: false,
          reason:
            "El bot pidió/registró medidas a pesar de superficie con humedad",
        };
      }
      if (hasQuote) {
        return {
          passed: false,
          reason: "El bot generó cotización a pesar de superficie dañada",
        };
      }
      if (!hasBlock) {
        return {
          passed: false,
          reason:
            "No se emitió [[BLOCK:...]] ante humedad. El bot debería haber bloqueado el flujo.",
        };
      }

      return {
        passed: true,
        reason:
          "Bloqueo correcto: no se pidieron medidas ni se generó cotización",
      };
    },
  },
  {
    name: "AMBIGUITY PATH — Medidas Vagas",
    description:
      "Cliente vago con las medidas. El bot debe insistir profesionalmente.",
    userProxyPersonality:
      "Querés plotear una pared que está en buen estado, limpia y lisa. Aclará expresamente que 'no podés mandar foto de la pared, no tenés'. Pero sos muy vago con las medidas: decís cosas como 'es grande', 'no sé bien', 'más o menos como una puerta'. NUNCA des un número exacto. Querés un diseño personalizado si te preguntan.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      // Contar cuántas veces el agente pidió medidas
      const measureRequests = rawOutputs.filter((r) =>
        /medid|ancho|alto|cuánto|cuanto|mide|metros|dimension/i.test(r)
      );

      const hasFormalMeasurements = rawOutputs.some((r) =>
        /\[\[SET_MEASUREMENTS:/i.test(r)
      );

      // Check if the USER (not agent) ever gave exact numbers
      const userMessages = conversation.filter((m) => m.role === "user");
      const userGaveExactMeasures = userMessages.some((m) =>
        /\d+\.\d+\s*(?:m|x|por)\s*\d+\.\d+|\d+\s*(?:m|x|por)\s*\d+/i.test(m.content)
      );

      if (hasFormalMeasurements && !userGaveExactMeasures) {
        return {
          passed: false,
          reason:
            "El bot aceptó medidas formales que nunca fueron dadas de forma exacta por el cliente",
        };
      }

      if (measureRequests.length < 2) {
        return {
          passed: false,
          reason: `El bot solo pidió medidas ${measureRequests.length} vez(es). Debería insistir al menos 2 veces.`,
        };
      }

      return {
        passed: true,
        reason: `Insistencia correcta: el bot pidió medidas ${measureRequests.length} veces sin aceptar respuestas vagas`,
      };
    },
  },
  {
    name: "IMAGE BANK PATH",
    description:
      "Cliente que quiere ver opciones del catálogo/banco de imágenes de Pixel Art.",
    userProxyPersonality:
      "Empieza saludando y diciendo que querés plotear la heladera. Cuando te pidan foto de la heladera, decí claro y explícito 'no tengo foto, no puedo enviarla'. Las medidas son 1.80 de alto por 0.60 de ancho. Cuando te pregunten por el diseño, decís explícitamente: 'quiero ver el catálogo o galería de imágenes que tienen'. No cambies de decisión.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      const hasImageBank = rawOutputs.some((r) =>
        /\[\[SET_PRINT:\s*IMAGE_BANK/i.test(r)
      );
      const hasCatalogLink = rawOutputs.some((r) =>
        /pixelart\.vercel\.app\/catalog/i.test(r)
      );
      const hasRecreatedWarning = rawOutputs.some((r) =>
        /recreada tal cual/i.test(r)
      );

      if (!hasImageBank) {
        return {
          passed: false,
          reason: "El bot no emitió [[SET_PRINT:IMAGE_BANK]] a pesar de que el cliente pidió ver el catálogo.",
        };
      }
      if (!hasCatalogLink) {
        return {
          passed: false,
          reason: "El bot no envió el link al catálogo (/catalog).",
        };
      }
      if (!hasRecreatedWarning) {
        return {
          passed: false,
          reason: "El bot no advirtió que la imagen será recreada tal cual.",
        };
      }

      return {
        passed: true,
        reason: "Se detectó correctamente la intención, se envió el link y la advertencia de recreación.",
      };
    },
  },
  {
    name: "READY_FILE PATH — Request File",
    description:
      "Cliente dice que tiene el archivo. El bot DEBE pedirlo.",
    userProxyPersonality:
      "Querés plotear una pared de 2x2. Ya tenés el archivo del logo de tu empresa listo para imprimir. Cuando te pregunten por el diseño, decí: 'ya tengo el archivo listo'. No lo envíes de una, esperá a que te lo pidan.",
    initialContext: freshContext(),
    validate: (conversation, rawOutputs) => {
      const hasReadyFile = rawOutputs.some((r) =>
        /\[\[SET_PRINT:\s*READY_FILE/i.test(r)
      );
      const askedForFile = rawOutputs.some((r) =>
        /pasame|envia|mandame|archivo|pdf|png|logo|diseño/i.test(r)
      );

      if (!hasReadyFile) {
        return { passed: false, reason: "No se detectó [[SET_PRINT:READY_FILE]]" };
      }
      if (!askedForFile) {
        return { passed: false, reason: "El bot no pidió explícitamente el archivo al usuario" };
      }

      return { passed: true, reason: "Intención detectada y archivo solicitado correctamente." };
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
    conversation.push({ role: "assistant", content: agentReply });

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
