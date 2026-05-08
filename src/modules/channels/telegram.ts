/**
 * Telegram Bot API client for Pixel Art B2C.
 * Used for testing the agent flow before moving to ManyChat/WhatsApp.
 */

const getApiBase = () => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      first_name: string;
      last_name?: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    photo?: Array<{
      file_id: string;
      file_unique_id: string;
      width: number;
      height: number;
      file_size?: number;
    }>;
    document?: {
      file_id: string;
      file_name?: string;
      mime_type?: string;
      file_size?: number;
    };
    caption?: string;
  };
}

/**
 * Sends a text message to a Telegram chat.
 */
export async function sendMessage(
  chatId: number | string,
  text: string,
  parseMode: "Markdown" | "HTML" = "Markdown"
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("❌ [TELEGRAM API ERROR] sendMessage:", JSON.stringify(result, null, 2));
    }
    return result.ok === true;
  } catch (error) {
    console.error("Error sending Telegram message:", error);
    return false;
  }
}

/**
 * Sends a document (PDF, etc.) to a Telegram chat via a public URL.
 */
export async function sendDocument(
  chatId: number | string,
  documentUrl: string,
  caption?: string
): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBase()}/sendDocument`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        document: documentUrl,
        caption: caption ?? "📄 Presupuesto oficial Pixel Art",
        parse_mode: "Markdown",
      }),
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("❌ [TELEGRAM API ERROR] sendDocument:", JSON.stringify(result, null, 2));
    }
    return result.ok === true;
  } catch (error) {
    console.error("Error sending Telegram document:", error);
    return false;
  }
}

/**
 * Sends a photo (by URL) to a Telegram chat.
 * We fetch the image first and send it as a file to avoid "wrong type of the web page content" errors.
 */
export async function sendPhoto(
  chatId: number | string,
  photoUrl: string,
  caption?: string
): Promise<boolean> {
  try {
    // 1. Fetch the image to ensure it's a valid file and get its buffer
    const imageRes = await fetch(photoUrl);
    if (!imageRes.ok) {
      console.error(`❌ [TELEGRAM] Could not fetch image from URL: ${photoUrl} (Status: ${imageRes.status})`);
      return false;
    }

    const arrayBuffer = await imageRes.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: imageRes.headers.get("content-type") || "image/jpeg" });

    // 2. Prepare multipart/form-data
    const formData = new FormData();
    formData.append("chat_id", String(chatId));
    formData.append("photo", blob, "photo.jpg");
    if (caption) {
      formData.append("caption", caption);
      formData.append("parse_mode", "Markdown");
    }

    const response = await fetch(`${getApiBase()}/sendPhoto`, {
      method: "POST",
      body: formData,
    });

    const result = await response.json();
    if (!result.ok) {
      console.error("❌ [TELEGRAM API ERROR] sendPhoto:", JSON.stringify(result, null, 2));
    }
    return result.ok === true;
  } catch (error) {
    console.error("Error sending Telegram photo:", error);
    return false;
  }
}


/**
 * Gets the download URL for a Telegram file by file_id.
 */
export async function getFileUrl(fileId: string): Promise<string | null> {
  try {
    const response = await fetch(`${getApiBase()}/getFile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });

    const result = await response.json();

    if (result.ok && result.result?.file_path) {
      return `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${result.result.file_path}`;
    }

    return null;
  } catch (error) {
    console.error("Error getting Telegram file:", error);
    return null;
  }
}

/**
 * Sets the webhook URL for the Telegram bot.
 * Call this once during setup to register your webhook endpoint.
 */
export async function setWebhook(webhookUrl: string): Promise<boolean> {
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;

  try {
    const response = await fetch(`${getApiBase()}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        allowed_updates: ["message"],
        secret_token: secretToken, // Se envía el token aquí
      }),
    });

    const result = await response.json();
    console.log("Telegram setWebhook response:", result);
    return result.ok === true;
  } catch (error) {
    console.error("Error setting Telegram webhook:", error);
    return false;
  }
}
