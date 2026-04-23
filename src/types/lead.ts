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
  "QUOTE_READY",
  "QUOTE_GENERATED",
  "BLOCKED",
  "REQUIRES_HUMAN_REVIEW",
  "CLOSED_WON",
  "CLOSED_LOST",
] as const;

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
