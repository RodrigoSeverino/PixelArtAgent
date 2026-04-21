import { supabase } from "@/lib/supabase";

type SurfaceTypeInput =
  | "WALL"
  | "FRIDGE"
  | "GLASS"
  | "WOOD"
  | "VEHICLE"
  | "PARED"
  | "HELADERA"
  | "VIDRIO"
  | "MADERA"
  | "VEHICULO";

function normalizeSurfaceType(surfaceType: string): string | null {
  const normalized = surfaceType.trim().toUpperCase();

  const map: Record<string, string> = {
    WALL: "WALL",
    PARED: "WALL",

    FRIDGE: "FRIDGE",
    HELADERA: "FRIDGE",

    GLASS: "GLASS",
    VIDRIO: "GLASS",

    WOOD: "WOOD",
    MADERA: "WOOD",

    VEHICLE: "VEHICLE",
    VEHICULO: "VEHICLE",
  };

  return map[normalized] ?? null;
}

export const createSetSurfaceTool = (leadId: string) => ({
  description:
    "Registra el tipo de superficie. Acepta WALL, FRIDGE, GLASS, WOOD, VEHICLE y también sus equivalentes en español.",

  parameters: {
    type: "object",
    properties: {
      surfaceType: {
        type: "string",
        enum: [
          "WALL",
          "FRIDGE",
          "GLASS",
          "WOOD",
          "VEHICLE",
          "PARED",
          "HELADERA",
          "VIDRIO",
          "MADERA",
          "VEHICULO",
        ],
        description: "Tipo de superficie",
      },
      isFullObject: {
        type: "boolean",
        description: "Si es objeto completo",
      },
    },
    required: ["surfaceType", "isFullObject"],
  },

  execute: async ({
    surfaceType,
    isFullObject,
  }: {
    surfaceType: SurfaceTypeInput;
    isFullObject: boolean;
  }) => {
    const now = new Date().toISOString();

    const normalizedSurfaceType = normalizeSurfaceType(surfaceType);

    if (!normalizedSurfaceType) {
      return {
        success: false,
        message: `Tipo de superficie inválido: ${surfaceType}`,
      };
    }

    const { error: surfaceError } = await supabase
      .from("b2c_surface_assessments")
      .upsert(
        {
          lead_id: leadId,
          surface_type: normalizedSurfaceType,
          is_full_object: isFullObject,
          general_condition: "UNKNOWN",
          texture: "UNKNOWN",
          suitability_status: "NOT_ENOUGH_INFORMATION",
          updated_at: now,
        },
        { onConflict: "lead_id" }
      );

    if (surfaceError) {
      return {
        success: false,
        message: "Error al guardar la superficie.",
        debug: {
          code: surfaceError.code,
          details: surfaceError.details,
          hint: surfaceError.hint,
        },
      };
    }

    const { error: leadError } = await supabase
      .from("b2c_leads")
      .update({
        current_stage: isFullObject
          ? "REQUIRES_HUMAN_REVIEW"
          : "SURFACE_SELECTED",
        updated_at: now,
      })
      .eq("id", leadId);

    if (leadError) {
      return {
        success: false,
        message: "La superficie se guardó, pero no se pudo actualizar el lead.",
        debug: {
          code: leadError.code,
          details: leadError.details,
          hint: leadError.hint,
        },
      };
    }

    return {
      success: true,
      message: `Superficie registrada: ${normalizedSurfaceType}.`,
      data: {
        surfaceType: normalizedSurfaceType,
        isFullObject,
      },
    };
  },
});