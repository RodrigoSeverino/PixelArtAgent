/**
 * Tool: set_measurements
 *
 * El agente llama este tool cuando el cliente proporciona las medidas
 * del área donde se aplicará el vinilo.
 *
 * Qué hace:
 * - Calcula los metros cuadrados
 * - Guarda en b2c_measurements
 * - Avanza el lead a MEASUREMENTS_RECEIVED
 * - Evalúa reglas de tamaño (< 1m², 1-3m², ≥ 3m²)
 */

import { supabase } from "@/lib/supabase";
import { validateMeasurements, categorizeSize } from "@/modules/measurements/validation";

type SetMeasurementsInput = {
  widthMeters: number;
  heightMeters: number;
};

export const createSetMeasurementsTool = (leadId: string) => ({
  description:
    "Registra las medidas del área donde va el vinilo. " +
    "Llamar cuando el cliente proporcione ancho y alto en metros. " +
    "Interpretar formatos flexibles como '2.5 x 1.8', '2,5 por 1,8', " +
    "'2 y medio por 1 con 80', etc. y convertirlos a números decimales antes de invocar el tool. " +
    "No llamar este tool si falta una de las dos medidas o si hay ambigüedad.",

  parameters: {
    type: "object",
    properties: {
      widthMeters: {
        type: "number",
        description: "Ancho en metros. Ej: 2.5",
      },
      heightMeters: {
        type: "number",
        description: "Alto en metros. Ej: 1.8",
      },
    },
    required: ["widthMeters", "heightMeters"],
  },

  execute: async ({
    widthMeters,
    heightMeters,
  }: SetMeasurementsInput): Promise<any> => {
    const now = new Date().toISOString();

    try {
      // 1) Normalización y validación usando módulo compartido
      const validation = validateMeasurements(widthMeters, heightMeters);
      
      if (!validation.isValid) {
        console.error("[set_measurements] Validation failed", { leadId, widthMeters, heightMeters, reason: validation.message });
        return {
          success: false,
          message: validation.message,
        };
      }

      const { normalizedWidth, normalizedHeight, squareMeters } = validation;

      // 2) Guardar medidas
      const { error: insertError } = await supabase.from("b2c_measurements").insert({
        lead_id: leadId,
        width_meters: normalizedWidth,
        height_meters: normalizedHeight,
        square_meters: squareMeters,
        updated_at: now,
      });

      if (insertError) {
        console.error("[set_measurements] Error insertando b2c_measurements", {
          leadId,
          normalizedWidth,
          normalizedHeight,
          squareMeters,
          error: insertError,
        });

        return {
          success: false,
          message:
            "Error al guardar las medidas en la base de datos. Intentá nuevamente o derivá el caso a un asesor.",
          debug: {
            code: insertError.code,
            details: insertError.details,
            hint: insertError.hint,
          },
        };
      }

      // 3) Avanzar etapa del lead
      const { error: updateLeadError } = await supabase
        .from("b2c_leads")
        .update({
          current_stage: "MEASUREMENTS_RECEIVED",
          updated_at: now,
        })
        .eq("id", leadId);

      if (updateLeadError) {
        console.error("[set_measurements] Error actualizando lead", {
          leadId,
          error: updateLeadError,
        });

        return {
          success: false,
          message:
            "Las medidas se guardaron, pero no se pudo actualizar la etapa del lead.",
          data: {
            widthMeters: normalizedWidth,
            heightMeters: normalizedHeight,
            squareMeters,
          },
          debug: {
            code: updateLeadError.code,
            details: updateLeadError.details,
            hint: updateLeadError.hint,
          },
        };
      }

      // 4) & 5) Verificar si es objeto completo y Evaluar reglas por tamaño usando módulo compartido
      const categorization = await categorizeSize(leadId, squareMeters!, normalizedWidth!, normalizedHeight!);

      return {
        success: true,
        message: categorization.sizeAdvice,
        data: {
          widthMeters: normalizedWidth,
          heightMeters: normalizedHeight,
          squareMeters,
          requiresHumanReview: categorization.requiresHumanReview,
        },
      };
    } catch (error) {
      console.error("[set_measurements] Error inesperado", {
        leadId,
        widthMeters,
        heightMeters,
        error,
      });

      return {
        success: false,
        message:
          "Ocurrió un error inesperado al registrar las medidas.",
      };
    }
  },
});