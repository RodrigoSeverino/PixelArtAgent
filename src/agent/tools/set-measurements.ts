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
      // ---------------------------------
      // 1) Normalización y validación
      // ---------------------------------
      const normalizedWidth = Number(widthMeters);
      const normalizedHeight = Number(heightMeters);

      if (!Number.isFinite(normalizedWidth) || !Number.isFinite(normalizedHeight)) {
        console.error("[set_measurements] Medidas no numéricas", {
          leadId,
          widthMeters,
          heightMeters,
        });

        return {
          success: false,
          message:
            "No pude registrar las medidas porque los valores recibidos no son válidos. " +
            "Necesito ancho y alto expresados como números en metros.",
        };
      }

      if (normalizedWidth <= 0 || normalizedHeight <= 0) {
        console.error("[set_measurements] Medidas menores o iguales a cero", {
          leadId,
          normalizedWidth,
          normalizedHeight,
        });

        return {
          success: false,
          message:
            "No pude registrar las medidas porque ancho y alto deben ser mayores a 0.",
        };
      }

      // Límite defensivo para evitar valores absurdos por mala interpretación del agente
      if (normalizedWidth > 100 || normalizedHeight > 100) {
        console.error("[set_measurements] Medidas fuera de rango razonable", {
          leadId,
          normalizedWidth,
          normalizedHeight,
        });

        return {
          success: false,
          message:
            "Las medidas detectadas parecen fuera de rango. Confirmá ancho y alto en metros antes de continuar.",
        };
      }

      const squareMeters = Number((normalizedWidth * normalizedHeight).toFixed(2));

      if (!Number.isFinite(squareMeters) || squareMeters <= 0) {
        console.error("[set_measurements] squareMeters inválido", {
          leadId,
          normalizedWidth,
          normalizedHeight,
          squareMeters,
        });

        return {
          success: false,
          message:
            "No pude calcular los metros cuadrados con las medidas recibidas.",
        };
      }

      // ---------------------------------
      // 2) Guardar medidas
      // ---------------------------------
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

      // ---------------------------------
      // 3) Avanzar etapa del lead
      // ---------------------------------
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

      // ---------------------------------
      // 4) Verificar si es objeto completo
      // ---------------------------------
      const {
        data: surfaceData,
        error: surfaceError,
      } = await supabase
        .from("b2c_surface_assessments")
        .select("is_full_object")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (surfaceError) {
        console.error("[set_measurements] Error consultando surface assessment", {
          leadId,
          error: surfaceError,
        });
      }

      if (surfaceData?.is_full_object) {
        return {
          success: true,
          message:
            `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². ` +
            `OBJETO COMPLETO — derivar a asesor humano.`,
          data: {
            widthMeters: normalizedWidth,
            heightMeters: normalizedHeight,
            squareMeters,
            requiresHumanReview: true,
          },
        };
      }

      // ---------------------------------
      // 5) Evaluar reglas por tamaño
      // ---------------------------------
      let sizeAdvice = "";
      let requiresHumanReview = false;

      if (squareMeters < 1) {
        sizeAdvice =
          `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². ` +
          `TAMAÑO PEQUEÑO — el cliente puede retirarlo sin costo de colocación adicional, ` +
          `o pedir colocación con costo fijo. ` +
          `Preguntá ahora por la imagen: ¿ya tiene archivo, quiere ver el banco de imágenes, o necesita diseño personalizado?`;
      } else if (squareMeters < 3) {
        sizeAdvice =
          `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². ` +
          `TAMAÑO MEDIO — nuestro equipo va a revisar la foto de la superficie. ` +
          `Se recomienda colocación profesional. ` +
          `Preguntá ahora por la imagen: ¿ya tiene archivo, quiere ver el banco de imágenes, o necesita diseño personalizado?`;
      } else {
        sizeAdvice =
          `Medidas registradas: ${normalizedWidth}m × ${normalizedHeight}m = ${squareMeters} m². ` +
          `TAMAÑO GRANDE (≥ 3 m²) — requiere evaluación presencial o por CRM. ` +
          `El caso se marca para revisión humana. ` +
          `Aún así, preguntá por la imagen para completar la cotización preliminar.`;
        requiresHumanReview = true;
      }

      return {
        success: true,
        message: sizeAdvice,
        data: {
          widthMeters: normalizedWidth,
          heightMeters: normalizedHeight,
          squareMeters,
          requiresHumanReview,
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