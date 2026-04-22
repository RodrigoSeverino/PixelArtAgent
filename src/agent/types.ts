/**
 * Tipos compartidos del agente conversacional.
 *
 * Estos tipos definen la interfaz entre el webhook (Telegram/WhatsApp),
 * el motor del agente, y las tools que ejecutan lógica de negocio.
 */

import type { LeadStage } from "@/types/lead";

/* ============================================
   CONTEXTO DEL LEAD
   Se inyecta en cada llamada al agente para 
   que el LLM sepa en qué punto está el cliente.
   ============================================ */

export interface LeadContext {
  /** UUID del lead en Supabase */
  leadId: string;

  /** Etapa actual del flujo comercial */
  currentStage: LeadStage;

  /** Nombre del cliente (si ya lo dijo) */
  customerName: string | null;

  /** Teléfono */
  phone: string | null;

  /** Canal de entrada */
  channel: "TELEGRAM" | "WHATSAPP" | "WEB";

  /** Tipo de superficie elegida (si ya eligió) */
  surfaceType: string | null;

  /** Si es objeto completo (heladera entera, etc.) */
  isFullObject: boolean;

  /** Si ya envió foto de la superficie */
  hasPhoto: boolean;

  /** URL de la foto (si existe) */
  photoUrl: string | null;

  /** Medidas en formato legible ("2.5m × 1.8m = 4.5 m²") */
  measurements: string | null;

  /** Metros cuadrados calculados */
  squareMeters: number | null;

  /** Escenario de imagen elegido */
  printFileScenario: string | null;

  /** Resumen de cotización si ya existe */
  quoteSummary: string | null;
}

/* ============================================
   MENSAJE ENTRANTE
   Representación normalizada de un mensaje,
   independiente del canal (Telegram/WhatsApp/Web).
   ============================================ */

export interface IncomingMessage {
  /** Texto del mensaje */
  text: string;

  /** Si el mensaje contiene una foto */
  hasPhoto: boolean;

  /** URL de la foto (ya subida a Storage) */
  photoUrl: string | null;

  /** Si el mensaje contiene un documento/archivo */
  hasFile: boolean;

  /** URL del archivo (ya subido a Storage) */
  fileUrl: string | null;

  /** Nombre original del archivo */
  fileName: string | null;
}

/* ============================================
   RESPUESTA DEL AGENTE
   Lo que el motor devuelve al webhook para
   enviar de vuelta al cliente.
   ============================================ */

export interface AgentResponse {
  /** Mensajes de texto para enviar al cliente */
  messages: string[];

  /** URLs de imágenes para enviar al cliente */
  images: string[];

  /** URLs de documentos (PDFs) para enviar al cliente */
  documents: string[];

  /** Nueva etapa del lead después de esta interacción */
  newStage: LeadStage | "STAY";

  /** Si el caso requiere revisión humana */
  requiresHumanReview: boolean;
}

/* ============================================
   RESULTADO DE UN TOOL
   Lo que cada tool retorna al agente para
   que incorpore en su respuesta.
   ============================================ */

export interface ToolResult {
  /** Si la operación fue exitosa */
  success: boolean;

  /** Mensaje descriptivo del resultado (el agente lo usa para informar al cliente) */
  message: string;

  /** Datos adicionales que el agente puede usar */
  data?: Record<string, unknown>;
}
