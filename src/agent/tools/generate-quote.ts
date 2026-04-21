/**
 * Tool: generate_quote
 *
 * El agente llama este tool cuando tiene toda la información necesaria
 * para generar la cotización: superficie + medidas + escenario de imagen.
 *
 * IMPORTANTE: La cotización la calcula el backend, NO el LLM.
 * - Lee precios dinámicos de b2c_pricing (con fallback hardcodeado)
 * - Calcula: base + colocación + extras
 * - Guarda la cotización en b2c_quotes
 * - Avanza el lead a QUOTE_READY o REQUIRES_HUMAN_REVIEW
 */
/**
 * Tool: generate_quote
 *
 * El agente llama este tool cuando tiene toda la información necesaria
 * para generar la cotización: superficie + medidas + escenario de imagen.
 *
 * IMPORTANTE: La cotización la calcula el backend, NO el LLM.
 * - Lee precios dinámicos de b2c_pricing (con fallback hardcodeado)
 * - Calcula: base + colocación + extras
 * - Guarda la cotización en b2c_quotes
 * - Avanza el lead a QUOTE_READY o REQUIRES_HUMAN_REVIEW
 */

import { supabase } from "@/lib/supabase";
import { calculateQuote } from "@/lib/pricing";
import type { SurfaceType } from "@/types/surface";
import type { PrintFileScenario } from "@/types/quote";

type GenerateQuoteInput = {
  installationRequired: boolean;
};

