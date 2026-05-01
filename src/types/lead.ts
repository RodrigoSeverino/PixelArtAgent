import type { Measurement } from "./measurement";
import type { Quote } from "./quote";
import type { SurfaceAssessment } from "./surface";

export const LEAD_CHANNELS = ["TELEGRAM", "WHATSAPP", "WEB"] as const;
export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const LEAD_STAGES = [
  "INITIAL_CONTACT",
  "SURFACE_SELECTED",
  "SURFACE_PHOTO_REQUESTED",
  "SURFACE_PHOTO_RECEIVED",
  "MEASUREMENTS_REQUESTED",
  "MEASUREMENTS_RECEIVED",
  "PRINT_FILE_SCENARIO_SELECTED",
  "INSTALLATION_SELECTED",
  "QUOTE_READY",
  "QUOTE_GENERATED",
  "BLOCKED",
  "REQUIRES_HUMAN_REVIEW",
  "HUMAN_HANDOFF",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;

export const LEAD_STAGE_LABELS: Record<string, string> = {
  INITIAL_CONTACT:               "Contacto inicial",
  SURFACE_SELECTED:              "Superficie definida",
  SURFACE_PHOTO_REQUESTED:       "Foto solicitada",
  SURFACE_PHOTO_RECEIVED:        "Foto recibida",
  MEASUREMENTS_REQUESTED:        "Medidas solicitadas",
  MEASUREMENTS_RECEIVED:         "Medidas recibidas",
  PRINT_FILE_SCENARIO_SELECTED:  "Diseño definido",
  INSTALLATION_SELECTED:         "Entrega definida",
  QUOTE_READY:                   "Listo para cotizar",
  QUOTE_GENERATED:               "Cotizado",
  BLOCKED:                       "Bloqueado",
  REQUIRES_HUMAN_REVIEW:         "Revisión humana",
  HUMAN_HANDOFF:                 "Atención manual",
  CLOSED_WON:                    "Vendido ✅",
  CLOSED_LOST:                   "Perdido ❌",
  NEW:                           "Nuevo",
};

export type LeadStage = (typeof LEAD_STAGES)[number];

export interface Lead {
  id: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  channel: LeadChannel;
  telegramChatId: string | null;
  manychatSubscriberId: string | null;
  currentStage: LeadStage;
  createdAt: string;
  updatedAt: string;
  surfaceAssessment: SurfaceAssessment | null;
  measurement: Measurement | null;
  quote: Quote | null;
}
