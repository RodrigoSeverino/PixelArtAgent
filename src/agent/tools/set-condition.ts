/**
 * Tool: set_surface_condition
 *
 * El agente llama este tool cuando recopila información sobre el estado
 * de la superficie del cliente. La información se extrae de forma
 * conversacional, NO como cuestionario.
 *
 * Qué hace:
 * - Actualiza b2c_surface_assessments con los datos de condición
 * - No cambia la etapa — esta info se recopila en paralelo
 */

import { supabase } from "@/lib/supabase";

export const createSetSurfaceConditionTool = (leadId: string) => ({
  description:
    "Registra la condición/estado de la superficie del cliente. " +
    "Llamar cuando el cliente mencione datos sobre humedad, óxido, antigüedad o textura. " +
    "No es necesario tener todos los campos — se pueden registrar parcialmente.",

  parameters: {
    type: "object",
    properties: {
      hasHumidity: {
        type: "boolean",
        description: "true si la superficie tiene humedad"
      },
      hasRust: {
        type: "boolean",
        description: "true si la superficie tiene óxido"
      },
      generalCondition: {
        type: "string",
        enum: ["VERY_GOOD", "GOOD", "REGULAR", "BAD"],
        description: "Estado general: VERY_GOOD=perfecta, GOOD=bien con detalles menores, REGULAR=algo deteriorada, BAD=mal estado"
      },
      texture: {
        type: "string",
        enum: ["SMOOTH", "IRREGULAR"],
        description: "Textura: SMOOTH=lisa, IRREGULAR=rugosa o con relieve"
      },
      estimatedAgeYears: {
        type: "number",
        description: "Antigüedad estimada en años de la superficie"
      }
    }
  },

  execute: async (params: { hasHumidity?: boolean; hasRust?: boolean; generalCondition?: string; texture?: string; estimatedAgeYears?: number }) => {
    const now = new Date().toISOString();

    // Construir update dinámico (solo campos presentes)
    const update: Record<string, unknown> = { updated_at: now };
    if (params.hasHumidity !== undefined) update.has_humidity = params.hasHumidity;
    if (params.hasRust !== undefined) update.has_rust = params.hasRust;
    if (params.generalCondition) update.general_condition = params.generalCondition;
    if (params.texture) update.texture = params.texture;
    if (params.estimatedAgeYears !== undefined) update.estimated_age_years = params.estimatedAgeYears;

    // Evaluar aptitud automáticamente
    if (params.hasHumidity || params.hasRust || params.generalCondition === "BAD") {
      update.suitability_status = "REQUIRES_HUMAN_REVIEW";
    } else if (params.generalCondition === "REGULAR") {
      update.suitability_status = "SUITABLE_WITH_REVIEW";
    } else if (params.generalCondition === "VERY_GOOD" || params.generalCondition === "GOOD") {
      update.suitability_status = "SUITABLE";
    }

    const { error } = await supabase
      .from("b2c_surface_assessments")
      .update(update)
      .eq("lead_id", leadId);

    if (error) {
      return {
        success: false,
        message: "Error al actualizar la condición de la superficie.",
      };
    }

    const conditionSummary: string[] = [];
    if (params.generalCondition) {
      const labels: Record<string, string> = {
        VERY_GOOD: "muy buena",
        GOOD: "buena",
        REGULAR: "regular",
        BAD: "mala",
      };
      conditionSummary.push(`Condición: ${labels[params.generalCondition]}`);
    }
    if (params.hasHumidity !== undefined) conditionSummary.push(`Humedad: ${params.hasHumidity ? "sí" : "no"}`);
    if (params.hasRust !== undefined) conditionSummary.push(`Óxido: ${params.hasRust ? "sí" : "no"}`);
    if (params.texture) conditionSummary.push(`Textura: ${params.texture === "SMOOTH" ? "lisa" : "irregular"}`);
    if (params.estimatedAgeYears !== undefined) conditionSummary.push(`Antigüedad: ~${params.estimatedAgeYears} años`);

    return {
      success: true,
      message: `Estado registrado. ${conditionSummary.join(", ")}. Continuá con el flujo — pedí foto si no la tiene, o medidas si ya tenés la foto.`,
    };
  },
});
