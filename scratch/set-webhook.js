import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const url = process.argv[2];
  if (!url) {
    console.error("Uso: node set-webhook.js <URL>");
    process.exit(1);
  }

  // Importar dinámicamente después de cargar env
  const { setWebhook } = await import("../src/modules/channels/telegram.ts");
  
  console.log(`Configurando webhook para: ${url}`);
  const ok = await setWebhook(url);
  if (ok) {
    console.log("✅ Webhook configurado con éxito!");
  } else {
    console.error("❌ Error al configurar el webhook.");
  }
}

run();
