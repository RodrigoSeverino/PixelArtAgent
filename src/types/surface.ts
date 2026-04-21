export const SURFACE_TYPES = [
  "WALL",
  "WOOD",
  "GLASS",
  "FRIDGE",
  "VEHICLE",
] as const;

export type SurfaceType = (typeof SURFACE_TYPES)[number];

export const SURFACE_LABELS: Record<SurfaceType, string> = {
  WALL: "Pared",
  WOOD: "Madera",
  GLASS: "Vidrio / Ventana",
  FRIDGE: "Heladera",
  VEHICLE: "Auto / Vehículo",
};

export const SURFACE_CONDITIONS = [
  "VERY_GOOD",
  "GOOD",
  "REGULAR",
  "BAD",
  "UNKNOWN",
] as const;

export type SurfaceCondition = (typeof SURFACE_CONDITIONS)[number];

export const SURFACE_TEXTURES = [
  "SMOOTH",
  "IRREGULAR",
  "UNKNOWN",
] as const;

export type SurfaceTexture = (typeof SURFACE_TEXTURES)[number];

export const SURFACE_SUITABILITY_STATUSES = [
  "SUITABLE",
  "SUITABLE_WITH_REVIEW",
  "REQUIRES_HUMAN_REVIEW",
  "NOT_ENOUGH_INFORMATION",
] as const;

export type SurfaceSuitabilityStatus =
  (typeof SURFACE_SUITABILITY_STATUSES)[number];

export interface SurfaceAssessment {
  surfaceType: SurfaceType;
  isFullObject: boolean;
  hasHumidity: boolean;
  hasRust: boolean;
  estimatedAgeYears: number | null;
  generalCondition: SurfaceCondition;
  texture: SurfaceTexture;
  suitabilityStatus: SurfaceSuitabilityStatus;
  photoUrl: string | null;
  notes: string | null;
}