export const createGenerateQuoteTool = (leadId: string) => ({
  description:
    "Genera la cotización preliminar del vinilo. " +
    "Llamar SOLO cuando ya tengas: superficie registrada, medidas válidas y escenario de imagen definido. " +
    "El tool calcula el precio automáticamente — NUNCA inventes precios. " +
    "No llamar este tool si faltan datos o si las medidas aún no fueron registradas.",

  parameters: {
    type: "object",
    properties: {
      installationRequired: {
        type: "boolean",
        description:
          "true si el cliente quiere colocación profesional. Para superficies >= 1 m² se recomienda colocación.",
      },
    },
    required: ["installationRequired"],
  },

  execute: async ({
    installationRequired,
  }: GenerateQuoteInput): Promise<any> => {
    const now = new Date().toISOString();

    try {
      // ---------------------------------
      // 1) Obtener superficie y medidas
      // ---------------------------------
      const [surfaceRes, measurementRes] = await Promise.all([
        supabase
          .from("b2c_surface_assessments")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("b2c_measurements")
          .select("*")
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (surfaceRes.error) {
        console.error("[generate_quote] Error consultando superficie", {
          leadId,
          error: surfaceRes.error,
        });

        return {
          success: false,
          message:
            "No pude generar la cotización porque hubo un error al consultar la superficie registrada.",
          debug: {
            code: surfaceRes.error.code,
            details: surfaceRes.error.details,
            hint: surfaceRes.error.hint,
          },
        };
      }

      if (measurementRes.error) {
        console.error("[generate_quote] Error consultando medidas", {
          leadId,
          error: measurementRes.error,
        });

        return {
          success: false,
          message:
            "No pude generar la cotización porque hubo un error al consultar las medidas registradas.",
          debug: {
            code: measurementRes.error.code,
            details: measurementRes.error.details,
            hint: measurementRes.error.hint,
          },
        };
      }

      const surface = surfaceRes.data;
      const measurement = measurementRes.data;

      if (!surface && !measurement) {
        return {
          success: false,
          message:
            "No se puede generar la cotización: faltan superficie y medidas. " +
            "Asegurate de haber registrado ambos datos antes de llamar este tool.",
        };
      }

      if (!surface) {
        return {
          success: false,
          message:
            "No se puede generar la cotización: falta la superficie registrada.",
        };
      }

      if (!measurement) {
        return {
          success: false,
          message:
            "No se puede generar la cotización: faltan las medidas registradas.",
        };
      }

      // ---------------------------------
      // 2) Validar medidas
      // ---------------------------------
      const squareMeters = Number(measurement.square_meters);

      if (!Number.isFinite(squareMeters) || squareMeters <= 0) {
        console.error("[generate_quote] square_meters inválido", {
          leadId,
          measurement,
          squareMeters,
        });

        return {
          success: false,
          message:
            "Las medidas guardadas no son válidas para generar la cotización.",
          data: {
            widthMeters: measurement.width_meters ?? null,
            heightMeters: measurement.height_meters ?? null,
            squareMeters: measurement.square_meters ?? null,
          },
        };
      }

      // ---------------------------------
      // 3) Determinar escenario de imagen
      // ---------------------------------
      const { data: leadData, error: leadError } = await supabase
        .from("b2c_leads")
        .select("current_stage")
        .eq("id", leadId)
        .maybeSingle();

      if (leadError) {
        console.error("[generate_quote] Error consultando lead", {
          leadId,
          error: leadError,
        });
      }

      let printFileScenario: PrintFileScenario = "READY_FILE";

      const { data: history, error: historyError } = await supabase
        .from("b2c_conversation_history")
        .select("content")
        .eq("lead_id", leadId)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(5);

      if (historyError) {
        console.error("[generate_quote] Error consultando historial", {
          leadId,
          error: historyError,
        });
      }

      if (history && history.length > 0) {
        const lastMessages = history
          .map((h) => h.content)
          .join(" ")
          .toLowerCase();

        if (
          lastMessages.includes("banco de imágenes") ||
          lastMessages.includes("banco de imagenes") ||
          lastMessages.includes("image_bank")
        ) {
          printFileScenario = "IMAGE_BANK";
        } else if (
          lastMessages.includes("diseño personalizado") ||
          lastMessages.includes("diseno personalizado") ||
          lastMessages.includes("custom_design")
        ) {
          printFileScenario = "CUSTOM_DESIGN";
        }
      }

      // fallback adicional por stage si en algún momento querés endurecer reglas
      if (leadData?.current_stage === "REQUIRES_HUMAN_REVIEW") {
        console.info("[generate_quote] Lead ya marcado para revisión humana", {
          leadId,
          currentStage: leadData.current_stage,
        });
      }

      // ---------------------------------
      // 4) Calcular cotización
      // ---------------------------------
      let quote;
      try {
        quote = await calculateQuote({
          surfaceType: surface.surface_type as SurfaceType,
          squareMeters,
          installationRequired,
          printFileScenario,
          isFullObject: surface.is_full_object,
        });
      } catch (error) {
        console.error("[generate_quote] Error calculando cotización", {
          leadId,
          surfaceType: surface.surface_type,
          squareMeters,
          installationRequired,
          printFileScenario,
          isFullObject: surface.is_full_object,
          error,
        });

        return {
          success: false,
          message:
            "Ocurrió un error al calcular la cotización. Revisá los datos y derivá el caso si es necesario.",
        };
      }

      // ---------------------------------
      // 5) Guardar cotización
      // ---------------------------------
      const { error: quoteInsertError } = await supabase
        .from("b2c_quotes")
        .insert({
          lead_id: leadId,
          surface_type: surface.surface_type,
          square_meters: squareMeters,
          print_file_scenario: printFileScenario,
          installation_required: installationRequired,
          estimated_base_price: quote.estimatedBasePrice,
          estimated_install_price: quote.estimatedInstallPrice,
          estimated_extra_price: quote.estimatedExtraPrice,
          estimated_total: quote.estimatedTotal,
          requires_human_review: quote.requiresHumanReview,
          updated_at: now,
        });

      if (quoteInsertError) {
        console.error("[generate_quote] Error insertando b2c_quotes", {
          leadId,
          error: quoteInsertError,
          payload: {
            surface_type: surface.surface_type,
            square_meters: squareMeters,
            print_file_scenario: printFileScenario,
            installation_required: installationRequired,
          },
        });

        return {
          success: false,
          message:
            "La cotización fue calculada, pero no se pudo guardar en la base de datos.",
          data: {
            estimatedBasePrice: quote.estimatedBasePrice,
            estimatedInstallPrice: quote.estimatedInstallPrice,
            estimatedExtraPrice: quote.estimatedExtraPrice,
            estimatedTotal: quote.estimatedTotal,
            currency: quote.currency,
            requiresHumanReview: quote.requiresHumanReview,
          },
          debug: {
            code: quoteInsertError.code,
            details: quoteInsertError.details,
            hint: quoteInsertError.hint,
          },
        };
      }

      // ---------------------------------
      // 6) Avanzar etapa
      // ---------------------------------
      const nextStage = quote.requiresHumanReview
        ? "REQUIRES_HUMAN_REVIEW"
        : "QUOTE_READY";

      const { error: leadUpdateError } = await supabase
        .from("b2c_leads")
        .update({ current_stage: nextStage, updated_at: now })
        .eq("id", leadId);

      if (leadUpdateError) {
        console.error("[generate_quote] Error actualizando etapa del lead", {
          leadId,
          nextStage,
          error: leadUpdateError,
        });

        return {
          success: false,
          message:
            "La cotización se generó y guardó, pero no se pudo actualizar la etapa del lead.",
          data: {
            estimatedBasePrice: quote.estimatedBasePrice,
            estimatedInstallPrice: quote.estimatedInstallPrice,
            estimatedExtraPrice: quote.estimatedExtraPrice,
            estimatedTotal: quote.estimatedTotal,
            currency: quote.currency,
            requiresHumanReview: quote.requiresHumanReview,
            newStage: nextStage,
          },
          debug: {
            code: leadUpdateError.code,
            details: leadUpdateError.details,
            hint: leadUpdateError.hint,
          },
        };
      }

      // ---------------------------------
      // 7) Construir desglose para el agente
      // ---------------------------------
      const breakdown: string[] = [
        "Cotización generada exitosamente:",
        `• Impresión (${squareMeters} m²): $${quote.estimatedBasePrice.toLocaleString()} ${quote.currency}`,
      ];

      if (quote.estimatedInstallPrice > 0) {
        breakdown.push(
          `• Colocación: $${quote.estimatedInstallPrice.toLocaleString()} ${quote.currency}`
        );
      }

      if (quote.estimatedExtraPrice > 0) {
        const extraLabel =
          printFileScenario === "IMAGE_BANK"
            ? "Banco de imágenes"
            : "Diseño personalizado";

        breakdown.push(
          `• ${extraLabel}: $${quote.estimatedExtraPrice.toLocaleString()} ${quote.currency}`
        );
      }

      breakdown.push(
        `• TOTAL ESTIMADO: $${quote.estimatedTotal.toLocaleString()} ${quote.currency}`
      );

      if (quote.requiresHumanReview) {
        breakdown.push(
          "⚠️ Este caso requiere revisión humana. Informá al cliente que un asesor va a confirmar la cotización final."
        );
      } else {
        breakdown.push("✅ Cotización lista. Informá al cliente y cerrá el flujo.");
      }

      return {
        success: true,
        message: breakdown.join("\n"),
        data: {
          estimatedBasePrice: quote.estimatedBasePrice,
          estimatedInstallPrice: quote.estimatedInstallPrice,
          estimatedExtraPrice: quote.estimatedExtraPrice,
          estimatedTotal: quote.estimatedTotal,
          currency: quote.currency,
          requiresHumanReview: quote.requiresHumanReview,
          newStage: nextStage,
          squareMeters,
          printFileScenario,
        },
      };
    } catch (error) {
      console.error("[generate_quote] Error inesperado", {
        leadId,
        installationRequired,
        error,
      });

      return {
        success: false,
        message: "Ocurrió un error inesperado al generar la cotización.",
      };
    }
  },
});