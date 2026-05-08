import { Redis } from "@upstash/redis";

/**
 * Upstash Redis client — inicializado con variables de entorno.
 * Usa el REST transport de Upstash, compatible con Edge Runtime y Vercel Serverless.
 */
let redisClient: Redis | null = null;

try {
  redisClient = Redis.fromEnv();
} catch (e) {
  console.warn("⚠️ [REDIS] No se pudo inicializar Redis desde el entorno (probablemente en build time)");
}

export const redis = redisClient as Redis;

// TTL de la sesión en segundos (90 minutos)
const SESSION_TTL_SECONDS = 90 * 60;

// Máximo de mensajes a conservar en el buffer (rolling window)
const MAX_HISTORY_LENGTH = 30;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image?: string }>;
}

/**
 * Devuelve la key de Redis para el historial de conversación de un lead.
 */
function historyKey(leadId: string): string {
  return `chat:${leadId}:history`;
}

/**
 * Recupera el historial de conversación activo desde Redis.
 * Si la sesión expiró o no existe, devuelve un array vacío (sin crashear).
 */
export async function getConversationHistory(
  leadId: string
): Promise<ChatMessage[]> {
  try {
    const key = historyKey(leadId);
    const raw = await redis.get<string>(key);

    if (!raw) return [];

    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("⚠️ [REDIS] Error leyendo historial, usando contexto vacío:", err);
    return [];
  }
}

/**
 * Agrega un mensaje al historial y renueva el TTL de la sesión.
 * Mantiene solo los últimos MAX_HISTORY_LENGTH mensajes (rolling window).
 */
export async function appendToHistory(
  leadId: string,
  role: "user" | "assistant",
  content: string | Array<{ type: string; text?: string; image?: string }>
): Promise<void> {
  try {
    const key = historyKey(leadId);
    const existing = await getConversationHistory(leadId);

    const updated: ChatMessage[] = [
      ...existing,
      { role, content },
    ].slice(-MAX_HISTORY_LENGTH); // Mantener solo los últimos N mensajes

    await redis.set(key, JSON.stringify(updated), { ex: SESSION_TTL_SECONDS });

    console.log(
      `✅ [REDIS] Historial actualizado: leadId=${leadId} | mensajes=${updated.length} | TTL=${SESSION_TTL_SECONDS}s`
    );
  } catch (err) {
    // Fallo silencioso: el agente sigue funcionando aunque Redis falle
    console.error("⚠️ [REDIS] Error guardando historial (fallo silencioso):", err);
  }
}

/**
 * Elimina el historial de conversación de un lead.
 * Útil para resetear la sesión manualmente si fuera necesario.
 */
export async function clearConversationHistory(leadId: string): Promise<void> {
  try {
    await redis.del(historyKey(leadId));
    console.log(`🗑️ [REDIS] Historial eliminado: leadId=${leadId}`);
  } catch (err) {
    console.error("⚠️ [REDIS] Error eliminando historial:", err);
  }
}
