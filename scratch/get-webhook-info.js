
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

async function run() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  console.log("Checking webhook info for bot token:", token ? token.substring(0, 10) + "..." : "MISSING");
  
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN no encontrado en .env.local");
    return;
  }

  const response = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  const result = await response.json();
  console.log("Webhook Info:", JSON.stringify(result, null, 2));
}

run();
