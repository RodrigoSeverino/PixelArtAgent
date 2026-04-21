
const { openai } = require("@ai-sdk/openai");
const { generateText } = require("ai");
require("dotenv").config({ path: ".env.local" });

async function test() {
  try {
    console.log("Testeando conexión con OpenAI...");
    const model = openai("gpt-4o-mini");
    const result = await generateText({
      model: model,
      prompt: "Hola, ¿estás ahí?",
    });
    console.log("Respuesta:", result.text);
    
    console.log("\nTesteando el error sospechado (openai.chat)...");
    try {
      const modelError = openai.chat("gpt-4o-mini");
      console.log("openai.chat existe y es válido");
    } catch (e) {
      console.log("Confirmado: openai.chat NO existe o falló:", e.message);
    }
  } catch (err) {
    console.error("Error general:", err);
  }
}

test();
